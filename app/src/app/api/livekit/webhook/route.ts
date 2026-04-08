import { NextRequest } from "next/server";
import { getWebhookReceiver } from "@/lib/livekit/server";
import { createServiceClient } from "@/lib/supabase/service";
import { archiveLiveStreamByRoom } from "@/lib/streams/archive";

// ────────────────────────────────────────────────────────────────
// /api/livekit/webhook
//
// 接收 LiveKit Cloud (或自托管 server) 发来的事件,事件驱动地清理
// live_streams 表,根治"主播没主动按结束按钮 → 数据库里僵尸记录"
// 这个老问题。
//
// ─ 处理的事件 ─
//   room_finished   主路径。LiveKit 房间在最后一个 publisher 离开后
//                   会保留一段时间然后触发,这就是"真的下播了"。
//   ingress_ended   OBS 模式辅助路径。OBS 推流断开 → ingress 结束 →
//                   归档同一个 room 的 live_stream。
//
// ─ 安全 ─
//   - 用 LIVEKIT_API_SECRET 验签 (LiveKit 在 Authorization header 放
//     一个 JWT, WebhookReceiver.receive() 自动校验)
//   - 验签失败 → 401
//   - 验签成功但找不到对应 row → 200 (幂等, 防止 LiveKit 重试风暴)
//
// ─ Supabase 客户端 ─
//   webhook 没有用户 cookie, 无法走 RLS。必须用 service role client。
//   见 lib/supabase/service.ts 的安全说明。
//
// ─ 配置步骤 (生产) ─
//   1. Vercel/部署环境变量加: SUPABASE_SERVICE_ROLE_KEY=...
//      (在 Supabase Dashboard → Project Settings → API → service_role)
//   2. LiveKit Cloud Dashboard → Project Settings → Webhooks
//      添加 URL: https://vibelieveai.com/api/livekit/webhook
//      勾选 events: room_finished, ingress_ended
//      不需要单独的 webhook secret — LiveKit 会用 API Secret 签名
//   3. 自托管 LiveKit: 在 livekit.yaml 加
//        webhook:
//          api_key: <LIVEKIT_API_KEY>
//          urls:
//            - https://vibelieveai.com/api/livekit/webhook
// ────────────────────────────────────────────────────────────────

// LiveKit SDK 依赖 Node crypto,不能跑 Edge runtime
export const runtime = "nodejs";
// 每次调用都即时处理,不缓存
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const receiver = getWebhookReceiver();
  if (!receiver) {
    // env 没配齐 — 静默接受,避免 LiveKit 重试
    return Response.json({ ok: true, skipped: "livekit not configured" });
  }

  // 必须读原始 body 字符串 — LiveKit 用 raw bytes 算签名,
  // 先 .json() 再 stringify 会破坏字节序导致验签失败
  const rawBody = await request.text();
  const authHeader = request.headers.get("Authorization") || "";

  let event;
  try {
    event = await receiver.receive(rawBody, authHeader);
  } catch (e) {
    console.warn(
      "[livekit-webhook] signature verification failed:",
      e instanceof Error ? e.message : e
    );
    return Response.json({ error: "invalid signature" }, { status: 401 });
  }

  const supabase = createServiceClient();
  if (!supabase) {
    // service role key 没配 — 不能动数据库, 但要 200 防重试
    console.error(
      "[livekit-webhook] SUPABASE_SERVICE_ROLE_KEY missing, skipping"
    );
    return Response.json({ ok: true, skipped: "supabase service unavailable" });
  }

  const eventName = event.event;
  // room.name = channel.slug = live_streams.room_name
  // ingress 事件的 room 字段同样含 name
  const roomName = event.room?.name || "";

  switch (eventName) {
    case "room_finished":
    case "ingress_ended": {
      if (!roomName) {
        return Response.json({ ok: true, skipped: "no room name in event" });
      }
      const result = await archiveLiveStreamByRoom(supabase, roomName);
      // archived=false 不是错误 — 可能已经被主播主动归档过了 (幂等)
      return Response.json({
        ok: true,
        event: eventName,
        room: roomName,
        ...result,
      });
    }
    default:
      // 其他事件 (room_started / participant_* / track_* / egress_*) 暂不关心
      return Response.json({ ok: true, ignored: eventName });
  }
}
