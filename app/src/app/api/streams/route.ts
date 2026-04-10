import { NextRequest } from "next/server";
import { normalizeAiAudienceSettings } from "@/lib/ai-audience/settings";
import {
  startAiAudienceRuntime,
  stopAiAudienceRuntime,
} from "@/lib/orchestrator/client";
import { createClient } from "@/lib/supabase/server";
import {
  archiveActiveStreamsForChannel,
  archiveLiveStreamRow,
} from "@/lib/streams/archive";
import { verifyAndPruneLiveStreams } from "@/lib/streams/verify";

// ────────────────────────────────────────────────────────────────
// /api/streams
// 重构: 直播会话现在和 channels 表强绑定。
//   - room_name 始终等于 channel.slug, 是 LiveKit room name + 观看页 URL 段
//   - POST 不再接受任意 room_name; 取当前用户的 channel.slug
//   - DELETE 时把直播数据归档到 stream_history (用于离线频道页摘要)
//   - 大部分项目信息编辑请走 /api/channels (PATCH 会自动同步到 live_streams)
// ────────────────────────────────────────────────────────────────

// GET: 默认返回所有活跃直播; ?history=1 返回当前用户历史 (兼容旧用法)
export async function GET(request: NextRequest) {
  const supabase = await createClient();
  if (!supabase) {
    return Response.json({ streams: [] });
  }

  const history = request.nextUrl.searchParams.get("history");

  if (history) {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return Response.json({ streams: [] });
    // 历史查 stream_history (保留 live_streams 当前会话语义)
    const { data, error } = await supabase
      .from("stream_history")
      .select("*")
      .eq("user_id", user.id)
      .order("started_at", { ascending: false })
      .limit(50);

    if (error) return Response.json({ error: error.message }, { status: 500 });
    return Response.json({ streams: data ?? [] });
  }

  const { data, error } = await supabase
    .from("live_streams")
    .select("*")
    .eq("status", "live")
    .order("started_at", { ascending: false });

  if (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }

  // 二道防线: 用 LiveKit listRooms 校验真实状态, 顺手归档僵尸。
  // webhook (lib 一道防线) 可能漏事件 / 配置错, 这里每次首页请求都自愈。
  // 见 lib/streams/verify.ts 顶部注释。
  const { alive } = await verifyAndPruneLiveStreams(data ?? []);

  return Response.json({ streams: alive });
}

// POST: 开始新的直播会话
//   - 必须先有 channel
//   - 不接受客户端 room_name (统一使用 channel.slug)
//   - 复制 channel 的快照字段到 live_streams 行 (title/封面/项目信息等)
export async function POST() {
  const supabase = await createClient();
  if (!supabase) {
    return Response.json({ error: "服务未配置" }, { status: 500 });
  }

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return Response.json({ error: "未登录" }, { status: 401 });
  }

  // 找到当前用户的频道
  const { data: channel } = await supabase
    .from("channels")
    .select("*")
    .eq("user_id", user.id)
    .maybeSingle();

  if (!channel) {
    return Response.json(
      { error: "请先设置频道 ID" },
      { status: 400 }
    );
  }

  // 同一频道之前的活跃会话(异常残留)归档掉
  await archiveActiveStreamsForChannel(supabase, channel.id);

  const streamerName =
    user.user_metadata?.full_name ||
    user.user_metadata?.name ||
    user.email?.split("@")[0] ||
    "匿名";

  const { data, error } = await supabase
    .from("live_streams")
    .insert({
      channel_id: channel.id,
      room_name: channel.slug, // ← 关键: room_name 永远等于 slug
      user_id: user.id,
      streamer_name: streamerName,
      title: (channel.title || "").slice(0, 200),
      coding_tool: (channel.coding_tool || "other").slice(0, 30),
      thumbnail_url: (channel.thumbnail_url || "").slice(0, 500),
      project_name: (channel.project_name || "").slice(0, 200),
      description: (channel.project_desc || "").slice(0, 1000),
      stage: (channel.project_stage || "构思中").slice(0, 30),
      status: "live",
      started_at: new Date().toISOString(),
    })
    .select()
    .single();

  if (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }

  // 通知关注者 (异步, fire-and-forget)
  const avatarUrl =
    user.user_metadata?.avatar_url || user.user_metadata?.picture || "";
  supabase
    .from("follows")
    .select("follower_id")
    .eq("following_id", user.id)
    .then(({ data: followers }) => {
      if (!followers?.length) return;
      const notifications = followers.map((f) => ({
        user_id: f.follower_id,
        type: "stream_live",
        actor_id: user.id,
        actor_name: streamerName,
        actor_avatar: avatarUrl,
        target_id: channel.slug,
        target_title: (channel.title || channel.slug).slice(0, 200),
      }));
      supabase.from("notifications").insert(notifications).then(() => {});
    });

  const aiAudience = normalizeAiAudienceSettings(
    ((channel.settings as Record<string, unknown>) || {}) as Record<
      string,
      unknown
    >,
  );
  if (aiAudience.enabled) {
    void startAiAudienceRuntime({
      roomSlug: channel.slug,
      channelId: channel.id,
      roomTitle: channel.title || channel.slug,
      projectStage: channel.project_stage || "构思中",
      codingTool: channel.coding_tool || "other",
      clientDriven: true,
      aiAudience,
    }).catch(() => {});
  }

  return Response.json({ stream: data });
}

// PATCH: 兼容旧客户端的项目信息热更新
//   - 新代码应该改用 /api/channels PATCH (会自动同步到 live_streams)
//   - 这里保留以避免破坏正在运行的旧代码路径
export async function PATCH(request: NextRequest) {
  const supabase = await createClient();
  if (!supabase) {
    return Response.json({ error: "服务未配置" }, { status: 500 });
  }

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return Response.json({ error: "未登录" }, { status: 401 });
  }

  let patchBody: Record<string, string | undefined>;
  try {
    patchBody = await request.json();
  } catch {
    return Response.json({ error: "请求格式错误" }, { status: 400 });
  }

  const { project_name, description, stage, coding_tool, thumbnail_url } =
    patchBody;

  const updates: Record<string, string> = {};
  if (project_name !== undefined) updates.project_name = project_name.slice(0, 200);
  if (description !== undefined) updates.description = description.slice(0, 1000);
  if (stage !== undefined) updates.stage = stage.slice(0, 30);
  if (coding_tool !== undefined) updates.coding_tool = coding_tool.slice(0, 30);
  if (thumbnail_url !== undefined) updates.thumbnail_url = thumbnail_url.slice(0, 500);

  if (Object.keys(updates).length === 0) {
    return Response.json({ error: "没有可更新的字段" }, { status: 400 });
  }

  const { data, error } = await supabase
    .from("live_streams")
    .update(updates)
    .eq("user_id", user.id)
    .eq("status", "live")
    .select()
    .single();

  if (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }

  // 同步回 channels 表 (字段名映射)
  const channelUpdates: Record<string, string> = {};
  if (project_name !== undefined) channelUpdates.project_name = updates.project_name;
  if (description !== undefined) channelUpdates.project_desc = updates.description;
  if (stage !== undefined) channelUpdates.project_stage = updates.stage;
  if (coding_tool !== undefined) channelUpdates.coding_tool = updates.coding_tool;
  if (thumbnail_url !== undefined) channelUpdates.thumbnail_url = updates.thumbnail_url;
  if (Object.keys(channelUpdates).length > 0) {
    await supabase
      .from("channels")
      .update(channelUpdates)
      .eq("user_id", user.id);
  }

  return Response.json({ stream: data });
}

// DELETE: 结束当前直播
//   - 把直播会话归档到 stream_history (用于离线频道页摘要)
//   - 真删 live_streams 行 (live_streams 仅记录"当前正在直播",干净)
//   - 同步删除 LiveKit 房间, 断开所有观众连接
export async function DELETE() {
  const supabase = await createClient();
  if (!supabase) {
    return Response.json({ error: "服务未配置" }, { status: 500 });
  }

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return Response.json({ error: "未登录" }, { status: 401 });
  }

  // 找到当前用户的活跃直播
  const { data: liveStream } = await supabase
    .from("live_streams")
    .select("*")
    .eq("user_id", user.id)
    .eq("status", "live")
    .maybeSingle();

  if (!liveStream) {
    return Response.json({ ok: true, archived: false });
  }

  // 归档 (写 history + 删 row + 删 LiveKit room)
  // 走 user supabase client → RLS 校验 user_id, 不会越权
  const result = await archiveLiveStreamRow(supabase, liveStream);
  if (!result.archived) {
    return Response.json({ error: result.reason || "归档失败" }, { status: 500 });
  }

  void stopAiAudienceRuntime({ roomSlug: liveStream.room_name }).catch(() => {});

  return Response.json({ ok: true, archived: true });
}
