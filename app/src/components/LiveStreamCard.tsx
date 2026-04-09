"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { Room, RoomEvent, Track, type RemoteTrack } from "livekit-client";
import { ToolBadge } from "./ToolBadge";
import { CodingTool } from "@/lib/types";
import { useI18n } from "@/lib/i18n/context";

interface LiveStream {
  id: string;
  room_name: string;
  streamer_name: string;
  title: string;
  coding_tool: string;
  status: string;
  viewers_count: number;
  started_at: string;
  thumbnail_url?: string | null;
  profiles?: {
    display_name: string;
    avatar_url: string | null;
    username: string;
    bio: string;
    followers_count: number;
  };
}

// 鼠标移入卡片到真正连接 LiveKit 之间的延时, 防止快速划过整页时
// 触发一堆短命的连接 (LiveKit 房间被冲洗 + 流量浪费)
const HOVER_DEBOUNCE_MS = 400;

export function LiveStreamCard({ stream }: { stream: LiveStream }) {
  const { t } = useI18n();
  const profile = stream.profiles;
  const displayName = profile?.display_name || stream.streamer_name;
  const avatarUrl = profile?.avatar_url;
  // 把 Date.now() 用 useState 包起来, 既满足 react-hooks/purity, 又能让
  // 直播时长每分钟自然刷新一次
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(id);
  }, []);
  const startedAt = new Date(stream.started_at).getTime();
  const elapsed = Math.floor((now - startedAt) / 60000);
  const elapsedStr = elapsed < 60 ? `${elapsed}m` : `${Math.floor(elapsed / 60)}h ${elapsed % 60}m`;

  // ─ Hover preview state ─
  // active = 用户已经持续 hover 超过 debounce 时间, 真正想看
  // (鼠标快速划过不会触发)
  const [hoverActive, setHoverActive] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const onMouseEnter = () => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => setHoverActive(true), HOVER_DEBOUNCE_MS);
  };
  const onMouseLeave = () => {
    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
      debounceRef.current = null;
    }
    setHoverActive(false);
  };

  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, []);

  return (
    <Link
      href={`/watch/${stream.room_name}`}
      className="block group"
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
    >
      <div className="card-glow overflow-hidden bg-bg-card relative pixel-border-live transition-all hover:scale-[1.02]">
        {/* Video placeholder area */}
        <div className="aspect-video bg-bg-primary relative overflow-hidden">
          {stream.thumbnail_url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={stream.thumbnail_url}
              alt={stream.title || stream.room_name}
              className="absolute inset-0 w-full h-full object-cover"
            />
          ) : null}

          {/* Hover preview — 真正接 LiveKit, 渲染实时画面.
              只在 hoverActive=true 时挂载, 卸载时自动 disconnect 房间. */}
          {hoverActive && (
            <HoverPreview roomName={stream.room_name} />
          )}

          <div className="scanline-overlay absolute inset-0 pointer-events-none" />
          <div className="absolute inset-0 ambient-gradient pointer-events-none" />

          {!stream.thumbnail_url && (
            <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
              <span className="font-[family-name:var(--font-pixel)] text-5xl text-accent-green/20">
                {stream.room_name.slice(0, 3).toUpperCase()}
              </span>
              <span className="font-[family-name:var(--font-pixel)] text-[8px] text-accent-green/50 mt-2">
                LIVE · {t('status.screenShare')}
              </span>
            </div>
          )}

          {/* LIVE badge */}
          <div className="absolute top-2 left-2 z-10 flex items-center gap-1.5">
            <span className="viewer-badge text-[8px]">
              <span className="live-dot inline-block w-1.5 h-1.5 rounded-full bg-white" />
              LIVE
            </span>
            <span className="hud-panel px-1.5 py-0.5 font-[family-name:var(--font-pixel)] text-[7px] text-text-secondary">
              👁 {stream.viewers_count}
            </span>
          </div>

          {/* Real stream badge */}
          <div className="absolute top-2 right-2 z-10">
            <span className="bg-accent-green/20 border border-accent-green/40 px-1.5 py-0.5 font-[family-name:var(--font-pixel)] text-[7px] text-accent-green">
              REAL
            </span>
          </div>
        </div>

        {/* Info */}
        <div className="p-3 space-y-2">
          <div className="flex items-start gap-2">
            {avatarUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={avatarUrl} alt="" className="w-8 h-8 object-cover border border-border-pixel shrink-0" />
            ) : (
              <span className="w-8 h-8 bg-accent-purple/30 flex items-center justify-center font-[family-name:var(--font-pixel)] text-[10px] text-accent-purple border border-border-pixel shrink-0">
                {displayName.charAt(0).toUpperCase()}
              </span>
            )}
            <div className="min-w-0 flex-1">
              <h3 className="font-semibold text-sm text-text-primary truncate group-hover:text-accent-green transition-colors">
                {stream.title || stream.room_name}
              </h3>
              <p className="text-xs text-text-secondary truncate">
                {displayName}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 text-[8px] font-[family-name:var(--font-pixel)] text-text-secondary">
            {stream.coding_tool && stream.coding_tool !== "other" && (
              <ToolBadge tool={stream.coding_tool as CodingTool} />
            )}
            <span className="text-accent-yellow">⏱ {elapsedStr}</span>
            <span className="text-border-pixel">│</span>
            <span className="truncate">{stream.room_name}</span>
          </div>
        </div>
      </div>
    </Link>
  );
}

// ─── Hover Preview ────────────────────────────────────────────────
//
// 单卡片的 LiveKit 直连预览. 挂载即连接, 卸载即断开 — 配合 hoverActive
// 控制挂载, 等价于"hover 时启动, 离开时停止".
//
// 设计要点:
//   - identity 加唯一后缀 (`hover-{slug}-{rand}`), 避免同一房间多个 hover
//     用同 identity 互踢
//   - 视频自动以低分辨率送 (LiveKit adaptiveStream 会根据 video 元素大小
//     自动选 layer; 卡片很小, 选最低层)
//   - 出现连接错误 / 没视频 track / 主播刚离开 — 全部 fail-silent, 卡片
//     回到 thumbnail/placeholder, 不影响列表浏览
//   - 浏览器 autoplay 政策: muted + playsInline + autoPlay 三件套必须有
//
// 注意: 这里的 participant 会被 watch 页 viewer count 收录. 我们在 watch
// 页里加了 hover- 前缀过滤来排除掉, 避免主播看到不停跳动的"幽灵观众".
function HoverPreview({ roomName }: { roomName: string }) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [playing, setPlaying] = useState(false);

  useEffect(() => {
    // 把 ref 的当前值快照到本地, 给 cleanup 用 (cleanup 跑时 ref.current
    // 可能已经变成 null, 那是 React 的预期行为)
    const videoEl = videoRef.current;
    let cancelled = false;
    let room: Room | null = null;
    let attachedTrack: RemoteTrack | null = null;

    const connect = async () => {
      try {
        const livekitUrl = process.env.NEXT_PUBLIC_LIVEKIT_URL;
        if (!livekitUrl) return;

        // 唯一 identity, 防止多个 hover 互踢
        const identity = `hover-${roomName}-${Math.random().toString(36).slice(2, 8)}`;

        const tokenRes = await fetch("/api/livekit/token", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            room: roomName,
            identity,
            isPublisher: false,
          }),
        });
        if (!tokenRes.ok || cancelled) return;
        const { token } = await tokenRes.json();
        if (cancelled) return;

        room = new Room({
          adaptiveStream: true,
          dynacast: true,
        });

        const tryAttach = (track: RemoteTrack) => {
          if (cancelled || !videoRef.current) return;
          if (track.kind !== Track.Kind.Video) return;
          if (attachedTrack) return; // 只 attach 一次
          attachedTrack = track;
          track.attach(videoRef.current);
          setPlaying(true);
        };

        room.on(RoomEvent.TrackSubscribed, (track: RemoteTrack) => {
          tryAttach(track);
        });

        await room.connect(livekitUrl, token);
        if (cancelled) {
          room.disconnect();
          room = null;
          return;
        }

        // 房间里可能已经有 publisher 在推流, 直接拿现有 track
        room.remoteParticipants.forEach((p) => {
          p.videoTrackPublications.forEach((pub) => {
            if (pub.track) tryAttach(pub.track);
          });
        });
      } catch {
        // fail silent — 卡片继续显示 thumbnail
      }
    };

    connect();

    return () => {
      cancelled = true;
      if (attachedTrack && videoEl) {
        try {
          attachedTrack.detach(videoEl);
        } catch {}
      }
      if (room) {
        try {
          room.disconnect();
        } catch {}
      }
    };
  }, [roomName]);

  return (
    <video
      ref={videoRef}
      autoPlay
      muted
      playsInline
      className={`absolute inset-0 w-full h-full object-cover transition-opacity duration-300 z-[1] ${
        playing ? "opacity-100" : "opacity-0"
      }`}
    />
  );
}
