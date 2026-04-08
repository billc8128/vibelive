import { IngressInput } from "@livekit/protocol";
import { createClient } from "@/lib/supabase/server";
import { getIngressClient } from "@/lib/livekit/server";

// ────────────────────────────────────────────────────────────────
// /api/livekit/ingress
//
// 让主播通过 OBS / RTMP 推流。LiveKit Ingress 会启动一个虚拟参与者
// 把 RTMP 输入转码后注入到 LiveKit room (room name = channel.slug)。
//
//   GET    → 返回当前用户频道现有的 ingress 信息 (没有则 null)
//   POST   → 创建新 ingress, 或返回已有的 (idempotent)
//   DELETE → 删除 ingress, 强制下次 POST 重新生成 (= 重置 stream key)
//
// ingress_id 持久化在 channels.settings.ingress_id, 这样 stream key
// 是稳定的, 用户配置一次 OBS 就能反复使用。
// ────────────────────────────────────────────────────────────────

// 只把客户端需要的字段抽出来 (避免泄露 protobuf 内部状态)
function sanitize(info: { ingressId: string; url: string; streamKey: string; participantIdentity: string }) {
  return {
    ingress_id: info.ingressId,
    url: info.url,
    stream_key: info.streamKey,
    participant_identity: info.participantIdentity,
  };
}

async function loadCurrentChannel() {
  const supabase = await createClient();
  if (!supabase) return { error: "服务未配置", status: 500 as const };
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "未登录", status: 401 as const };
  const { data: channel } = await supabase
    .from("channels")
    .select("*")
    .eq("user_id", user.id)
    .maybeSingle();
  if (!channel) return { error: "请先创建频道", status: 400 as const };
  return { supabase, user, channel };
}

// GET: 返回当前用户频道的 ingress, 不存在则 null
export async function GET() {
  const ctx = await loadCurrentChannel();
  if ("error" in ctx) {
    return Response.json({ error: ctx.error }, { status: ctx.status });
  }
  const { channel } = ctx;

  const ingressId = (channel.settings as Record<string, unknown>)?.ingress_id as string | undefined;
  if (!ingressId) {
    return Response.json({ ingress: null });
  }

  const client = getIngressClient();
  if (!client) {
    return Response.json({ error: "Ingress 未配置" }, { status: 500 });
  }

  try {
    const list = await client.listIngress({ ingressId });
    const found = list[0];
    if (!found) {
      return Response.json({ ingress: null });
    }
    return Response.json({ ingress: sanitize(found) });
  } catch {
    // ingress 已被删除或 API 失败 - 返回 null 让前端重新创建
    return Response.json({ ingress: null });
  }
}

// POST: 创建新 ingress 或返回已有的
export async function POST() {
  const ctx = await loadCurrentChannel();
  if ("error" in ctx) {
    return Response.json({ error: ctx.error }, { status: ctx.status });
  }
  const { supabase, channel } = ctx;

  const client = getIngressClient();
  if (!client) {
    return Response.json({ error: "Ingress 未配置" }, { status: 500 });
  }

  // 如果已有 ingress, 直接返回 (LiveKit 端可能仍存活)
  const existingId = (channel.settings as Record<string, unknown>)?.ingress_id as string | undefined;
  if (existingId) {
    try {
      const list = await client.listIngress({ ingressId: existingId });
      if (list[0]) {
        return Response.json({ ingress: sanitize(list[0]) });
      }
    } catch {
      // 继续往下创建新的
    }
  }

  // 固定的虚拟参与者身份, 前端可据此识别"OBS 已连上"
  const participantIdentity = `obs-${channel.slug}`;

  try {
    const created = await client.createIngress(IngressInput.RTMP_INPUT, {
      name: `vibelive-${channel.slug}`,
      roomName: channel.slug,
      participantIdentity,
      participantName: `${channel.slug} (OBS)`,
      enableTranscoding: true,
    });

    // 把 ingress_id 写回 channels.settings
    const newSettings = {
      ...((channel.settings as Record<string, unknown>) || {}),
      ingress_id: created.ingressId,
    };
    await supabase
      .from("channels")
      .update({ settings: newSettings })
      .eq("id", channel.id);

    return Response.json({ ingress: sanitize(created) });
  } catch (e) {
    return Response.json(
      { error: e instanceof Error ? e.message : "创建 ingress 失败" },
      { status: 500 }
    );
  }
}

// DELETE: 删除现有 ingress (= 重置 stream key)
export async function DELETE() {
  const ctx = await loadCurrentChannel();
  if ("error" in ctx) {
    return Response.json({ error: ctx.error }, { status: ctx.status });
  }
  const { supabase, channel } = ctx;

  const ingressId = (channel.settings as Record<string, unknown>)?.ingress_id as string | undefined;
  if (!ingressId) {
    return Response.json({ ok: true });
  }

  const client = getIngressClient();
  if (client) {
    try {
      await client.deleteIngress(ingressId);
    } catch {}
  }

  const newSettings = { ...((channel.settings as Record<string, unknown>) || {}) };
  delete newSettings.ingress_id;
  await supabase
    .from("channels")
    .update({ settings: newSettings })
    .eq("id", channel.id);

  return Response.json({ ok: true });
}
