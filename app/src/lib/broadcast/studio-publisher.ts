"use client";

import {
  Room,
  LocalVideoTrack,
  Track,
  RoomEvent,
  type LocalAudioTrack,
} from "livekit-client";
import { createLocalAudioTrack } from "livekit-client";

// ────────────────────────────────────────────────────────────────
// StudioPublisher — 把 compositor canvas 推到 LiveKit, 让别人能在
// /watch/{slug} 看到你的 studio 输出.
//
// 流程 (start):
//   1. POST /api/streams        → 拿 live_streams 行 (room_name = channel.slug)
//   2. POST /api/livekit/token  → publisher JWT (auth 派生 identity)
//   3. canvas.captureStream(fps) → MediaStream → LocalVideoTrack
//   4. 可选: getUserMedia({audio}) → LocalAudioTrack
//   5. new Room().connect(url, jwt)
//   6. localParticipant.publishTrack(videoTrack, { source: ScreenShare })
//      ↑ 关键: 用 ScreenShare source — watch 页 (line 99-111) 优先订阅
//        ScreenShare, 跟 OBS 用 Camera 走两条不同的 source 通道兼容
//
// 流程 (stop):
//   - room.disconnect()
//   - track.stop() 释放 canvas captureStream
//   - DELETE /api/streams 归档 + 删 LiveKit room
//
// 错误恢复: 任意一步失败, cleanup 已经创建的资源, setState("error"),
// 由 UI 决定是否重试. 不做指数退避 — 用户可以手动点重试更直观.
//
// 注意: 这个类不持有 React state, 是纯 imperative. UI 通过 onState 订阅.
// ────────────────────────────────────────────────────────────────

export type PublisherState =
  | "idle"
  | "starting"
  | "live"
  | "stopping"
  | "error";

export interface PublisherOptions {
  /** 是否同时推麦克风. 失败 (用户拒绝授权) 会 console.warn 但不阻塞推流. */
  withMic?: boolean;
  /** captureStream 帧率, 默认 30. */
  fps?: number;
}

export interface PublisherSnapshot {
  state: PublisherState;
  /** 已分配的 room name (= channel.slug); 仅 live 时有意义 */
  roomName: string | null;
  /** 观看 URL (相对路径, 调用方拼 origin); 仅 live 时有意义 */
  watchPath: string | null;
  /** 错误信息; state="error" 时填 */
  error: string | null;
}

type Listener = (snap: PublisherSnapshot) => void;

interface StreamRow {
  room_name?: string;
}

export class StudioPublisher {
  private room: Room | null = null;
  private videoTrack: LocalVideoTrack | null = null;
  private audioTrack: LocalAudioTrack | null = null;
  private snap: PublisherSnapshot = {
    state: "idle",
    roomName: null,
    watchPath: null,
    error: null,
  };
  private listeners = new Set<Listener>();

  get snapshot(): PublisherSnapshot {
    return this.snap;
  }

  /** 订阅状态变化, 立刻 emit 一次当前 snapshot. 返回 unsubscribe. */
  subscribe(fn: Listener): () => void {
    this.listeners.add(fn);
    fn(this.snap);
    return () => {
      this.listeners.delete(fn);
    };
  }

  private setSnap(patch: Partial<PublisherSnapshot>) {
    this.snap = { ...this.snap, ...patch };
    for (const f of this.listeners) {
      try {
        f(this.snap);
      } catch {
        // listener 抛错不能阻塞其他 listener
      }
    }
  }

  /**
   * 启动推流.
   * canvas — compositor 输出 canvas (带 captureStream 方法的 HTMLCanvasElement)
   * opts   — withMic / fps
   *
   * 调多次会 reject (除非已经 idle). 失败时所有部分资源会 cleanup.
   */
  async start(canvas: HTMLCanvasElement, opts: PublisherOptions = {}): Promise<void> {
    if (this.snap.state !== "idle" && this.snap.state !== "error") {
      throw new Error(`已在 ${this.snap.state} 状态, 不能 start`);
    }
    this.setSnap({ state: "starting", error: null });

    try {
      // ── 1. 拿 LiveKit URL ──
      const livekitUrl = process.env.NEXT_PUBLIC_LIVEKIT_URL;
      if (!livekitUrl) {
        throw new Error("NEXT_PUBLIC_LIVEKIT_URL 没配置");
      }

      // ── 2. POST /api/streams 创建 live_streams 行 ──
      // 后端会自动用当前用户的 channel.slug 作为 room_name
      const streamRes = await fetch("/api/streams", { method: "POST" });
      const streamJson: { stream?: StreamRow; error?: string } = await streamRes
        .json()
        .catch(() => ({}));
      if (!streamRes.ok || !streamJson.stream?.room_name) {
        throw new Error(streamJson.error || `/api/streams ${streamRes.status}`);
      }
      const roomName = streamJson.stream.room_name;

      // ── 3. POST /api/livekit/token 拿 publisher JWT ──
      const tokenRes = await fetch("/api/livekit/token", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ room: roomName, isPublisher: true }),
      });
      const tokenJson: { token?: string; error?: string } = await tokenRes
        .json()
        .catch(() => ({}));
      if (!tokenRes.ok || !tokenJson.token) {
        // 已经创建了 stream row, 出错就归档掉避免残留
        await this.archiveStreamSilently();
        throw new Error(tokenJson.error || `/api/livekit/token ${tokenRes.status}`);
      }

      // ── 4. captureStream → LocalVideoTrack ──
      // captureStream 在 Safari 老版本叫 mozCaptureStream, 这里假定现代浏览器
      type CapturableCanvas = HTMLCanvasElement & {
        captureStream(fps?: number): MediaStream;
      };
      const capCanvas = canvas as CapturableCanvas;
      if (typeof capCanvas.captureStream !== "function") {
        await this.archiveStreamSilently();
        throw new Error("浏览器不支持 canvas.captureStream()");
      }
      const mediaStream = capCanvas.captureStream(opts.fps ?? 30);
      const msVideoTrack = mediaStream.getVideoTracks()[0];
      if (!msVideoTrack) {
        await this.archiveStreamSilently();
        throw new Error("captureStream 没返回 video track");
      }
      this.videoTrack = new LocalVideoTrack(msVideoTrack);

      // ── 5. 可选麦克风 ──
      if (opts.withMic) {
        try {
          this.audioTrack = await createLocalAudioTrack({
            echoCancellation: true,
            noiseSuppression: true,
          });
        } catch (e) {
          console.warn("[publisher] 麦克风启用失败, 继续无音推流:", e);
          this.audioTrack = null;
        }
      }

      // ── 6. 连 LiveKit room ──
      const room = new Room({ adaptiveStream: true, dynacast: true });
      room.on(RoomEvent.Disconnected, () => {
        // 服务器主动断开 (e.g. webhook 发现 publisher 离线 → room_finished)
        this.handleUnexpectedDisconnect();
      });
      await room.connect(livekitUrl, tokenJson.token);
      this.room = room;

      // ── 7. publish video + audio ──
      // 用 ScreenShare source: watch 页 line 99-111 优先订阅这条通道
      await room.localParticipant.publishTrack(this.videoTrack, {
        name: "studio",
        source: Track.Source.ScreenShare,
      });
      if (this.audioTrack) {
        await room.localParticipant.publishTrack(this.audioTrack);
      }

      this.setSnap({
        state: "live",
        roomName,
        watchPath: `/watch/${encodeURIComponent(roomName)}`,
        error: null,
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error("[publisher] start failed:", msg);
      // cleanup 已创建的资源
      this.cleanupTracks();
      this.cleanupRoom();
      this.setSnap({
        state: "error",
        error: msg,
        roomName: null,
        watchPath: null,
      });
      throw e;
    }
  }

  /** 停止推流 — 解绑 + 归档 + 重置 state. */
  async stop(): Promise<void> {
    if (this.snap.state === "idle") return;
    this.setSnap({ state: "stopping" });

    this.cleanupTracks();
    this.cleanupRoom();
    await this.archiveStreamSilently();

    this.setSnap({
      state: "idle",
      roomName: null,
      watchPath: null,
      error: null,
    });
  }

  // ────────────────────────────────────────────────────────────────

  private handleUnexpectedDisconnect() {
    // LiveKit 主动断开 — UI 上变 idle, 不调 /api/streams (服务端自己会清)
    this.cleanupTracks();
    this.room = null;
    this.setSnap({
      state: "idle",
      roomName: null,
      watchPath: null,
      error: null,
    });
  }

  private cleanupTracks() {
    if (this.videoTrack) {
      try { this.videoTrack.stop(); } catch {}
      this.videoTrack = null;
    }
    if (this.audioTrack) {
      try { this.audioTrack.stop(); } catch {}
      this.audioTrack = null;
    }
  }

  private cleanupRoom() {
    if (this.room) {
      try { this.room.disconnect(); } catch {}
      this.room = null;
    }
  }

  private async archiveStreamSilently(): Promise<void> {
    try {
      await fetch("/api/streams", { method: "DELETE" });
    } catch {
      // 服务器不可达就算了 — webhook + verify 层会兜底
    }
  }
}
