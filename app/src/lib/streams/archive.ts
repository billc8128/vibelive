import type { SupabaseClient } from "@supabase/supabase-js";
import { getRoomService } from "@/lib/livekit/server";

// ────────────────────────────────────────────────────────────────
// Live stream 归档 helper
//
// 把"结束一次直播"的副作用收敛到一个地方:
//   1. 复制 live_streams row → stream_history (供离线频道页摘要)
//   2. 删除 live_streams row (这张表只存"现在正在直播")
//   3. 删除 LiveKit room (断开残留观众,释放资源)
//
// 被三个调用方共享:
//   - DELETE /api/streams           (主播主动结束)
//   - POST /api/streams 之前的清理   (同一频道开新直播,清掉老残留)
//   - LiveKit webhook room_finished (服务端事件驱动,治本)
//
// 关于 supabase 参数的语义:
//   - 调用方传 user client → 走 RLS, 只能归档自己的 row
//   - 调用方传 service client → 绕 RLS, 可跨用户归档
//   webhook 必须传 service client (没有用户 cookie)
// ────────────────────────────────────────────────────────────────

interface LiveStreamRow {
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

export interface ArchiveResult {
  archived: boolean;
  reason?: string;
}

/**
 * 直接归档一行 live_streams (调用方已经查到了 row)。
 * 不写 stream_history 的情况:row 没有 channel_id (老数据)。
 */
export async function archiveLiveStreamRow(
  supabase: SupabaseClient,
  row: LiveStreamRow
): Promise<ArchiveResult> {
  // stream_history.channel_id 是 NOT NULL,没有 channel_id 的老 row 跳过 history
  if (row.channel_id) {
    const { error: histErr } = await supabase.from("stream_history").insert({
      channel_id: row.channel_id,
      user_id: row.user_id,
      title: row.title || "",
      project_name: row.project_name || "",
      project_stage: row.stage || "",
      coding_tool: row.coding_tool || "",
      thumbnail_url: row.thumbnail_url || "",
      started_at: row.started_at,
      ended_at: new Date().toISOString(),
      peak_viewers: row.viewers_count || 0,
    });
    if (histErr) {
      // history 写失败 → 保留 live_streams row, 让下次 webhook/verify 重试.
      // 之前的实现是"warn 然后继续删", 但那会让这次直播的历史记录永久丢失,
      // 用户的累计时长 / 频道页"上次直播"摘要全部消失. 所有调用方
      // (webhook / verify / DELETE /api/streams) 都是幂等的, 重试是安全的.
      console.error(
        "[archive] stream_history insert failed, NOT deleting row to allow retry:",
        histErr.message
      );
      return { archived: false, reason: `history write failed: ${histErr.message}` };
    }
  }

  const { error: delErr } = await supabase
    .from("live_streams")
    .delete()
    .eq("id", row.id);

  if (delErr) {
    return { archived: false, reason: delErr.message };
  }

  // LiveKit room 清理 — fire and forget,失败不影响归档语义
  if (row.room_name) {
    const roomService = getRoomService();
    if (roomService) {
      roomService.deleteRoom(row.room_name).catch(() => {});
    }
  }

  return { archived: true };
}

/**
 * 按 room_name 归档当前活跃的 live_stream。
 * webhook 主路径:LiveKit 给的事件里只有 room name,我们用它定位 row。
 *
 * 如果没找到对应活跃 row(已经被归档过、或从未存在),返回 archived=false 但不报错 —
 * webhook 会被重试,必须幂等。
 */
export async function archiveLiveStreamByRoom(
  supabase: SupabaseClient,
  roomName: string
): Promise<ArchiveResult> {
  if (!roomName) {
    return { archived: false, reason: "empty room name" };
  }

  const { data: row, error } = await supabase
    .from("live_streams")
    .select("*")
    .eq("room_name", roomName)
    .eq("status", "live")
    .maybeSingle();

  if (error) {
    return { archived: false, reason: error.message };
  }
  if (!row) {
    return { archived: false, reason: "no active stream for room" };
  }

  return archiveLiveStreamRow(supabase, row as LiveStreamRow);
}

/**
 * 归档一个 channel 下所有残留的 live_streams (POST /api/streams 之前的清理路径)。
 * 通常只有 0 或 1 行,但 defensive 写法支持多行。
 */
export async function archiveActiveStreamsForChannel(
  supabase: SupabaseClient,
  channelId: string
): Promise<number> {
  const { data: leftover } = await supabase
    .from("live_streams")
    .select("*")
    .eq("channel_id", channelId)
    .eq("status", "live");

  if (!leftover?.length) return 0;

  let count = 0;
  for (const row of leftover) {
    const r = await archiveLiveStreamRow(supabase, row as LiveStreamRow);
    if (r.archived) count++;
  }
  return count;
}
