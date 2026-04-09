"use client";

import { useState, useCallback, useEffect, useRef } from "react";
import { use } from "react";
import {
  LiveKitRoom,
  VideoTrack,
  RoomAudioRenderer,
  useTracks,
  useParticipants,
  useRoomContext,
} from "@livekit/components-react";
import { Track, RoomEvent } from "livekit-client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ChatMessageRow } from "@/components/watch/chat/ChatMessageRow";
import { createClient } from "@/lib/supabase/client";
import {
  encodeRoomDataMessage,
  parseRoomDataMessage,
  type ChatTimelineMessage,
} from "@/lib/chat/protocol";
import {
  restoreChatTimeline,
  serializeChatTimeline,
} from "@/lib/chat/storage";
import { useNickname } from "@/lib/useNickname";
import { useI18n } from "@/lib/i18n/context";
import type { TranslationKey } from "@/lib/i18n/zh";
import { isViewerParticipant } from "@/lib/participants";
import { resolveViewerIdentity } from "@/lib/livekit/viewerIdentity";
import { mirrorAiAudienceContextEvent } from "@/lib/ai-audience/context";
import {
  ReactionOverlay,
  useReactionSystem,
  REACTION_CONFIG,
  type ReactionKind,
  type OverlayBurst,
  type ComboState,
} from "@/components/ReactionOverlay";

type LayoutMode = "theater" | "default" | "fullscreen";

// 频道数据 (从 /api/channels/[slug] 加载)
interface ChannelData {
  channel: {
    id: string;
    user_id: string;
    slug: string;
    title: string;
    thumbnail_url: string;
    project_name: string;
    project_desc: string;
    project_stage: string;
    project_url: string;
    coding_tool: string;
    settings: Record<string, unknown>;
  };
  profile: {
    id: string;
    username: string;
    display_name: string;
    avatar_url: string | null;
    bio: string;
    followers_count: number;
  } | null;
  liveStream: { started_at: string; viewers_count: number } | null;
  lastSession: {
    title: string;
    project_name: string;
    thumbnail_url: string;
    started_at: string;
    ended_at: string;
    duration_seconds: number;
    peak_viewers: number;
  } | null;
}

const CHAT_TTL_MS = 10 * 60 * 1000; // 10 minutes

// ── Player Controls ──────────────────────────
function PlayerControls({
  videoRef,
  layoutMode,
  onLayoutChange,
}: {
  videoRef: { current: HTMLVideoElement | null };
  layoutMode: LayoutMode;
  onLayoutChange: (mode: LayoutMode) => void;
}) {
  const { t } = useI18n();
  const [paused, setPaused] = useState(false);
  const [muted, setMuted] = useState(false);
  const [volume, setVolume] = useState(100);
  const [showVolume, setShowVolume] = useState(false);
  const [showQuality, setShowQuality] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  // OBS via Ingress 推上来的 track 源是 Camera/Microphone, 不是 ScreenShare.
  // 同时订阅两类源, 优先选浏览器模式的 ScreenShare, fallback 到 OBS 的 Camera.
  const tracks = useTracks(
    [
      Track.Source.ScreenShare,
      Track.Source.ScreenShareAudio,
      Track.Source.Camera,
      Track.Source.Microphone,
    ],
    { onlySubscribed: true }
  );

  const screenTrack =
    tracks.find((tr) => tr.source === Track.Source.ScreenShare) ||
    tracks.find((tr) => tr.source === Track.Source.Camera);

  // Sync fullscreen state
  useEffect(() => {
    const handler = () => setIsFullscreen(!!document.fullscreenElement);
    document.addEventListener("fullscreenchange", handler);
    return () => document.removeEventListener("fullscreenchange", handler);
  }, []);

  const togglePause = () => {
    const player = videoRef.current;
    if (!player) return;
    if (player.paused) {
      player.play();
      setPaused(false);
    } else {
      player.pause();
      setPaused(true);
    }
  };

  const toggleMute = () => {
    const player = videoRef.current;
    if (!player) return;
    const nextMuted = !player.muted;
    player.muted = nextMuted;
    setMuted(nextMuted);
  };

  const changeVolume = (v: number) => {
    const player = videoRef.current;
    if (!player) return;
    player.volume = v / 100;
    player.muted = v === 0;
    setVolume(v);
    setMuted(v === 0);
  };

  const setQuality = (height: number | "auto") => {
    const pub = screenTrack?.publication as { setVideoQuality?: (q: number) => void } | undefined;
    if (!pub?.setVideoQuality) return;
    if (height === "auto") {
      pub.setVideoQuality(2); // HIGH
    } else if (height <= 480) {
      pub.setVideoQuality(0); // LOW
    } else if (height <= 720) {
      pub.setVideoQuality(1); // MEDIUM
    } else {
      pub.setVideoQuality(2); // HIGH
    }
    setShowQuality(false);
  };

  const toggleFullscreen = () => {
    const target = containerRef.current?.closest("[data-player-root]") as HTMLElement;
    if (!target) return;
    if (document.fullscreenElement) {
      document.exitFullscreen();
    } else {
      target.requestFullscreen();
    }
  };

  const toggleTheater = () => {
    if (isFullscreen) {
      document.exitFullscreen();
      return;
    }
    onLayoutChange(layoutMode === "theater" ? "default" : "theater");
  };

  return (
    <div
      ref={containerRef}
      className="absolute bottom-0 left-0 right-0 z-30 bg-gradient-to-t from-black/80 via-black/40 to-transparent px-3 pb-2 pt-8 opacity-0 group-hover:opacity-100 transition-opacity duration-300"
    >
      <div className="flex items-center gap-3">
        {/* Play / Pause */}
        <button onClick={togglePause} className="text-white hover:text-accent-cyan transition-colors" title={paused ? t('btn.play') : t('btn.pause')}>
          {paused ? (
            <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>
          ) : (
            <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/></svg>
          )}
        </button>

        {/* Volume */}
        <div className="relative flex items-center" onMouseEnter={() => setShowVolume(true)} onMouseLeave={() => setShowVolume(false)}>
          <button onClick={toggleMute} className="text-white hover:text-accent-cyan transition-colors" title={muted ? t('btn.unmute') : t('btn.mute')}>
            {muted || volume === 0 ? (
              <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M16.5 12c0-1.77-1.02-3.29-2.5-4.03v2.21l2.45 2.45c.03-.2.05-.41.05-.63zm2.5 0c0 .94-.2 1.82-.54 2.64l1.51 1.51C20.63 14.91 21 13.5 21 12c0-4.28-2.99-7.86-7-8.77v2.06c2.89.86 5 3.54 5 6.71zM4.27 3L3 4.27 7.73 9H3v6h4l5 5v-6.73l4.25 4.25c-.67.52-1.42.93-2.25 1.18v2.06c1.38-.31 2.63-.95 3.69-1.81L19.73 21 21 19.73l-9-9L4.27 3zM12 4L9.91 6.09 12 8.18V4z"/></svg>
            ) : volume < 50 ? (
              <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M18.5 12c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02zM5 9v6h4l5 5V4L9 9H5z"/></svg>
            ) : (
              <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02zM14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z"/></svg>
            )}
          </button>
          {showVolume && (
            <input
              type="range"
              min="0"
              max="100"
              value={muted ? 0 : volume}
              onChange={(e) => changeVolume(Number(e.target.value))}
              className="ml-2 w-20 h-1 accent-accent-cyan cursor-pointer"
            />
          )}
        </div>

        <div className="flex-1" />

        {/* Quality */}
        <div className="relative">
          <button onClick={() => setShowQuality(!showQuality)} className="text-white hover:text-accent-cyan transition-colors text-xs font-[family-name:var(--font-pixel)] text-[8px]" title={t('watch.quality')}>
            HD
          </button>
          {showQuality && (
            <div className="absolute bottom-full right-0 mb-2 pixel-border bg-bg-card py-1 min-w-[100px] z-50">
              {[
                { label: t('watch.qualityAuto'), value: "auto" as const },
                { label: "1080p", value: 1080 },
                { label: "720p", value: 720 },
                { label: "480p", value: 480 },
              ].map((opt) => (
                <button
                  key={opt.label}
                  onClick={() => setQuality(opt.value)}
                  className="block w-full text-left px-3 py-1.5 text-xs text-text-secondary hover:text-text-primary hover:bg-bg-surface transition-colors"
                >
                  {opt.label}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Theater mode (desktop only) */}
        <button onClick={toggleTheater} className="hidden lg:block text-white hover:text-accent-cyan transition-colors" title={layoutMode === "theater" ? t('watch.layoutDefault') : t('watch.layoutTheater')}>
          {layoutMode === "theater" ? (
            <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M19 7H5c-1.1 0-2 .9-2 2v6c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V9c0-1.1-.9-2-2-2zm0 8H5V9h14v6z"/></svg>
          ) : (
            <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M21 3H3c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h18c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm0 16H3V5h18v14zM5 15h14v3H5z"/></svg>
          )}
        </button>

        {/* Fullscreen */}
        <button onClick={toggleFullscreen} className="text-white hover:text-accent-cyan transition-colors" title={isFullscreen ? t('btn.exitFullscreen') : t('btn.fullscreen')}>
          {isFullscreen ? (
            <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M5 16h3v3h2v-5H5v2zm3-8H5v2h5V5H8v3zm6 11h2v-3h3v-2h-5v5zm2-11V5h-2v5h5V8h-3z"/></svg>
          ) : (
            <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M7 14H5v5h5v-2H7v-3zm-2-4h2V7h3V5H5v5zm12 7h-3v2h5v-5h-2v3zM14 5v2h3v3h2V5h-5z"/></svg>
          )}
        </button>
      </div>
    </div>
  );
}

// ── Video Area ───────────────────────────────
function VideoArea({
  layoutMode,
  onLayoutChange,
  bursts,
  showBanner,
  screenFlash,
  screenShake,
}: {
  layoutMode: LayoutMode;
  onLayoutChange: (mode: LayoutMode) => void;
  bursts: OverlayBurst[];
  showBanner: { icon: string; count: number; color: string } | null;
  screenFlash: boolean;
  screenShake: boolean;
}) {
  // OBS via Ingress 推上来的 track 源是 Camera, 不是 ScreenShare.
  // 同时订阅两类源, 优先选浏览器模式的 ScreenShare, fallback 到 OBS 的 Camera.
  const tracks = useTracks(
    [
      Track.Source.ScreenShare,
      Track.Source.ScreenShareAudio,
      Track.Source.Camera,
      Track.Source.Microphone,
    ],
    { onlySubscribed: true }
  );
  const participants = useParticipants();
  // isViewerParticipant 排除主播/OBS ingress (canPublish), AI audience bot
  // (ai-audience: 前缀), 以及首页 hover 卡片的临时连接 (hover- 前缀, commit 0e7cd81).
  const viewerCount = participants.filter(isViewerParticipant).length;
  const videoRef = useRef<HTMLVideoElement | null>(null);

  // 主画面: 优先 ScreenShare, 没有再退到 Camera (OBS 模式)
  // 主播脸 (PiP): 仅当 ScreenShare 是主画面时, Camera 作为右下角小窗
  //   - 浏览器模式开了摄像头: ScreenShare 主 + Camera PiP
  //   - 仅屏幕共享: ScreenShare 主, 无 PiP
  //   - 仅 Camera (OBS 或浏览器只开摄像头): Camera 主, 无 PiP
  const screenShareTrack = tracks.find(
    (tr) => tr.source === Track.Source.ScreenShare
  );
  const cameraTrack = tracks.find((tr) => tr.source === Track.Source.Camera);
  const screenTrack = screenShareTrack || cameraTrack;
  const faceCamTrack = screenShareTrack ? cameraTrack : undefined;

  // Capture the video element from VideoTrack via callback ref
  const videoContainerRef = useCallback((node: HTMLDivElement | null) => {
    if (node) {
      const vid = node.querySelector("video");
      if (vid) videoRef.current = vid;
    }
  }, []);

  if (!screenTrack) {
    return (
      <div className="relative w-full h-full bg-bg-primary group">
        <div className="scanline-overlay absolute inset-0" />
        <div className="absolute inset-0 ambient-gradient" />
        <div className="absolute inset-0 flex flex-col items-center justify-center z-10">
          <span className="text-4xl mb-4">📡</span>
          <span className="font-[family-name:var(--font-pixel)] text-[11px] text-accent-yellow glow-purple animate-pulse">
            等待主播开始屏幕共享...
          </span>
        </div>
        <div className="absolute top-3 left-3 z-20">
          <span className="hud-panel px-2 py-1 font-[family-name:var(--font-pixel)] text-[8px] text-text-secondary">
            👁 {viewerCount}
          </span>
        </div>
      </div>
    );
  }

  return (
    <div className={`relative w-full h-full bg-bg-primary group ${screenFlash ? "screen-flash" : ""} ${screenShake ? "video-shake" : ""}`} ref={videoContainerRef}>
      <VideoTrack trackRef={screenTrack} className="w-full h-full object-contain" />
      {/* Face cam PiP — 主播脸的小窗, 右下角, 屏幕共享时才显示 */}
      {faceCamTrack && (
        <div className="absolute bottom-3 right-3 z-30 w-32 sm:w-40 md:w-48 aspect-video pixel-border bg-bg-primary overflow-hidden shadow-lg pointer-events-none">
          <VideoTrack
            trackRef={faceCamTrack}
            className="w-full h-full object-cover"
          />
          <span className="absolute top-1 left-1 font-[family-name:var(--font-pixel)] text-[7px] text-accent-yellow bg-black/40 px-1 py-0.5">
            CAM
          </span>
        </div>
      )}
      <ReactionOverlay bursts={bursts} showBanner={showBanner} screenFlash={screenFlash} />

      {/* HUD */}
      <div className="absolute top-3 left-3 z-20 flex items-center gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
        <span className="viewer-badge text-[9px]">
          <span className="live-dot inline-block w-2 h-2 rounded-full bg-white" />
          LIVE
        </span>
        <span className="hud-panel px-2 py-1 font-[family-name:var(--font-pixel)] text-[8px] text-text-secondary">
          👁 {viewerCount}
        </span>
      </div>

      {/* Player controls */}
      <PlayerControls
        videoRef={videoRef}
        layoutMode={layoutMode}
        onLayoutChange={onLayoutChange}
      />
    </div>
  );
}

// ── Sidebar (Chat / Info / Users tabs) ───────
const STAGES_DATA = [
  { value: "构思中", labelKey: "goLive.stage.idea" },
  { value: "设计中", labelKey: "goLive.stage.design" },
  { value: "编码中", labelKey: "goLive.stage.coding" },
  { value: "调试中", labelKey: "goLive.stage.debug" },
  { value: "测试中", labelKey: "goLive.stage.testing" },
  { value: "发布中", labelKey: "goLive.stage.deploy" },
  { value: "已完成", labelKey: "goLive.stage.done" },
];

function Sidebar({ viewerName, roomName, addReaction, combo, aiAudienceEnabled, streamStartedAt }: {
  viewerName: string;
  roomName: string;
  addReaction: (kind: ReactionKind) => void;
  combo: ComboState;
  aiAudienceEnabled: boolean;
  streamStartedAt: string | null;
}) {
  const { t } = useI18n();
  const room = useRoomContext();
  const participants = useParticipants();
  // 见 isViewerParticipant: 排除主播/OBS ingress, AI audience bot, hover 预览.
  const viewers = participants.filter(isViewerParticipant);
  const [tab, setTab] = useState<"chat" | "info" | "users">("chat");
  const decodedRoom = decodeURIComponent(roomName);
  const chatStorageKey = `vibelive-chat-${decodedRoom}`;
  const [messages, setMessages] = useState<ChatTimelineMessage[]>([]);
  const [input, setInput] = useState("");
  const [streamInfo, setStreamInfo] = useState<{
    project_name?: string; description?: string; stage?: string; streamer_name?: string; started_at?: string; user_id?: string;
  } | null>(null);
  const [isStreamer, setIsStreamer] = useState(false);
  const [isFollowing, setIsFollowing] = useState(false);
  const [isFavorited, setIsFavorited] = useState(false);
  const [saving, setSaving] = useState(false);
  const [ending, setEnding] = useState(false);
  const [showEndConfirm, setShowEndConfirm] = useState(false);
  const router = useRouter();
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Click-time scatter particles — anchored to viewport via fixed positioning,
  // so they're visible even on mobile chat tab where the video overlay is hidden.
  type ClickBurstParticle = {
    id: string;
    x: number; y: number;       // origin in viewport px
    dx: number; dy: number;     // outward target offset
    icon: string;
    glow: string;
  };
  const [clickBursts, setClickBursts] = useState<ClickBurstParticle[]>([]);
  const spawnClickBurst = useCallback((rect: DOMRect, kind: ReactionKind) => {
    const cfg = REACTION_CONFIG[kind];
    if (!cfg) return;
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    const burstCount = 5;
    const newBursts: ClickBurstParticle[] = Array.from({ length: burstCount }, (_, i) => {
      // Upward cone: -90° ± 72°
      const angle = -Math.PI / 2 + (Math.random() - 0.5) * 0.8 * Math.PI;
      const distance = 38 + Math.random() * 38;
      return {
        id: `cb-${Date.now()}-${i}-${Math.random()}`,
        x: cx + (Math.random() - 0.5) * 12,
        y: cy,
        dx: Math.cos(angle) * distance,
        dy: Math.sin(angle) * distance,
        icon: cfg.icon,
        glow: cfg.glowVar,
      };
    });
    setClickBursts(prev => [...prev.slice(-40), ...newBursts]);
    const ids = new Set(newBursts.map(b => b.id));
    setTimeout(() => setClickBursts(prev => prev.filter(b => !ids.has(b.id))), 820);
  }, []);

  // Long-press / hold-to-spam — IG/TikTok/YouTube Live pattern.
  // Tap = single reaction. Hold = continuous fire at ~8/sec until release.
  // First fire is immediate; auto-fire kicks in after a 240ms grace so a
  // quick tap doesn't accidentally double-fire.
  const holdRef = useRef<{ timeoutId?: ReturnType<typeof setTimeout>; intervalId?: ReturnType<typeof setInterval> }>({});
  const endHold = useCallback(() => {
    if (holdRef.current.timeoutId) clearTimeout(holdRef.current.timeoutId);
    if (holdRef.current.intervalId) clearInterval(holdRef.current.intervalId);
    holdRef.current = {};
  }, []);
  // Cleanup any in-flight hold on unmount so navigating away mid-spam stops the interval
  useEffect(() => endHold, [endHold]);

  // Debounced save for streamer editing
  const saveField = useCallback(
    (fields: Record<string, string>) => {
      if (!isStreamer) return;
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
      saveTimerRef.current = setTimeout(async () => {
        setSaving(true);
        await fetch("/api/streams", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ room_name: decodedRoom, ...fields }),
        }).catch(() => {});
        setSaving(false);
      }, 600);
    },
    [decodedRoom, isStreamer]
  );

  const updateField = (key: string, value: string) => {
    setStreamInfo((prev) => (prev ? { ...prev, [key]: value } : prev));
    saveField({ [key]: value });
  };

  // Fetch stream info + check if current user is the streamer
  useEffect(() => {
    const fetchInfo = async () => {
      try {
        const res = await fetch("/api/streams");
        if (res.ok) {
          const { streams } = await res.json();
          const match = streams.find((s: { room_name: string }) => s.room_name === decodedRoom);
          if (match) {
            setStreamInfo(match);
            // Check ownership via Supabase
            if (match.user_id) {
              const supabase = createClient();
              if (supabase) {
                const { data } = await supabase.auth.getUser();
                const isOwner = data.user?.id === match.user_id;
                setIsStreamer(isOwner);

                // Check follow/favorite status
                if (data.user && !isOwner) {
                  fetch(`/api/follows?following_id=${match.user_id}`)
                    .then(r => r.json()).then(d => setIsFollowing(d.isFollowing)).catch(() => {});
                  fetch(`/api/favorites?room_name=${encodeURIComponent(decodedRoom)}`)
                    .then(r => r.json()).then(d => setIsFavorited(d.isFavorited)).catch(() => {});
                }
              }
            }
          }
        }
      } catch {}
    };
    fetchInfo();
    const interval = setInterval(fetchInfo, 15000);
    return () => clearInterval(interval);
  }, [decodedRoom]);

  // Data channel messages — skip messages from self (already added locally in sendChat/sendReaction)
  useEffect(() => {
    const handleData = (payload: Uint8Array, participant?: { identity: string }) => {
      if (participant?.identity === room.localParticipant.identity) return;
      const msg = parseRoomDataMessage(payload);
      if (!msg) return;
      if (msg.type === "chat") {
        setMessages((prev) => [
          ...prev.slice(-200),
          {
            id: `${Date.now()}-${Math.random()}`,
            user: msg.user,
            text: msg.text.slice(0, 500),
            time: Date.now(),
            bot: msg.bot,
            botPersona: msg.botPersona,
          },
        ]);
      } else if (msg.type === "reaction") {
        const kind = msg.kind as ReactionKind;
        if (!REACTION_CONFIG[kind]) return;
        addReaction(kind);
      }
    };
    room.on(RoomEvent.DataReceived, handleData);
    return () => { room.off(RoomEvent.DataReceived, handleData); };
  }, [addReaction, room]);

  // Persist messages to localStorage (keep only last 10 min)
  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      const raw = localStorage.getItem(chatStorageKey);
      setMessages(
        restoreChatTimeline({
          raw,
          sessionStartedAt: streamStartedAt,
          ttlMs: CHAT_TTL_MS,
        }).slice(-200),
      );
    } catch {
      setMessages([]);
    }
  }, [chatStorageKey, streamStartedAt]);

  useEffect(() => {
    try {
      localStorage.setItem(
        chatStorageKey,
        serializeChatTimeline({
          messages: messages.slice(-200),
          sessionStartedAt: streamStartedAt,
          ttlMs: CHAT_TTL_MS,
        }),
      );
    } catch {}
  }, [messages, chatStorageKey, streamStartedAt]);

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [messages]);

  const sendChat = () => {
    const text = input.trim();
    if (!text) return;
    const payload = encodeRoomDataMessage({
      type: "chat",
      user: viewerName,
      text,
    });
    room.localParticipant.publishData(payload, { reliable: true });
    setMessages((prev) => [
      ...prev.slice(-200),
      { id: `${Date.now()}-${Math.random()}`, user: viewerName, text, time: Date.now() },
    ]);
    if (aiAudienceEnabled) {
      void mirrorAiAudienceContextEvent({
        roomSlug: decodedRoom,
        kind: "chat_message",
        user: viewerName,
        text,
        bot: false,
      }).catch(() => {});
    }
    setInput("");
  };

  const sendReaction = (kind: ReactionKind) => {
    const payload = encodeRoomDataMessage({
      type: "reaction",
      kind,
      user: viewerName,
    });
    room.localParticipant.publishData(payload, { reliable: true });
    addReaction(kind);
    if (aiAudienceEnabled) {
      void mirrorAiAudienceContextEvent({
        roomSlug: decodedRoom,
        kind: "reaction",
        user: viewerName,
        reactionKind: kind,
      }).catch(() => {});
    }
  };

  const endStream = async () => {
    setEnding(true);
    try {
      const res = await fetch("/api/streams", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ room_name: decodedRoom }),
      });
      if (!res.ok) throw new Error();
      // Clean up go-live localStorage so it doesn't try to reconnect
      localStorage.removeItem("vibelive_active_stream");
      // Server-side DELETE also removes the LiveKit room, disconnecting all participants
      router.push("/");
    } catch {
      setEnding(false);
      setShowEndConfirm(false);
    }
  };

  const formatTime = (ts: number) => {
    const d = new Date(ts);
    return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  };

  const tabs = [
    { key: "chat" as const, label: t('watch.tabChat'), icon: "💬" },
    { key: "info" as const, label: t('watch.tabProject'), icon: "◈" },
    { key: "users" as const, label: `${t('watch.online')} ${viewers.length}`, icon: "◉" },
  ];

  return (
    <div className="flex flex-col h-full pixel-border bg-bg-card">
      {/* Tabs */}
      <div className="flex border-b border-border-pixel/50 shrink-0">
        {tabs.map((tb) => (
          <button
            key={tb.key}
            onClick={() => setTab(tb.key)}
            className={`flex-1 px-2 py-2 text-[10px] font-[family-name:var(--font-pixel)] transition-colors ${
              tab === tb.key
                ? "text-accent-cyan border-b-2 border-accent-cyan"
                : "text-text-secondary hover:text-text-primary"
            }`}
          >
            <span className="mr-1">{tb.icon}</span>{tb.label}
          </button>
        ))}
      </div>

      {/* ── Chat Tab ── */}
      {tab === "chat" && (
        <>
          <div ref={scrollRef} className="flex-1 overflow-y-auto px-3 py-2 space-y-2 min-h-0">
            {messages.length === 0 && (
              <p className="text-xs text-text-secondary/40 text-center py-8">还没有消息，说点什么吧</p>
            )}
            {messages.map((msg) => (
              <ChatMessageRow
                key={msg.id}
                message={msg}
                timestampLabel={formatTime(msg.time)}
              />
            ))}
          </div>

          {/* Reaction strip — compact icon-only, supports tap = single, hold = continuous spam.
              Mirrors IG/TikTok/YouTube Live: chat is the protagonist, reactions stay out of the way. */}
          <div className="px-3 py-1 border-t border-border-pixel/50 flex items-center justify-between gap-1 shrink-0">
            {(Object.entries(REACTION_CONFIG) as [ReactionKind, { label: string; icon: string; color: string; glowVar: string }][]).map(
              ([kind, { icon, color, glowVar }]) => {
                const tier = combo[kind]?.tier || 0;
                const count = combo[kind]?.timestamps.length || 0;
                const comboClass = tier >= 3 ? "reaction-btn-combo-3" : tier >= 2 ? "reaction-btn-combo-2" : tier >= 1 ? "reaction-btn-combo-1" : "";

                const fireOnce = (btn: HTMLElement) => {
                  spawnClickBurst(btn.getBoundingClientRect(), kind);
                  sendReaction(kind);
                };
                const startHold = (btn: HTMLElement) => {
                  endHold();
                  // Immediate first fire + one-shot haptic at the start of the gesture
                  fireOnce(btn);
                  if (typeof navigator !== "undefined" && navigator.vibrate) {
                    try { navigator.vibrate(12); } catch {}
                  }
                  // Auto-fire kicks in after a 240ms grace so quick taps are clearly single-fires
                  holdRef.current.timeoutId = setTimeout(() => {
                    holdRef.current.intervalId = setInterval(() => fireOnce(btn), 125); // ~8/sec
                  }, 240);
                };

                return (
                  <button
                    key={kind}
                    type="button"
                    onPointerDown={(e) => {
                      // Capture the pointer so we still get pointerup even if user drags off
                      (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
                      startHold(e.currentTarget as HTMLElement);
                    }}
                    onPointerUp={endHold}
                    onPointerCancel={endHold}
                    onPointerLeave={endHold}
                    onContextMenu={(e) => e.preventDefault()}
                    title={t(`reaction.${kind}`)}
                    aria-label={t(`reaction.${kind}`)}
                    className={`relative flex items-center justify-center gap-0.5 h-8 min-w-[36px] px-2 rounded text-base leading-none select-none touch-manipulation transition-transform duration-150 hover:scale-110 active:scale-90 ${comboClass}`}
                    style={{
                      backgroundColor: tier > 0
                        ? `color-mix(in srgb, var(--${color}) ${10 + tier * 7}%, transparent)`
                        : "transparent",
                      WebkitTapHighlightColor: "transparent",
                      "--glow-color": glowVar,
                    } as React.CSSProperties}
                  >
                    <span>{icon}</span>
                    {tier >= 1 && (
                      <span
                        className="font-[family-name:var(--font-pixel)] text-[7px] tabular-nums leading-none"
                        style={{ color: `var(--${color})` }}
                      >
                        ×{count}
                      </span>
                    )}
                  </button>
                );
              }
            )}
          </div>

          <div className="px-3 py-2 border-t border-border-pixel/50 shrink-0">
            <form onSubmit={(e) => { e.preventDefault(); sendChat(); }} className="flex gap-2">
              <input type="text" value={input} onChange={(e) => setInput(e.target.value)}
                placeholder={t('chat.placeholder')}
                className="flex-1 bg-bg-primary border border-border-pixel px-2 py-1.5 text-xs text-text-primary placeholder:text-text-secondary/30 focus:border-accent-cyan focus:outline-none" />
              <button type="submit"
                className="px-3 py-1.5 bg-accent-cyan/20 border border-accent-cyan/40 text-accent-cyan text-xs hover:bg-accent-cyan/30 transition-colors">
                {t('chat.send')}
              </button>
            </form>
          </div>
        </>
      )}

      {/* ── Info Tab ── */}
      {tab === "info" && (
        <div className="flex-1 overflow-y-auto px-3 py-3 space-y-4">
          {streamInfo ? (
            <>
              {/* Streamer management panel */}
              {isStreamer && (
                <div className="space-y-2">
                  <div className="flex items-center gap-2">
                    <span className="font-[family-name:var(--font-pixel)] text-[7px] text-accent-green bg-accent-green/10 border border-accent-green/30 px-2 py-0.5">
                      主播模式 · 可编辑
                    </span>
                    {saving && (
                      <span className="font-[family-name:var(--font-pixel)] text-[7px] text-accent-yellow animate-pulse ml-auto">保存中...</span>
                    )}
                  </div>
                  {/* Stream controls */}
                  <div className="flex gap-2">
                    <Link
                      href="/go-live"
                      className="flex-1 text-center py-1.5 text-[10px] font-[family-name:var(--font-pixel)] border border-accent-cyan/40 text-accent-cyan hover:bg-accent-cyan/10 transition-colors"
                    >
                      {t('goLive.title')}
                    </Link>
                    {!showEndConfirm ? (
                      <button
                        onClick={() => setShowEndConfirm(true)}
                        className="flex-1 py-1.5 text-[10px] font-[family-name:var(--font-pixel)] border border-accent-pink/40 text-accent-pink hover:bg-accent-pink/10 transition-colors"
                      >
                        下播
                      </button>
                    ) : (
                      <div className="flex-1 flex gap-1">
                        <button
                          onClick={endStream}
                          disabled={ending}
                          className="flex-1 py-1.5 text-[10px] font-[family-name:var(--font-pixel)] bg-accent-pink/20 border border-accent-pink text-accent-pink hover:bg-accent-pink hover:text-white transition-colors disabled:opacity-50"
                        >
                          {ending ? t('btn.ending') : t('btn.confirmEnd')}
                        </button>
                        <button
                          onClick={() => setShowEndConfirm(false)}
                          className="px-2 py-1.5 text-[10px] font-[family-name:var(--font-pixel)] border border-border-pixel text-text-secondary hover:text-text-primary transition-colors"
                        >
                          取消
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* Project name */}
              <div>
                <span className="font-[family-name:var(--font-pixel)] text-[8px] text-text-secondary">{t('goLive.projectName')}</span>
                {isStreamer ? (
                  <input
                    type="text"
                    value={streamInfo.project_name || ""}
                    onChange={(e) => updateField("project_name", e.target.value)}
                    placeholder={t('goLive.projectQuestion')}
                    className="w-full mt-1 bg-bg-primary border border-border-pixel px-2 py-1.5 text-sm text-text-primary placeholder:text-text-secondary/30 focus:border-accent-purple focus:outline-none transition-colors"
                  />
                ) : (
                  <p className="text-sm text-text-primary mt-1">
                    {streamInfo.project_name || <span className="text-text-secondary/40">未设置</span>}
                  </p>
                )}
              </div>

              {/* Stage */}
              <div>
                <span className="font-[family-name:var(--font-pixel)] text-[8px] text-text-secondary">{t('goLive.projectStage')}</span>
                {isStreamer ? (
                  <div className="flex flex-wrap gap-1 mt-1">
                    {STAGES_DATA.map((s) => (
                      <button
                        key={s.value}
                        onClick={() => updateField("stage", s.value)}
                        className={`px-1.5 py-0.5 text-[10px] border transition-colors ${
                          streamInfo.stage === s.value
                            ? "border-accent-cyan text-accent-cyan bg-accent-cyan/10"
                            : "border-border-pixel text-text-secondary hover:border-text-secondary"
                        }`}
                      >
                        {t(s.labelKey as TranslationKey)}
                      </button>
                    ))}
                  </div>
                ) : (
                  <p className="mt-1">
                    <span className="px-2 py-0.5 text-xs border border-accent-cyan/40 text-accent-cyan bg-accent-cyan/10">
                      {(() => {
                        const stageValue = streamInfo.stage || "构思中";
                        const match = STAGES_DATA.find(s => s.value === stageValue);
                        return match ? t(match.labelKey as TranslationKey) : stageValue;
                      })()}
                    </span>
                  </p>
                )}
              </div>

              {/* Description */}
              <div>
                <span className="font-[family-name:var(--font-pixel)] text-[8px] text-text-secondary">{t('goLive.projectDesc')}</span>
                {isStreamer ? (
                  <textarea
                    value={streamInfo.description || ""}
                    onChange={(e) => updateField("description", e.target.value)}
                    placeholder={t('goLive.projectDescPlaceholder')}
                    rows={4}
                    className="w-full mt-1 bg-bg-primary border border-border-pixel px-2 py-1.5 text-xs text-text-primary placeholder:text-text-secondary/30 focus:border-accent-purple focus:outline-none transition-colors resize-none"
                  />
                ) : (
                  <p className="text-xs text-text-primary/80 mt-1 leading-relaxed whitespace-pre-wrap">
                    {streamInfo.description || <span className="text-text-secondary/40">主播还没写描述</span>}
                  </p>
                )}
              </div>

              <div className="border-t border-border-pixel/30 pt-3">
                <span className="font-[family-name:var(--font-pixel)] text-[8px] text-text-secondary">{t('stream.streamer')}</span>
                <p className="text-sm text-accent-purple mt-1">{streamInfo.streamer_name}</p>
              </div>
              {streamInfo.started_at && (
                <div>
                  <span className="font-[family-name:var(--font-pixel)] text-[8px] text-text-secondary">开播时间</span>
                  <p className="text-xs text-text-secondary mt-1">
                    {new Date(streamInfo.started_at).toLocaleString("zh-CN")}
                  </p>
                </div>
              )}

              {/* Follow + Favorite buttons */}
              {!isStreamer && streamInfo.user_id && (
                <div className="border-t border-border-pixel/30 pt-3 flex gap-2">
                  <button
                    onClick={async () => {
                      const method = isFollowing ? "DELETE" : "POST";
                      const res = await fetch("/api/follows", {
                        method,
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ following_id: streamInfo.user_id }),
                      });
                      if (res.ok) setIsFollowing(!isFollowing);
                    }}
                    className={`flex-1 py-1.5 text-[10px] font-[family-name:var(--font-pixel)] border transition-colors ${
                      isFollowing
                        ? "border-text-secondary text-text-secondary bg-bg-surface"
                        : "border-accent-pink text-accent-pink hover:bg-accent-pink hover:text-white"
                    }`}
                  >
                    {isFollowing ? t('btn.following') : t('btn.follow')}
                  </button>
                  <button
                    onClick={async () => {
                      const method = isFavorited ? "DELETE" : "POST";
                      const res = await fetch("/api/favorites", {
                        method,
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({
                          room_name: decodedRoom,
                          stream_title: streamInfo.project_name || streamInfo.streamer_name,
                          streamer_name: streamInfo.streamer_name,
                        }),
                      });
                      if (res.ok) setIsFavorited(!isFavorited);
                    }}
                    className={`flex-1 py-1.5 text-[10px] font-[family-name:var(--font-pixel)] border transition-colors ${
                      isFavorited
                        ? "border-accent-yellow text-bg-primary bg-accent-yellow"
                        : "border-accent-yellow text-accent-yellow hover:bg-accent-yellow hover:text-bg-primary"
                    }`}
                  >
                    {isFavorited ? t('btn.favorited') : t('btn.favorite')}
                  </button>
                </div>
              )}
            </>
          ) : (
            <p className="text-xs text-text-secondary/40 text-center py-8">加载中...</p>
          )}
        </div>
      )}

      {/* ── Users Tab ── */}
      {/* 只列出真正的观众 — 主播 / OBS 推流端不在这里展示, 它们的"在线"状态
          通过视频是否在播放体现 */}
      {tab === "users" && (
        <div className="flex-1 overflow-y-auto px-3 py-2 space-y-1 min-h-0">
          {viewers.length === 0 && (
            <p className="text-xs text-text-secondary/40 text-center py-8">
              还没有观众
            </p>
          )}
          {viewers.map((p) => (
            <div
              key={p.identity}
              className="flex items-center gap-2 px-2 py-1.5 hover:bg-bg-surface/50 transition-colors"
            >
              <span className="w-2 h-2 rounded-full shrink-0 bg-accent-cyan" />
              <span className="text-xs text-text-primary truncate flex-1">
                {/* identity 是 `viewer-<nick>-<rand>` 的去重 ID,显示用 name */}
                {p.name || p.identity}
              </span>
            </div>
          ))}
        </div>
      )}

      {/* Click-burst particles — viewport-anchored, work even when chat tab hides the video */}
      {clickBursts.map((b) => (
        <span
          key={b.id}
          className="click-scatter-particle"
          style={{
            left: `${b.x}px`,
            top: `${b.y}px`,
            "--scatter-x": `${b.dx}px`,
            "--scatter-y": `${b.dy}px`,
            "--scatter-glow": b.glow,
          } as React.CSSProperties}
        >
          {b.icon}
        </span>
      ))}
    </div>
  );
}

// ── Constants ────────────────────────────────
// ── Watch Layout (handles desktop/mobile) ────
function WatchLayout({
  layoutMode, onLayoutChange, mobilePanel, onMobilePanelChange, identity, roomName,
  aiAudienceEnabled,
  streamStartedAt,
}: {
  layoutMode: LayoutMode;
  onLayoutChange: (m: LayoutMode) => void;
  mobilePanel: "video" | "chat";
  onMobilePanelChange: (p: "video" | "chat") => void;
  identity: string;
  roomName: string;
  aiAudienceEnabled: boolean;
  streamStartedAt: string | null;
}) {
  const { t } = useI18n();
  const [desktop, setDesktop] = useState(false);
  const { bursts, combo, showBanner, screenFlash, screenShake, addReaction } = useReactionSystem();

  useEffect(() => {
    const check = () => setDesktop(window.innerWidth >= 1024);
    check();
    window.addEventListener("resize", check);
    return () => window.removeEventListener("resize", check);
  }, []);

  const videoProps = { bursts, showBanner, screenFlash, screenShake };
  const sidebarProps = {
    viewerName: identity,
    roomName,
    addReaction,
    combo,
    aiAudienceEnabled,
    streamStartedAt,
  };

  if (desktop) {
    if (layoutMode === "theater") {
      return (
        <div className="flex flex-1 min-h-0">
          <div className="flex-1 min-w-0 pixel-border-live m-2 mr-0 overflow-hidden">
            <VideoArea layoutMode={layoutMode} onLayoutChange={onLayoutChange} {...videoProps} />
          </div>
          <div className="w-[320px] shrink-0 m-2 flex flex-col">
            <Sidebar {...sidebarProps} />
          </div>
        </div>
      );
    }
    return (
      <div className="flex-1 overflow-y-auto">
        <div className="mx-auto max-w-[960px] px-4 py-3 space-y-3">
          <div className="pixel-border-live aspect-video overflow-hidden">
            <VideoArea layoutMode={layoutMode} onLayoutChange={onLayoutChange} {...videoProps} />
          </div>
          <div className="h-[400px]">
            <Sidebar {...sidebarProps} />
          </div>
        </div>
      </div>
    );
  }

  // Mobile
  if (mobilePanel === "video") {
    return (
      <div className="flex flex-col flex-1 min-h-0">
        <div className="pixel-border-live m-1 aspect-video overflow-hidden shrink-0">
          <VideoArea layoutMode="default" onLayoutChange={onLayoutChange} {...videoProps} />
        </div>
        <div className="px-2 py-1 flex items-center gap-2">
          <span className="font-[family-name:var(--font-pixel)] text-[8px] text-text-secondary truncate flex-1">
            {decodeURIComponent(roomName)}
          </span>
          <button
            onClick={() => onMobilePanelChange("chat")}
            className="px-2 py-1 text-[9px] border border-accent-cyan text-accent-cyan font-[family-name:var(--font-pixel)]"
          >
            💬 {t('watch.tabChat')}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col flex-1 min-h-0 m-1">
      <Sidebar {...sidebarProps} />
    </div>
  );
}

// ── Main Page ────────────────────────────────
export default function WatchPage({
  params,
}: {
  params: Promise<{ room: string }>;
}) {
  const { t } = useI18n();
  const { room: roomName } = use(params);
  const slug = decodeURIComponent(roomName).toLowerCase();
  const { nickname: profileName, userId } = useNickname();
  const [token, setToken] = useState<string | null>(null);
  const [identity, setIdentity] = useState("");
  const [joined, setJoined] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [layoutMode, setLayoutMode] = useState<LayoutMode>("theater");
  const [mobilePanel, setMobilePanel] = useState<"video" | "chat">("video");

  // 频道数据状态: undefined=加载中, null=不存在, 有值=已加载
  const [channelData, setChannelData] = useState<ChannelData | null | undefined>(undefined);

  const livekitUrl = process.env.NEXT_PUBLIC_LIVEKIT_URL;
  const isOwnerSelfWatch =
    !!userId && !!channelData && userId === channelData.channel.user_id;
  const aiAudienceEnabled =
    channelData?.channel.settings.ai_audience_enabled === true;

  // ─ 拉取频道 + 当前直播会话, 并轮询以便检测主播开播 ─
  useEffect(() => {
    let cancelled = false;
    const fetchChannel = async () => {
      try {
        const res = await fetch(`/api/channels/${encodeURIComponent(slug)}`);
        if (!res.ok) {
          if (!cancelled) setChannelData(null); // 不存在
          return;
        }
        const data = (await res.json()) as ChannelData;
        if (!cancelled) setChannelData(data);
      } catch {
        if (!cancelled) setChannelData(null);
      }
    };
    fetchChannel();
    // 离线时定期重拉, 检测主播是否开播
    const interval = setInterval(fetchChannel, 15000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [slug]);

  const joinWithName = useCallback(async (name: string) => {
    const rawViewerName = name.trim() || `观众${Math.floor(Math.random() * 9999)}`;
    const viewerSession = resolveViewerIdentity(rawViewerName, {
      isOwnerSelfWatch,
      uniqueSuffix: Math.random().toString(36).slice(2, 6),
    });
    try {
      const res = await fetch("/api/livekit/token", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          room: slug,
          identity: viewerSession.transportIdentity,
          isPublisher: false,
        }),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || t('error.tokenFailed'));
      }
      const data = await res.json();
      setToken(data.token);
      setIdentity(viewerSession.displayName);
      setJoined(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : t('error.joinFailed'));
      setLoading(false);
    }
  }, [isOwnerSelfWatch, slug, t]);

  // 自动加入: 仅当频道存在且正在直播
  useEffect(() => {
    if (profileName === null) return; // nickname 还在加载
    if (joined) return;
    if (!channelData || !channelData.liveStream) return; // 频道不存在或离线
    if (profileName) {
      joinWithName(profileName);
    } else {
      setLoading(false);
    }
  }, [profileName, channelData, joined, joinWithName]);

  const handleJoin = useCallback(() => {
    joinWithName(identity);
  }, [identity, joinWithName]);

  // ─ 加载中 ─
  if (channelData === undefined) {
    return (
      <div className="ambient-gradient min-h-screen flex items-center justify-center">
        <span className="font-[family-name:var(--font-pixel)] text-[11px] text-accent-cyan animate-pulse">
          {t("nav.loading")}
        </span>
      </div>
    );
  }

  // ─ 频道不存在 ─
  if (channelData === null) {
    return <ChannelNotFound slug={slug} />;
  }

  // ─ 频道存在但主播未开播: 显示频道主页 ─
  if (!channelData.liveStream) {
    return <OfflineChannelPage data={channelData} />;
  }

  // ─ 直播中: 沿用原来的 LiveKit 加入流程 ─
  // 此处需要 token, 还在加载/获取阶段
  if (loading && !joined) {
    return (
      <div className="ambient-gradient min-h-screen flex items-center justify-center">
        <span className="font-[family-name:var(--font-pixel)] text-[11px] text-accent-cyan animate-pulse">
          正在加入直播间...
        </span>
      </div>
    );
  }

  // Join screen
  if (!joined) {
    return (
      <div className="ambient-gradient min-h-screen">
        <div className="mx-auto max-w-[600px] px-4 py-12">
          <div className="flex items-center gap-3 mb-6">
            <Link href="/" className="font-[family-name:var(--font-pixel)] text-[8px] text-text-secondary hover:text-accent-cyan transition-colors">
              ◁ {t('nav.backToHome')}
            </Link>
          </div>
          <div className="pixel-border bg-bg-card p-6 space-y-5">
            <div className="text-center space-y-2">
              <span className="font-[family-name:var(--font-pixel)] text-[12px] text-accent-cyan glow-cyan">加入直播间</span>
              <p className="text-sm text-text-secondary">
                房间: <span className="text-accent-green">{decodeURIComponent(roomName)}</span>
              </p>
            </div>
            <div>
              <label className="block text-xs text-text-secondary mb-1.5">你的昵称</label>
              <input
                type="text"
                value={identity}
                onChange={(e) => setIdentity(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleJoin()}
                placeholder={t('watch.enterNickname')}
                className="w-full bg-bg-primary border-2 border-border-pixel px-3 py-2 text-sm text-text-primary placeholder:text-text-secondary/40 focus:border-accent-cyan focus:outline-none transition-colors"
              />
            </div>
            {error && (
              <div className="pixel-border bg-accent-pink/10 border-accent-pink/30 px-3 py-2 text-xs text-accent-pink">
                ⚠ {error}
              </div>
            )}
            <button onClick={handleJoin} className="pixel-btn border-accent-cyan text-accent-cyan hover:bg-accent-cyan hover:text-bg-primary w-full text-[10px] py-3">
              ▶ {t('btn.enterStream')}
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="ambient-gradient h-screen flex flex-col" data-player-root>
      {/* Channel context bar (global Navbar already provides logo + nav) */}
      <div className="flex items-center justify-between h-9 px-3 sm:px-4 hud-panel shrink-0">
        <div className="flex items-center gap-2 min-w-0">
          <span className="font-[family-name:var(--font-pixel)] text-[8px] text-text-secondary/60 shrink-0">/watch/</span>
          <span className="text-sm text-text-primary truncate">
            {decodeURIComponent(roomName)}
          </span>
        </div>

        {/* Mobile panel toggle */}
        <div className="flex items-center gap-0.5 lg:hidden bg-bg-primary/60 rounded-sm p-0.5">
          {([
            { key: "video" as const, icon: "▶", label: t('watch.tabVideo') },
            { key: "chat" as const, icon: "💬", label: t('watch.tabChat') },
          ]).map((tb) => (
            <button
              key={tb.key}
              onClick={() => setMobilePanel(tb.key)}
              className={`px-2.5 py-1 text-[9px] font-[family-name:var(--font-pixel)] transition-all ${
                mobilePanel === tb.key
                  ? "bg-accent-cyan/15 text-accent-cyan shadow-[0_0_6px_var(--glow-cyan)]"
                  : "text-text-secondary hover:text-text-primary"
              }`}
            >
              <span className="mr-1">{tb.icon}</span>{tb.label}
            </button>
          ))}
        </div>
      </div>

      <LiveKitRoom serverUrl={livekitUrl} token={token!} connect={true} className="flex flex-col flex-1 min-h-0">
        <WatchLayout
          layoutMode={layoutMode}
          onLayoutChange={setLayoutMode}
          mobilePanel={mobilePanel}
          onMobilePanelChange={setMobilePanel}
          identity={identity}
          roomName={roomName}
          aiAudienceEnabled={aiAudienceEnabled}
          streamStartedAt={channelData.liveStream.started_at ?? null}
        />
        <RoomAudioRenderer />
      </LiveKitRoom>

      <style jsx global>{`
        @keyframes float-up {
          0% { transform: translateY(0) scale(1); opacity: 1; }
          100% { transform: translateY(-120px) scale(1.5); opacity: 0; }
        }
      `}</style>
    </div>
  );
}

// ─── Channel Not Found ─────────────────────────────────────────────
function ChannelNotFound({ slug }: { slug: string }) {
  const { t } = useI18n();
  return (
    <div className="ambient-gradient min-h-screen flex items-center justify-center px-4">
      <div className="pixel-border bg-bg-card p-8 max-w-md w-full text-center space-y-4">
        <span className="font-[family-name:var(--font-pixel)] text-4xl block opacity-30">⌀</span>
        <h1 className="font-[family-name:var(--font-pixel)] text-[12px] text-accent-pink glow-pink">
          {t("channelPage.notFound")}
        </h1>
        <p className="text-xs text-text-secondary">
          {t("channelPage.notFoundHint")}
        </p>
        <p className="text-[10px] text-text-secondary/40 break-all">/watch/{slug}</p>
        <Link
          href="/"
          className="pixel-btn inline-block border-accent-cyan text-accent-cyan hover:bg-accent-cyan hover:text-bg-primary text-[10px] px-4 py-2"
        >
          ◁ {t("nav.backToHome")}
        </Link>
      </div>
    </div>
  );
}

// ─── Offline Channel Page (主播离线时的频道主页) ──────────────────
function OfflineChannelPage({ data }: { data: ChannelData }) {
  const { t } = useI18n();
  const { channel, profile, lastSession } = data;
  const [isOwner, setIsOwner] = useState(false);
  const [isFollowing, setIsFollowing] = useState(false);
  const [followLoading, setFollowLoading] = useState(false);

  // 检查是否当前用户是频道主 + 关注状态
  useEffect(() => {
    const supabase = createClient();
    if (!supabase) return;
    supabase.auth.getUser().then(({ data: u }) => {
      if (!u.user) return;
      const owner = u.user.id === channel.user_id;
      setIsOwner(owner);
      if (!owner) {
        fetch(`/api/follows?following_id=${channel.user_id}`)
          .then((r) => r.json())
          .then((d) => setIsFollowing(!!d.isFollowing))
          .catch(() => {});
      }
    });
  }, [channel.user_id]);

  const toggleFollow = async () => {
    if (followLoading) return;
    setFollowLoading(true);
    try {
      const res = await fetch("/api/follows", {
        method: isFollowing ? "DELETE" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ following_id: channel.user_id }),
      });
      if (res.ok) setIsFollowing(!isFollowing);
    } catch {}
    setFollowLoading(false);
  };

  const formatDuration = (s: number) => {
    if (!s) return "—";
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    if (h > 0) return `${h}h ${m}m`;
    return `${m}m`;
  };

  const formatDate = (iso: string) => {
    try {
      return new Date(iso).toLocaleString("zh-CN", {
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      });
    } catch {
      return iso;
    }
  };

  const displayName = profile?.display_name || channel.slug;
  const avatarUrl = profile?.avatar_url || "";

  return (
    <div className="ambient-gradient min-h-screen">
      {/* Channel context bar (global Navbar already provides logo + nav) */}
      <div className="hud-panel flex items-center gap-2 h-9 px-4 shrink-0">
        <span className="font-[family-name:var(--font-pixel)] text-[8px] text-text-secondary/60 shrink-0">/watch/</span>
        <span className="text-sm text-text-primary truncate">{channel.slug}</span>
        <div className="flex-1" />
        <span className="font-[family-name:var(--font-pixel)] text-[8px] text-text-secondary/60">
          {t("channelPage.offline")}
        </span>
      </div>

      <div className="mx-auto max-w-[960px] px-4 py-8 space-y-6">
        {/* Header card: avatar + name + actions */}
        <div className="pixel-border bg-bg-card p-5 flex flex-col sm:flex-row items-start sm:items-center gap-4">
          <div className="w-20 h-20 border-2 border-border-pixel bg-bg-primary overflow-hidden shrink-0">
            {avatarUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={avatarUrl} alt={displayName} className="w-full h-full object-cover" />
            ) : (
              <div className="w-full h-full flex items-center justify-center">
                <span className="font-[family-name:var(--font-pixel)] text-2xl text-accent-purple">
                  {displayName.slice(0, 1).toUpperCase()}
                </span>
              </div>
            )}
          </div>

          <div className="flex-1 min-w-0">
            <h1 className="font-[family-name:var(--font-pixel)] text-[13px] text-text-primary mb-1 truncate">
              {displayName}
            </h1>
            <p className="text-[10px] text-text-secondary/60 mb-2">
              /watch/{channel.slug}
            </p>
            <div className="flex items-center gap-3 text-[10px] text-text-secondary">
              <span>
                <span className="text-accent-cyan font-medium">
                  {profile?.followers_count ?? 0}
                </span>{" "}
                {t("profile.followers")}
              </span>
              <span className="font-[family-name:var(--font-pixel)] text-[8px] text-text-secondary/60">
                {t("channelPage.offline")}
              </span>
            </div>
          </div>

          <div className="flex gap-2 shrink-0">
            {isOwner ? (
              <Link
                href="/go-live"
                className="pixel-btn border-accent-green text-accent-green hover:bg-accent-green hover:text-bg-primary text-[10px] px-4 py-2"
              >
                ▶ {t("nav.goLive")}
              </Link>
            ) : (
              <button
                onClick={toggleFollow}
                disabled={followLoading}
                className={`pixel-btn text-[10px] px-4 py-2 ${
                  isFollowing
                    ? "border-text-secondary text-text-secondary"
                    : "border-accent-pink text-accent-pink hover:bg-accent-pink hover:text-white"
                }`}
              >
                {isFollowing ? t("btn.following") : t("btn.follow")}
              </button>
            )}
          </div>
        </div>

        {/* About / bio */}
        {profile?.bio && (
          <div className="pixel-border bg-bg-card p-5">
            <div className="flex items-center gap-2 mb-3">
              <span className="font-[family-name:var(--font-pixel)] text-[8px] text-accent-cyan">◈</span>
              <span className="font-[family-name:var(--font-pixel)] text-[9px] text-text-secondary">
                {t("channelPage.about")}
              </span>
            </div>
            <p className="text-sm text-text-primary/80 whitespace-pre-wrap leading-relaxed">
              {profile.bio}
            </p>
          </div>
        )}

        {/* Current project (always show even when offline) */}
        {(channel.project_name || channel.project_desc) && (
          <div className="pixel-border bg-bg-card p-5 space-y-3">
            <div className="flex items-center gap-2">
              <span className="font-[family-name:var(--font-pixel)] text-[8px] text-accent-purple">◈</span>
              <span className="font-[family-name:var(--font-pixel)] text-[9px] text-text-secondary">
                {t("goLive.projectInfo")}
              </span>
            </div>
            {channel.project_name && (
              <div>
                <p className="text-base text-text-primary font-medium">{channel.project_name}</p>
                {channel.project_stage && (
                  <span className="inline-block mt-1 px-2 py-0.5 text-xs border border-accent-cyan/40 text-accent-cyan bg-accent-cyan/10">
                    {channel.project_stage}
                  </span>
                )}
              </div>
            )}
            {channel.project_desc && (
              <p className="text-xs text-text-primary/80 whitespace-pre-wrap leading-relaxed">
                {channel.project_desc}
              </p>
            )}
            {channel.project_url && (
              <a
                href={channel.project_url}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-block text-xs text-accent-cyan hover:underline"
              >
                ↗ {channel.project_url}
              </a>
            )}
          </div>
        )}

        {/* Last stream summary */}
        <div className="pixel-border bg-bg-card p-5">
          <div className="flex items-center gap-2 mb-3">
            <span className="font-[family-name:var(--font-pixel)] text-[8px] text-accent-yellow">◈</span>
            <span className="font-[family-name:var(--font-pixel)] text-[9px] text-text-secondary">
              {t("channelPage.lastStream")}
            </span>
          </div>
          {lastSession ? (
            <div className="flex flex-col sm:flex-row gap-4">
              {lastSession.thumbnail_url && (
                <div className="w-full sm:w-48 aspect-video border border-border-pixel overflow-hidden shrink-0 bg-bg-primary">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={lastSession.thumbnail_url}
                    alt="cover"
                    className="w-full h-full object-cover"
                  />
                </div>
              )}
              <div className="flex-1 min-w-0 space-y-2">
                <p className="text-sm text-text-primary font-medium truncate">
                  {lastSession.title || lastSession.project_name || "—"}
                </p>
                <p className="text-[10px] text-text-secondary/60">
                  {formatDate(lastSession.started_at)}
                </p>
                <div className="flex flex-wrap gap-4 text-[10px] text-text-secondary">
                  <span>
                    {t("channelPage.duration")}:{" "}
                    <span className="text-accent-cyan">
                      {formatDuration(lastSession.duration_seconds)}
                    </span>
                  </span>
                  <span>
                    {t("channelPage.peakViewers")}:{" "}
                    <span className="text-accent-cyan">{lastSession.peak_viewers}</span>
                  </span>
                </div>
              </div>
            </div>
          ) : (
            <p className="text-xs text-text-secondary/40 text-center py-4">
              {t("channelPage.noHistory")}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
