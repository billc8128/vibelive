import { getRoomService } from "@/lib/livekit/server";
import { createServiceClient } from "@/lib/supabase/service";
import { archiveLiveStreamRow } from "@/lib/streams/archive";

// ────────────────────────────────────────────────────────────────
// Live stream 真实性校验 (二道防线)
//
// 数据库里的 status='live' 只反映"曾经创建过直播会话",不保证当下
// LiveKit 那边真有 publisher 在推。Webhook 是事件驱动的清理(主),
// 这里是请求驱动的兜底(备):每次主页拉 streams 时顺手:
//   1. 调 LiveKit RoomService.listRooms() 查这些 room 的真实状态
//   2. 把"LiveKit 那边不存在 / 没 publisher"的 row 当僵尸归档
//   3. 只返回真活的
//
// 为什么要两层叠加 (webhook + 这里):
//   - Webhook 可能因为 LiveKit 配置错 / 网络问题 / 路由 bug 漏事件
//   - 主播在推流过程中 LiveKit 那边异常断开 → webhook 会发,但 retry
//     窗口期间数据库还是脏的,这里能立即清掉
//   - 开发环境可能没配 webhook,但首页仍要干净
//
// 关于 grace period:
//   主播刚开播时, /api/streams POST 会立即写 DB row, 但 LiveKit 那边
//   可能要 1-2 秒才有 publisher 真的连上。这段空窗期 numPublishers===0,
//   会被误杀。给 60 秒 grace。
// ────────────────────────────────────────────────────────────────

interface VerifiableStream {
  id: string;
  channel_id: string | null;
  user_id: string;
  room_name: string;
  title: string | null;
  project_name: string | null;
  stage: string | null;
  coding_tool: string | null;
  thumbnail_url: string | null;
  started_at: string;
  viewers_count: number | null;
}

export interface VerifyResult<T> {
  alive: T[];
  pruned: number;
}

const DEFAULT_GRACE_SECONDS = 60;

/**
 * 用 LiveKit RoomService 校验一批 live_streams,把僵尸归档掉,返回真活着的。
 *
 * 失败语义 (defensive):
 *   - LiveKit 未配置 → 跳过校验,原样返回 (不阻塞首页)
 *   - LiveKit API 失败 → 跳过校验,原样返回 (不阻塞首页)
 *
 * 这两种"不可校验"情况都倾向"假阳性"(让僵尸偶尔出现一次),
 * 而不是"假阴性"(让首页空白)。webhook 仍是主清理路径。
 */
export async function verifyAndPruneLiveStreams<T extends VerifiableStream>(
  streams: T[],
  options: { graceSeconds?: number } = {}
): Promise<VerifyResult<T>> {
  if (streams.length === 0) return { alive: [], pruned: 0 };

  const roomService = getRoomService();
  if (!roomService) {
    return { alive: streams, pruned: 0 };
  }

  const graceMs = (options.graceSeconds ?? DEFAULT_GRACE_SECONDS) * 1000;
  const now = Date.now();

  // 把流分成两堆:
  //   - "保护期内" (刚开播,不校验,直接放行)
  //   - "需要校验" (已开播超过 grace,要查 LiveKit)
  const protectedStreams: T[] = [];
  const verifiable: T[] = [];
  for (const s of streams) {
    const startedAt = new Date(s.started_at).getTime();
    if (isFinite(startedAt) && now - startedAt < graceMs) {
      protectedStreams.push(s);
    } else {
      verifiable.push(s);
    }
  }

  if (verifiable.length === 0) {
    return { alive: streams, pruned: 0 };
  }

  // 一次 LiveKit API 调用查所有需要校验的 room
  const roomNames = verifiable.map((s) => s.room_name).filter(Boolean);
  let aliveRoomNames: Set<string>;
  try {
    const rooms = await roomService.listRooms(roomNames);
    aliveRoomNames = new Set(
      rooms
        .filter((r) => (r.numPublishers ?? 0) > 0)
        .map((r) => r.name)
    );
  } catch (e) {
    console.warn(
      "[verify] livekit listRooms failed, skipping prune:",
      e instanceof Error ? e.message : e
    );
    return { alive: streams, pruned: 0 };
  }

  const alive: T[] = [];
  const zombies: T[] = [];
  for (const s of verifiable) {
    if (aliveRoomNames.has(s.room_name)) {
      alive.push(s);
    } else {
      zombies.push(s);
    }
  }

  // 顺手归档僵尸 (用 service client 跨用户清理)
  // 这里 await 而不是 fire-and-forget,因为 Vercel serverless 函数返回后
  // 没有 background context, 没 await 的 promise 会被丢弃
  if (zombies.length > 0) {
    const serviceSupabase = createServiceClient();
    if (serviceSupabase) {
      await Promise.all(
        zombies.map((z) =>
          archiveLiveStreamRow(serviceSupabase, z).catch((err) => {
            console.warn(
              "[verify] archive failed for",
              z.room_name,
              ":",
              err instanceof Error ? err.message : err
            );
          })
        )
      );
    } else {
      console.warn(
        "[verify] SUPABASE_SERVICE_ROLE_KEY missing — cannot archive zombies, skipping"
      );
    }
  }

  // 真活的 = 保护期内 + LiveKit 确认还在播
  return {
    alive: [...protectedStreams, ...alive],
    pruned: zombies.length,
  };
}
