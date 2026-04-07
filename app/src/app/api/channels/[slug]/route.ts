import type { NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";

// 公共: 通过 slug 获取频道详情 + profile + 当前直播会话 + 最近一次历史
// 用于观看页 /watch/[slug]: 决定是渲染 LIVE 模式还是 OFFLINE 主页模式
export async function GET(
  _req: NextRequest,
  ctx: { params: Promise<{ slug: string }> }
) {
  const { slug: rawSlug } = await ctx.params;
  const slug = decodeURIComponent(rawSlug || "").trim().toLowerCase();
  if (!slug) {
    return Response.json({ error: "slug 为空" }, { status: 400 });
  }

  const supabase = await createClient();
  if (!supabase) {
    return Response.json({ error: "服务未配置" }, { status: 500 });
  }

  const { data: channel, error: cErr } = await supabase
    .from("channels")
    .select("*")
    .eq("slug", slug)
    .maybeSingle();

  if (cErr) {
    return Response.json({ error: cErr.message }, { status: 500 });
  }
  if (!channel) {
    return Response.json({ error: "频道不存在" }, { status: 404 });
  }

  // 频道主 profile (头像/简介/粉丝数)
  const { data: profile } = await supabase
    .from("profiles")
    .select("id, username, display_name, avatar_url, bio, followers_count")
    .eq("id", channel.user_id)
    .maybeSingle();

  // 当前是否在直播
  const { data: liveStream } = await supabase
    .from("live_streams")
    .select("*")
    .eq("channel_id", channel.id)
    .eq("status", "live")
    .maybeSingle();

  // 最近一次历史 (用于离线主页摘要卡)
  const { data: lastSession } = await supabase
    .from("stream_history")
    .select("title, project_name, thumbnail_url, started_at, ended_at, duration_seconds, peak_viewers")
    .eq("channel_id", channel.id)
    .order("started_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  return Response.json({
    channel,
    profile: profile ?? null,
    liveStream: liveStream ?? null,
    lastSession: lastSession ?? null,
  });
}
