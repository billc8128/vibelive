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
import { EmojiPicker } from "@/components/EmojiPicker";
import { StickerPicker } from "@/components/StickerPicker";
import { ProgressBar } from "@/components/ProgressBar";
import { ToolBadge } from "@/components/ToolBadge";
import type { CodingTool, ProjectStage } from "@/lib/types";
import { isValidStickerId } from "@/lib/stickers";
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

// ── Coding tool guard ─────────────────────────
const CODING_TOOLS: CodingTool[] = [
  "cursor",
  "copilot",
  "windsurf",
  "claude-code",
  "v0",
  "bolt",
  "replit",
  "other",
];
function asCodingTool(value: string | null | undefined): CodingTool {
  if (value && (CODING_TOOLS as string[]).includes(value)) {
    return value as CodingTool;
  }
  return "other";
}

// ── Dev time formatter ────────────────────────
function formatDevMinutes(min: number): string {
  if (!Number.isFinite(min) || min < 0) return "0m";
  const h = Math.floor(min / 60);
  const m = Math.floor(min % 60);
  if (h === 0) return `${m}m`;
  return m > 0 ? `${h}h ${m}m` : `${h}h`;
}

// ── Live elapsed minutes hook (refreshes every 30s) ─────
function useElapsedMinutes(startedAt: string | null): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!startedAt) return;
    const id = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(id);
  }, [startedAt]);
  if (!startedAt) return 0;
  const startMs = new Date(startedAt).getTime();
  if (Number.isNaN(startMs)) return 0;
  return Math.max(0, Math.floor((now - startMs) / 60_000));
}

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
  devTimeLabel,
  stages,
}: {
  layoutMode: LayoutMode;
  onLayoutChange: (mode: LayoutMode) => void;
  devTimeLabel: string;
  stages: ProjectStage[];
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
        {/* HUD: top-left status, top-right dev time */}
        <div className="absolute top-3 left-3 z-20 flex items-center gap-2">
          <span className="viewer-badge text-[9px]">
            <span className="live-dot inline-block w-2 h-2 rounded-full bg-white" />
            LIVE
          </span>
          <span className="hud-panel px-2 py-1 font-[family-name:var(--font-pixel)] text-[8px] text-text-secondary">
            👁 {viewerCount}
          </span>
        </div>
        <div className="absolute top-3 right-3 z-20">
          <span className="hud-panel px-2 py-1 font-[family-name:var(--font-pixel)] text-[8px] text-accent-yellow">
            ⏱ {devTimeLabel}
          </span>
        </div>
        {/* Bottom progress overlay */}
        {stages.length > 0 && (
          <div className="absolute bottom-0 left-0 right-0 z-20">
            <div className="bg-gradient-to-t from-bg-primary/90 to-transparent p-3 pt-8">
              <ProgressBar stages={stages} compact />
            </div>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="relative w-full h-full bg-bg-primary group" ref={videoContainerRef}>
      <VideoTrack trackRef={screenTrack} className="w-full h-full object-contain" />
      {/* Face cam PiP — 主播脸的小窗, 右下角, 屏幕共享时才显示 */}
      {faceCamTrack && (
        <div className="absolute bottom-16 right-3 z-30 w-32 sm:w-40 md:w-48 aspect-video pixel-border bg-bg-primary overflow-hidden shadow-lg pointer-events-none">
          <VideoTrack
            trackRef={faceCamTrack}
            className="w-full h-full object-cover"
          />
          <span className="absolute top-1 left-1 font-[family-name:var(--font-pixel)] text-[7px] text-accent-yellow bg-black/40 px-1 py-0.5">
            CAM
          </span>
        </div>
      )}

      {/* HUD: top-left LIVE + viewers (always visible) */}
      <div className="absolute top-3 left-3 z-20 flex items-center gap-2">
        <span className="viewer-badge text-[9px]">
          <span className="live-dot inline-block w-2 h-2 rounded-full bg-white" />
          LIVE
        </span>
        <span className="hud-panel px-2 py-1 font-[family-name:var(--font-pixel)] text-[8px] text-text-secondary">
          👁 {viewerCount}
        </span>
      </div>

      {/* HUD: top-right dev time (always visible) */}
      <div className="absolute top-3 right-3 z-20">
        <span className="hud-panel px-2 py-1 font-[family-name:var(--font-pixel)] text-[8px] text-accent-yellow">
          ⏱ {devTimeLabel}
        </span>
      </div>

      {/* Bottom progress bar overlay (always visible, sits above hover-only player controls) */}
      {stages.length > 0 && (
        <div className="absolute bottom-0 left-0 right-0 z-20 pointer-events-none group-hover:opacity-0 transition-opacity">
          <div className="bg-gradient-to-t from-bg-primary/90 to-transparent p-3 pt-8">
            <ProgressBar stages={stages} compact />
          </div>
        </div>
      )}

      {/* Player controls (hover) */}
      <PlayerControls
        videoRef={videoRef}
        layoutMode={layoutMode}
        onLayoutChange={onLayoutChange}
      />
    </div>
  );
}

// ── Stage data (used by sidebar editor + ProgressBar synthesizer) ──
const STAGES_DATA = [
  { value: "构思中", labelKey: "goLive.stage.idea" },
  { value: "设计中", labelKey: "goLive.stage.design" },
  { value: "编码中", labelKey: "goLive.stage.coding" },
  { value: "调试中", labelKey: "goLive.stage.debug" },
  { value: "测试中", labelKey: "goLive.stage.testing" },
  { value: "发布中", labelKey: "goLive.stage.deploy" },
  { value: "已完成", labelKey: "goLive.stage.done" },
];

// Map a single stage string into a 7-step ProjectStage[] for ProgressBar.
// Stages strictly before the current one are completed; "已完成" marks all done.
function useSynthesizedStages(currentStage: string | null | undefined): ProjectStage[] {
  const { t } = useI18n();
  const idx = STAGES_DATA.findIndex((s) => s.value === currentStage);
  return STAGES_DATA.map((s, i) => ({
    name: t(s.labelKey as TranslationKey),
    completed: idx === STAGES_DATA.length - 1 ? true : i < idx,
  }));
}

// ── Live Chat Panel (single panel, mock-style) ──────────
// Wraps all the LiveKit data-channel chat (text + stickers + emoji)
// in a single header/messages/input layout matching components/ChatPanel.
function LiveChatPanel({
  viewerName,
  roomName,
  aiAudienceEnabled,
  streamStartedAt,
}: {
  viewerName: string;
  roomName: string;
  aiAudienceEnabled: boolean;
  streamStartedAt: string | null;
}) {
  const { t } = useI18n();
  const room = useRoomContext();
  const decodedRoom = decodeURIComponent(roomName);
  const chatStorageKey = `vibelive-chat-${decodedRoom}`;
  // Lazy init from localStorage. ConnectedRoom only mounts this once per
  // session (chatStorageKey + streamStartedAt are stable post-mount because
  // the parent guards on `liveStream` being non-null), so a one-shot restore
  // is safe and avoids a setState-in-effect lint violation.
  const [messages, setMessages] = useState<ChatTimelineMessage[]>(() => {
    if (typeof window === "undefined") return [];
    try {
      const raw = localStorage.getItem(chatStorageKey);
      return restoreChatTimeline({
        raw,
        sessionStartedAt: streamStartedAt,
        ttlMs: CHAT_TTL_MS,
      }).slice(-200);
    } catch {
      return [];
    }
  });
  const [input, setInput] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);

  const chatInputRef = useRef<HTMLInputElement>(null);
  const [emojiOpen, setEmojiOpen] = useState(false);
  const [stickerOpen, setStickerOpen] = useState(false);

  const insertEmoji = useCallback((emoji: string) => {
    const el = chatInputRef.current;
    if (!el) {
      setInput((prev) => prev + emoji);
      return;
    }
    const start = el.selectionStart ?? el.value.length;
    const end = el.selectionEnd ?? el.value.length;
    const newValue = el.value.slice(0, start) + emoji + el.value.slice(end);
    setInput(newValue);
    requestAnimationFrame(() => {
      el.focus();
      const pos = start + emoji.length;
      el.setSelectionRange(pos, pos);
    });
  }, []);

  // Data channel — skip self-echo (we add locally in send*)
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
      } else if (msg.type === "sticker") {
        if (!isValidStickerId(msg.stickerId)) return;
        setMessages((prev) => [
          ...prev.slice(-200),
          {
            id: `${Date.now()}-${Math.random()}`,
            user: msg.user,
            text: "",
            time: Date.now(),
            stickerId: msg.stickerId,
          },
        ]);
      }
    };
    room.on(RoomEvent.DataReceived, handleData);
    return () => {
      room.off(RoomEvent.DataReceived, handleData);
    };
  }, [room]);

  // Persist chat to localStorage (10 min TTL). Restore happens via useState
  // lazy init above, so this effect is write-only.
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

  const sendSticker = (stickerId: string) => {
    if (!isValidStickerId(stickerId)) return;
    const payload = encodeRoomDataMessage({
      type: "sticker",
      user: viewerName,
      stickerId,
    });
    room.localParticipant.publishData(payload, { reliable: true });
    setMessages((prev) => [
      ...prev.slice(-200),
      {
        id: `${Date.now()}-${Math.random()}`,
        user: viewerName,
        text: "",
        time: Date.now(),
        stickerId,
      },
    ]);
    if (aiAudienceEnabled) {
      void mirrorAiAudienceContextEvent({
        roomSlug: decodedRoom,
        kind: "chat_message",
        user: viewerName,
        text: `[sticker:${stickerId}]`,
        bot: false,
      }).catch(() => {});
    }
  };

  const formatTime = (ts: number) => {
    const d = new Date(ts);
    return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  };

  return (
    <div className="flex flex-col h-full hud-panel overflow-hidden">
      {/* Header — matches components/ChatPanel */}
      <div className="border-b border-border-pixel/50 px-3 py-2 flex items-center justify-between shrink-0">
        <span className="font-[family-name:var(--font-pixel)] text-[9px] text-accent-green glow-green">
          ◈ {t('watch.tabChat')}
        </span>
        <span className="font-[family-name:var(--font-pixel)] text-[7px] text-text-secondary">
          {messages.length} 条
        </span>
      </div>

      {/* Messages */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto px-3 py-2 space-y-2 min-h-0">
        {messages.length === 0 && (
          <p className="text-xs text-text-secondary/40 text-center py-8">
            还没有消息，说点什么吧
          </p>
        )}
        {messages.map((msg) => (
          <ChatMessageRow
            key={msg.id}
            message={msg}
            timestampLabel={formatTime(msg.time)}
          />
        ))}
      </div>

      {/* Input */}
      <div className="px-3 py-2 border-t border-border-pixel/50 shrink-0">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            sendChat();
          }}
          className="flex gap-2 items-stretch"
        >
          <input
            ref={chatInputRef}
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder={t('chat.placeholder')}
            className="flex-1 min-w-0 bg-bg-primary border border-border-pixel px-2 py-1.5 text-xs text-text-primary placeholder:text-text-secondary/30 focus:border-accent-cyan focus:outline-none"
          />
          <div className="relative shrink-0">
            <button
              type="button"
              onClick={() => {
                setEmojiOpen((v) => !v);
                setStickerOpen(false);
              }}
              className={`h-full px-2 border text-base leading-none transition-colors ${
                emojiOpen
                  ? "border-accent-cyan text-accent-cyan bg-accent-cyan/10"
                  : "border-border-pixel text-text-secondary hover:text-accent-cyan hover:border-accent-cyan/60"
              }`}
              title="Emoji"
              aria-label="Open emoji picker"
            >
              😀
            </button>
            {emojiOpen && (
              <EmojiPicker onSelect={insertEmoji} onClose={() => setEmojiOpen(false)} />
            )}
          </div>
          <div className="relative shrink-0">
            <button
              type="button"
              onClick={() => {
                setStickerOpen((v) => !v);
                setEmojiOpen(false);
              }}
              className={`h-full px-2 border text-base leading-none transition-colors ${
                stickerOpen
                  ? "border-accent-pink text-accent-pink bg-accent-pink/10"
                  : "border-border-pixel text-text-secondary hover:text-accent-pink hover:border-accent-pink/60"
              }`}
              title="Sticker"
              aria-label="Open sticker picker"
            >
              🖼️
            </button>
            {stickerOpen && (
              <StickerPicker onSelect={sendSticker} onClose={() => setStickerOpen(false)} />
            )}
          </div>
          <button
            type="submit"
            className="shrink-0 px-3 py-1.5 bg-accent-cyan/20 border border-accent-cyan/40 text-accent-cyan text-xs hover:bg-accent-cyan/30 transition-colors"
          >
            {t('chat.send')}
          </button>
        </form>
      </div>
    </div>
  );
}

// ── Connected Room (mock-style layout for joined viewer) ──
// Replaces the previous WatchLayout (theater/default/mobile) + Sidebar tabs.
// Renders: top bar + main flex (video + cards | chat sidebar).
function ConnectedRoom({
  channelData,
  identity,
  roomName,
  aiAudienceEnabled,
}: {
  channelData: ChannelData;
  identity: string;
  roomName: string;
  aiAudienceEnabled: boolean;
}) {
  const { t } = useI18n();
  const router = useRouter();
  const decodedRoom = decodeURIComponent(roomName);
  const streamStartedAt = channelData.liveStream?.started_at ?? null;
  const elapsedMin = useElapsedMinutes(streamStartedAt);
  const devTimeLabel = formatDevMinutes(elapsedMin);

  // Editable channel state — initialized from channelData, may diverge during edit.
  // savingRef guards against the 15s parent poll stomping in-flight typed values.
  const [projectName, setProjectName] = useState(channelData.channel.project_name || "");
  const [projectDesc, setProjectDesc] = useState(channelData.channel.project_desc || "");
  const [projectStage, setProjectStage] = useState(
    channelData.channel.project_stage || "构思中",
  );
  const savingRef = useRef(false);
  useEffect(() => {
    if (savingRef.current) return;
    setProjectName(channelData.channel.project_name || "");
    setProjectDesc(channelData.channel.project_desc || "");
    setProjectStage(channelData.channel.project_stage || "构思中");
  }, [
    channelData.channel.project_name,
    channelData.channel.project_desc,
    channelData.channel.project_stage,
  ]);

  const stages = useSynthesizedStages(projectStage);
  const codingTool = asCodingTool(channelData.channel.coding_tool);

  // Streamer detection + follow / favorite state
  const [isStreamer, setIsStreamer] = useState(false);
  const [isFollowing, setIsFollowing] = useState(false);
  const [isFavorited, setIsFavorited] = useState(false);
  const [saving, setSaving] = useState(false);
  const [ending, setEnding] = useState(false);
  const [showEndConfirm, setShowEndConfirm] = useState(false);
  const [chatOpen, setChatOpen] = useState(true);

  useEffect(() => {
    const supabase = createClient();
    if (!supabase) return;
    let cancelled = false;
    supabase.auth.getUser().then(({ data }) => {
      if (cancelled || !data.user) return;
      const owner = data.user.id === channelData.channel.user_id;
      setIsStreamer(owner);
      if (!owner) {
        fetch(`/api/follows?following_id=${channelData.channel.user_id}`)
          .then((r) => r.json())
          .then((d) => setIsFollowing(!!d.isFollowing))
          .catch(() => {});
        fetch(`/api/favorites?room_name=${encodeURIComponent(decodedRoom)}`)
          .then((r) => r.json())
          .then((d) => setIsFavorited(!!d.isFavorited))
          .catch(() => {});
      }
    });
    return () => {
      cancelled = true;
    };
  }, [channelData.channel.user_id, decodedRoom]);

  // Debounced save for inline edit (PATCH /api/streams updates both
  // live_streams + channels rows; the parent's 15s poll will eventually
  // refresh channelData with the new values).
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const saveField = useCallback(
    (fields: Record<string, string>) => {
      if (!isStreamer) return;
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
      savingRef.current = true;
      saveTimerRef.current = setTimeout(async () => {
        setSaving(true);
        try {
          await fetch("/api/streams", {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ room_name: decodedRoom, ...fields }),
          });
        } catch {}
        setSaving(false);
        savingRef.current = false;
      }, 600);
    },
    [decodedRoom, isStreamer],
  );

  const onProjectNameChange = (v: string) => {
    setProjectName(v);
    saveField({ project_name: v });
  };
  const onProjectDescChange = (v: string) => {
    setProjectDesc(v);
    saveField({ description: v });
  };
  const onStageChange = (v: string) => {
    setProjectStage(v);
    saveField({ stage: v });
  };

  const toggleFollow = async () => {
    const method = isFollowing ? "DELETE" : "POST";
    const res = await fetch("/api/follows", {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ following_id: channelData.channel.user_id }),
    });
    if (res.ok) setIsFollowing(!isFollowing);
  };

  const toggleFavorite = async () => {
    const method = isFavorited ? "DELETE" : "POST";
    const res = await fetch("/api/favorites", {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        room_name: decodedRoom,
        stream_title: projectName || channelData.profile?.display_name || "",
        streamer_name: channelData.profile?.display_name || "",
      }),
    });
    if (res.ok) setIsFavorited(!isFavorited);
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
      localStorage.removeItem("vibelive_active_stream");
      router.push("/");
    } catch {
      setEnding(false);
      setShowEndConfirm(false);
    }
  };

  const profile = channelData.profile;
  const displayName = profile?.display_name || channelData.channel.slug;
  const projectUrl = channelData.channel.project_url;

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="mx-auto max-w-[1400px] px-4 py-3">
        {/* ── Top Bar ─────────────────────────── */}
        <div className="flex items-center justify-between gap-3 mb-3">
          <div className="flex items-center gap-3 min-w-0">
            <Link
              href="/"
              className="font-[family-name:var(--font-pixel)] text-[8px] text-text-secondary hover:text-accent-cyan transition-colors shrink-0"
            >
              ◁ {t('nav.backToHome')}
            </Link>
            <span className="text-border-pixel shrink-0">│</span>
            <h1 className="font-[family-name:var(--font-pixel)] text-[12px] text-text-primary glitch-hover truncate">
              {projectName || displayName}
            </h1>
            <ToolBadge tool={codingTool} />
            {saving && (
              <span className="font-[family-name:var(--font-pixel)] text-[7px] text-accent-yellow animate-pulse">
                保存中...
              </span>
            )}
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <button
              onClick={() => setChatOpen(!chatOpen)}
              className={`pixel-btn text-[8px] ${
                chatOpen
                  ? "border-accent-cyan text-accent-cyan"
                  : "border-border-pixel text-text-secondary"
              }`}
            >
              💬 {chatOpen ? t('stream.hideChat') : t('stream.showChat')}
            </button>
            {isStreamer ? (
              !showEndConfirm ? (
                <>
                  <Link
                    href="/go-live"
                    className="pixel-btn text-[8px] border-accent-cyan text-accent-cyan hover:bg-accent-cyan hover:text-bg-primary"
                  >
                    {t('goLive.title')}
                  </Link>
                  <button
                    onClick={() => setShowEndConfirm(true)}
                    className="pixel-btn text-[8px] border-accent-pink text-accent-pink hover:bg-accent-pink hover:text-white"
                  >
                    下播
                  </button>
                </>
              ) : (
                <>
                  <button
                    onClick={endStream}
                    disabled={ending}
                    className="pixel-btn text-[8px] bg-accent-pink/20 border-accent-pink text-accent-pink disabled:opacity-50"
                  >
                    {ending ? t('btn.ending') : t('btn.confirmEnd')}
                  </button>
                  <button
                    onClick={() => setShowEndConfirm(false)}
                    className="pixel-btn text-[8px] border-border-pixel text-text-secondary"
                  >
                    取消
                  </button>
                </>
              )
            ) : (
              <button
                onClick={toggleFavorite}
                className={`pixel-btn text-[8px] ${
                  isFavorited
                    ? "border-accent-yellow text-bg-primary bg-accent-yellow"
                    : "border-accent-yellow text-accent-yellow"
                }`}
              >
                {isFavorited ? t('btn.favorited') : t('btn.favorite')}
              </button>
            )}
          </div>
        </div>

        {/* ── Main Layout ─────────────────────── */}
        <div className="flex gap-4">
          {/* Video + Info Area */}
          <div className="flex-1 min-w-0 space-y-4">
            {/* Video */}
            <div className="relative pixel-border-live aspect-video bg-bg-primary overflow-hidden">
              <VideoArea
                layoutMode="default"
                onLayoutChange={() => {}}
                devTimeLabel={devTimeLabel}
                stages={stages}
              />
            </div>

            {/* Project Info + Streamer Card */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {/* Project Info */}
              <div className="pixel-border bg-bg-card p-4 space-y-3">
                <div className="flex items-center gap-2 mb-2">
                  <span className="font-[family-name:var(--font-pixel)] text-[8px] text-accent-purple">
                    ◈
                  </span>
                  <span className="font-[family-name:var(--font-pixel)] text-[9px] text-text-secondary">
                    {t('stream.projectInfo')}
                  </span>
                </div>

                {isStreamer ? (
                  <>
                    <input
                      type="text"
                      value={projectName}
                      onChange={(e) => onProjectNameChange(e.target.value)}
                      placeholder={t('goLive.projectQuestion')}
                      className="w-full bg-bg-primary border border-border-pixel px-2 py-1.5 text-sm text-text-primary placeholder:text-text-secondary/30 focus:border-accent-purple focus:outline-none"
                    />
                    <textarea
                      value={projectDesc}
                      onChange={(e) => onProjectDescChange(e.target.value)}
                      placeholder={t('goLive.projectDescPlaceholder')}
                      rows={3}
                      className="w-full bg-bg-primary border border-border-pixel px-2 py-1.5 text-xs text-text-primary placeholder:text-text-secondary/30 focus:border-accent-purple focus:outline-none resize-none"
                    />
                  </>
                ) : (
                  <p className="text-sm text-text-primary leading-relaxed whitespace-pre-wrap">
                    {projectDesc || (
                      <span className="text-text-secondary/40">主播还没写描述</span>
                    )}
                  </p>
                )}

                <div className="flex flex-wrap gap-1.5">
                  <span className="pixel-tag text-accent-cyan border-accent-cyan/30">
                    #{(() => {
                      const match = STAGES_DATA.find((s) => s.value === projectStage);
                      return match ? t(match.labelKey as TranslationKey) : projectStage;
                    })()}
                  </span>
                </div>

                {projectUrl && (
                  <a
                    href={projectUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="block text-xs text-accent-green hover:underline mt-2 truncate"
                  >
                    🔗 {projectUrl}
                  </a>
                )}
              </div>

              {/* Streamer Card */}
              <div className="pixel-border bg-bg-card p-4">
                <div className="flex items-center gap-2 mb-3">
                  <span className="font-[family-name:var(--font-pixel)] text-[8px] text-accent-pink">
                    ◈
                  </span>
                  <span className="font-[family-name:var(--font-pixel)] text-[9px] text-text-secondary">
                    {t('stream.streamer')}
                  </span>
                </div>

                <div className="flex items-center gap-3">
                  <div className="w-14 h-14 bg-bg-surface border-2 border-border-pixel shrink-0 overflow-hidden">
                    {profile?.avatar_url ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={profile.avatar_url}
                        alt={displayName}
                        className="w-full h-full object-cover"
                      />
                    ) : (
                      <span className="flex items-center justify-center w-full h-full font-[family-name:var(--font-pixel)] text-lg text-accent-purple">
                        {displayName.charAt(0).toUpperCase()}
                      </span>
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <h3 className="font-semibold text-text-primary truncate">
                      {displayName}
                    </h3>
                    {profile?.bio && (
                      <p className="text-xs text-text-secondary mt-0.5 line-clamp-2">
                        {profile.bio}
                      </p>
                    )}
                  </div>
                </div>

                <div className="flex items-center gap-3 mt-3 pt-3 border-t border-border-pixel/50">
                  <span className="font-[family-name:var(--font-pixel)] text-[8px] text-text-secondary">
                    {profile?.followers_count ?? 0} {t('profile.followers')}
                  </span>
                  <div className="flex-1" />
                  {!isStreamer && (
                    <button
                      onClick={toggleFollow}
                      className={`pixel-btn text-[8px] ${
                        isFollowing
                          ? "border-text-secondary text-text-secondary bg-bg-surface"
                          : "border-accent-pink text-accent-pink hover:bg-accent-pink hover:text-white"
                      }`}
                    >
                      {isFollowing ? t('btn.following') : t('btn.follow')}
                    </button>
                  )}
                </div>
              </div>
            </div>

            {/* Progress Detail */}
            <div className="pixel-border bg-bg-card p-4">
              <div className="flex items-center gap-2 mb-3">
                <span className="font-[family-name:var(--font-pixel)] text-[8px] text-accent-green">
                  ◈
                </span>
                <span className="font-[family-name:var(--font-pixel)] text-[9px] text-text-secondary">
                  {t('stream.progress')}
                </span>
                <div className="flex-1" />
                <span className="font-[family-name:var(--font-pixel)] text-[8px] text-accent-yellow">
                  ⏱ 累计 {devTimeLabel}
                </span>
              </div>
              <ProgressBar stages={stages} />
              {isStreamer && (
                <div className="mt-3 flex flex-wrap gap-1">
                  {STAGES_DATA.map((s) => (
                    <button
                      key={s.value}
                      onClick={() => onStageChange(s.value)}
                      className={`px-1.5 py-0.5 text-[10px] border transition-colors ${
                        projectStage === s.value
                          ? "border-accent-cyan text-accent-cyan bg-accent-cyan/10"
                          : "border-border-pixel text-text-secondary hover:border-text-secondary"
                      }`}
                    >
                      {t(s.labelKey as TranslationKey)}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Chat sidebar — sticky desktop only, matches mock.
              top-14 clears the global Navbar (h-12 = 48px sticky top-0). */}
          {chatOpen && (
            <div className="w-[340px] shrink-0 hidden lg:block">
              <div className="sticky top-14 h-[calc(100vh-72px)]">
                <LiveChatPanel
                  viewerName={identity}
                  roomName={roomName}
                  aiAudienceEnabled={aiAudienceEnabled}
                  streamStartedAt={streamStartedAt}
                />
              </div>
            </div>
          )}
        </div>

        {/* Mobile chat — below the cards (lg:hidden) */}
        {chatOpen && (
          <div className="mt-4 lg:hidden h-[400px]">
            <LiveChatPanel
              viewerName={identity}
              roomName={roomName}
              aiAudienceEnabled={aiAudienceEnabled}
              streamStartedAt={streamStartedAt}
            />
          </div>
        )}
      </div>
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
    <div className="ambient-gradient min-h-screen flex flex-col" data-player-root>
      <LiveKitRoom
        serverUrl={livekitUrl}
        token={token!}
        connect={true}
        className="flex flex-col flex-1 min-h-0"
      >
        <ConnectedRoom
          channelData={channelData}
          identity={identity}
          roomName={roomName}
          aiAudienceEnabled={aiAudienceEnabled}
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
