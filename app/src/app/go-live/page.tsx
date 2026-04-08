"use client";

// ────────────────────────────────────────────────────────────────────
// Go Live (Creator Dashboard) — Twitch-style
//
// 状态机:
//   auth        → 检查登录
//   no-channel  → 没有频道, 显示 slug 创建表单
//   dashboard   → 有频道, 显示左右分栏面板
//
// dashboard 内的广播状态:
//   idle        → 还没选屏幕源
//   previewing  → 已选屏幕源, 已加入 LiveKit 房间, 但 track 未发布; 本地预览
//   publishing  → 正在发布 track 到 LiveKit
//   live        → 已发布, 观众可见
//
// 设计要点:
//   - 频道是持久的 (channels 表), 设置改动通过 /api/channels PATCH 自动保存
//   - 屏幕预览先在本地播放, 点击"开始直播"才 publish 到 LiveKit
//   - 即使在 live 状态, 设置依然可以编辑 (PATCH 会同步到当前 live_streams)
// ────────────────────────────────────────────────────────────────────

import { useState, useCallback, useRef, useEffect, type ChangeEvent } from "react";
import {
  Room,
  RoomEvent,
  Track,
  ScreenSharePresets,
  VideoPreset,
  createLocalScreenTracks,
  type LocalTrack,
  type LocalVideoTrack,
  type LocalAudioTrack,
  type RemoteParticipant,
  type RemoteTrack,
  type RemoteTrackPublication,
} from "livekit-client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useNickname } from "@/lib/useNickname";
import { createClient } from "@/lib/supabase/client";
import { useI18n } from "@/lib/i18n/context";
import type { TranslationKey } from "@/lib/i18n/zh";

// ─── Types & Constants ─────────────────────────────────────────────
type PageState = "auth" | "no-channel" | "dashboard";
type BroadcastState = "idle" | "previewing" | "publishing" | "live";
type BroadcastMode = "browser" | "obs";
type QualityLevel = "720p" | "1080p" | "original" | "ultra";

interface IngressInfo {
  ingress_id: string;
  url: string;
  stream_key: string;
  participant_identity: string;
}

const QUALITY_PRESETS: Record<QualityLevel, VideoPreset> = {
  "720p": ScreenSharePresets.h720fps30,
  "1080p": ScreenSharePresets.h1080fps30,
  original: ScreenSharePresets.original,
  ultra: new VideoPreset(0, 0, 15_000_000, 30, "high"),
};

const QUALITY_OPTIONS: { value: QualityLevel; labelKey: string }[] = [
  { value: "720p", labelKey: "720p" },
  { value: "1080p", labelKey: "1080p" },
  { value: "original", labelKey: "goLive.quality.original" },
  { value: "ultra", labelKey: "goLive.quality.ultra" },
];

const TOOL_OPTIONS: { key: string; label: string; labelKey?: TranslationKey }[] = [
  { key: "cursor", label: "Cursor" },
  { key: "copilot", label: "Copilot" },
  { key: "claude-code", label: "Claude Code" },
  { key: "windsurf", label: "Windsurf" },
  { key: "v0", label: "v0" },
  { key: "bolt", label: "Bolt" },
  { key: "replit", label: "Replit" },
  { key: "other", label: "Other", labelKey: "tool.other" },
];

const STAGE_OPTIONS = [
  { value: "构思中", labelKey: "goLive.stage.idea" },
  { value: "设计中", labelKey: "goLive.stage.design" },
  { value: "编码中", labelKey: "goLive.stage.coding" },
  { value: "调试中", labelKey: "goLive.stage.debug" },
  { value: "测试中", labelKey: "goLive.stage.testing" },
  { value: "发布中", labelKey: "goLive.stage.deploy" },
  { value: "已完成", labelKey: "goLive.stage.done" },
] as const;

const CATEGORY_OPTIONS = [
  "notes",
  "productivity",
  "marketing",
  "video",
  "social",
  "dev-tools",
  "ai",
  "gaming",
  "education",
  "other",
] as const;

const PLATFORM_OPTIONS = [
  "web",
  "mobile",
  "desktop",
  "extension",
  "api",
] as const;

const SLOW_MODE_OPTIONS = [5, 10, 30, 60] as const;

const SLUG_RE = /^[a-z0-9-]{3,20}$/;

// ─── Section ↔ Field Mapping ───────────────────────────────────────
// 把右栏 4 个 section 各自负责的字段集中描述, 配合 isSectionDirty/commitSection
// 使用. 分两类: cols = channels 表的顶层列, settings = settings JSONB 的子键.
type SectionKey = "streamInfo" | "projectInfo" | "tech" | "chat";
type ColField =
  | "title"
  | "thumbnail_url"
  | "project_name"
  | "project_desc"
  | "project_stage"
  | "project_url"
  | "coding_tool"
  | "quality";
type SettingsField =
  | "category"
  | "platforms"
  | "tags"
  | "slow_mode_enabled"
  | "slow_mode_seconds"
  | "followers_only";

const SECTION_FIELDS: Record<
  SectionKey,
  { cols: ColField[]; settings: SettingsField[] }
> = {
  streamInfo: {
    cols: ["title", "thumbnail_url"],
    settings: ["category", "platforms", "tags"],
  },
  projectInfo: {
    cols: ["project_name", "project_desc", "project_stage", "project_url"],
    settings: [],
  },
  tech: {
    cols: ["coding_tool", "quality"],
    settings: [],
  },
  chat: {
    cols: [],
    settings: ["slow_mode_enabled", "slow_mode_seconds", "followers_only"],
  },
};

interface ChannelSettings {
  category?: string;
  platforms?: string[];
  tags?: string;
  slow_mode_enabled?: boolean;
  slow_mode_seconds?: number;
  followers_only?: boolean;
}

interface Channel {
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
  quality: string;
  settings: ChannelSettings;
}

// ─── Page Root ─────────────────────────────────────────────────────
export default function GoLivePage() {
  const router = useRouter();
  const [pageState, setPageState] = useState<PageState>("auth");
  const [channel, setChannel] = useState<Channel | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const supabase = createClient();
      if (!supabase) {
        router.replace("/login");
        return;
      }
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (cancelled) return;
      if (!user) {
        router.replace("/login");
        return;
      }

      try {
        const res = await fetch("/api/channels");
        const json = await res.json();
        if (cancelled) return;
        if (json.channel) {
          setChannel(normalizeChannel(json.channel));
          setPageState("dashboard");
        } else {
          setPageState("no-channel");
        }
      } catch {
        setPageState("no-channel");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [router]);

  if (pageState === "auth") {
    return <FullScreenStatus messageKey="nav.loading" />;
  }
  if (pageState === "no-channel") {
    return (
      <ChannelSetup
        onCreated={(ch) => {
          setChannel(normalizeChannel(ch));
          setPageState("dashboard");
        }}
      />
    );
  }
  if (channel) {
    return <Dashboard channel={channel} setChannel={setChannel} />;
  }
  return null;
}

function normalizeChannel(raw: Record<string, unknown>): Channel {
  return {
    id: String(raw.id),
    user_id: String(raw.user_id),
    slug: String(raw.slug || ""),
    title: String(raw.title || ""),
    thumbnail_url: String(raw.thumbnail_url || ""),
    project_name: String(raw.project_name || ""),
    project_desc: String(raw.project_desc || ""),
    project_stage: String(raw.project_stage || "构思中"),
    project_url: String(raw.project_url || ""),
    coding_tool: String(raw.coding_tool || "cursor"),
    quality: String(raw.quality || "1080p"),
    settings: (raw.settings as ChannelSettings) || {},
  };
}

// ─── Loading screen ────────────────────────────────────────────────
function FullScreenStatus({ messageKey }: { messageKey: TranslationKey }) {
  const { t } = useI18n();
  return (
    <div className="ambient-gradient min-h-screen flex items-center justify-center">
      <span className="font-[family-name:var(--font-pixel)] text-[11px] text-accent-cyan animate-pulse">
        {t(messageKey)}
      </span>
    </div>
  );
}

// ─── Channel Setup (slug 创建表单) ─────────────────────────────────
function ChannelSetup({ onCreated }: { onCreated: (ch: Record<string, unknown>) => void }) {
  const { t } = useI18n();
  const [slug, setSlug] = useState("");
  // 服务端检查结果, 仅当 slug 格式合法时才会被设置
  const [serverCheck, setServerCheck] = useState<
    "idle" | "checking" | "available" | "taken"
  >("idle");
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState("");

  // 客户端校验是 slug 的纯派生值, 不需要 effect
  const trimmed = slug.trim().toLowerCase();
  const clientStatus: "empty" | "invalid" | "ok" = !trimmed
    ? "empty"
    : SLUG_RE.test(trimmed)
    ? "ok"
    : "invalid";

  // 仅当客户端校验通过时, 异步去服务端查可用性
  // setState 都放进 setTimeout/then 回调里, 避免 effect body 同步触发
  useEffect(() => {
    if (clientStatus !== "ok") return;
    let cancelled = false;
    const id = setTimeout(async () => {
      if (cancelled) return;
      setServerCheck("checking");
      try {
        const r = await fetch(
          `/api/channels/check-slug?slug=${encodeURIComponent(trimmed)}`
        );
        const j = await r.json();
        if (!cancelled) {
          setServerCheck(j.available ? "available" : "taken");
        }
      } catch {
        if (!cancelled) setServerCheck("idle");
      }
    }, 350);
    return () => {
      cancelled = true;
      clearTimeout(id);
    };
  }, [trimmed, clientStatus]);

  // 渲染层用的合并状态
  const check: "idle" | "invalid" | "checking" | "available" | "taken" =
    clientStatus === "empty"
      ? "idle"
      : clientStatus === "invalid"
      ? "invalid"
      : serverCheck;

  const create = async () => {
    const s = slug.trim().toLowerCase();
    if (!SLUG_RE.test(s)) return;
    setCreating(true);
    setError("");
    try {
      const r = await fetch("/api/channels", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ slug: s }),
      });
      const j = await r.json();
      if (!r.ok) {
        setError(j.error || "创建失败");
        setCreating(false);
        return;
      }
      onCreated(j.channel);
    } catch {
      setError("网络错误");
      setCreating(false);
    }
  };

  const checkColor =
    check === "available"
      ? "text-accent-green"
      : check === "taken" || check === "invalid"
      ? "text-accent-pink"
      : "text-text-secondary";

  const checkLabelKey: TranslationKey | null =
    check === "checking"
      ? "channel.setup.checking"
      : check === "available"
      ? "channel.setup.available"
      : check === "taken"
      ? "channel.setup.taken"
      : check === "invalid"
      ? "channel.setup.invalid"
      : null;

  return (
    <div className="ambient-gradient min-h-screen flex items-center justify-center px-4">
      <div className="pixel-border bg-bg-card p-6 max-w-md w-full space-y-5">
        <div className="flex items-center gap-3">
          <Link
            href="/"
            className="font-[family-name:var(--font-pixel)] text-[8px] text-text-secondary hover:text-accent-cyan transition-colors"
          >
            ◁ {t("nav.backToHome")}
          </Link>
        </div>

        <div className="space-y-2">
          <h1 className="font-[family-name:var(--font-pixel)] text-[14px] text-accent-green glow-green">
            {t("channel.setup.title")}
          </h1>
          <p className="text-xs text-text-secondary leading-relaxed">
            {t("channel.setup.intro")}
          </p>
        </div>

        <div>
          <label className="block text-xs text-text-secondary mb-1.5">
            {t("channel.setup.slugLabel")}
          </label>
          <div className="flex items-center gap-2">
            <span className="text-xs text-text-secondary/60 shrink-0">
              vibelieveai.com/watch/
            </span>
            <input
              type="text"
              value={slug}
              onChange={(e) =>
                setSlug(e.target.value.replace(/[^a-zA-Z0-9-]/g, "").toLowerCase())
              }
              placeholder={t("channel.setup.slugPlaceholder")}
              className="flex-1 bg-bg-primary border-2 border-border-pixel px-3 py-2 text-sm text-text-primary placeholder:text-text-secondary/40 focus:border-accent-purple focus:outline-none transition-colors"
              maxLength={20}
              disabled={creating}
            />
          </div>
          <div className="flex items-center justify-between mt-2 min-h-[16px]">
            <span className="text-[10px] text-text-secondary/60">
              {t("channel.setup.slugHint")}
            </span>
            {checkLabelKey && (
              <span className={`text-[10px] ${checkColor}`}>
                {t(checkLabelKey)}
              </span>
            )}
          </div>
        </div>

        {error && (
          <div className="pixel-border bg-accent-pink/10 border-accent-pink/30 px-3 py-2 text-xs text-accent-pink">
            ⚠ {error}
          </div>
        )}

        <button
          onClick={create}
          disabled={check !== "available" || creating}
          className="pixel-btn border-accent-green text-accent-green hover:bg-accent-green hover:text-bg-primary w-full text-[10px] py-3 disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-transparent disabled:hover:text-accent-green"
        >
          {creating ? t("channel.setup.creating") : `▶ ${t("channel.setup.create")}`}
        </button>

        <p className="text-[10px] text-text-secondary/50 text-center">
          {t("channel.setup.note")}
        </p>
      </div>
    </div>
  );
}

// ─── Dashboard ──────────────────────────────────────────────────────
function Dashboard({
  channel,
  setChannel,
}: {
  channel: Channel;
  setChannel: (ch: Channel) => void;
}) {
  const { t } = useI18n();
  const { nickname } = useNickname();

  // ─ Broadcast state ─
  const [mode, setMode] = useState<BroadcastMode>("browser");
  const [bState, setBState] = useState<BroadcastState>("idle");
  const [viewers, setViewers] = useState(0);
  const [elapsed, setElapsed] = useState(0);
  const [error, setError] = useState("");

  // ─ OBS-specific state ─
  const [ingress, setIngress] = useState<IngressInfo | null>(null);
  const [ingressLoading, setIngressLoading] = useState(false);
  const [showStreamKey, setShowStreamKey] = useState(false);
  const [copied, setCopied] = useState<"url" | "key" | null>(null);

  // refs holding active LiveKit room/tracks/timer (lifecycle survives re-renders)
  const roomRef = useRef<Room | null>(null);
  const videoTrackRef = useRef<LocalVideoTrack | null>(null);
  const audioTrackRef = useRef<LocalAudioTrack | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const startedAtRef = useRef<number>(0);
  const previewVideoRef = useRef<HTMLVideoElement | null>(null);
  // 当前我们等待加入的 OBS 参与者身份 (= "obs-{slug}")
  const expectedObsIdentityRef = useRef<string | null>(null);

  // ─ Saved (服务端确认值) vs Draft (本地编辑值) ─
  // 字段编辑只改 draft, 不立即写库. 每个 section 用"推送更新"按钮显式提交.
  // 这样可以避免半成品被自动推送给观众 (PATCH 在直播中会同步到 live_streams).
  const [savedChannel, setSavedChannel] = useState<Channel>(channel);
  const [draftChannel, setDraftChannel] = useState<Channel>(channel);
  const [committingSection, setCommittingSection] = useState<SectionKey | null>(
    null
  );
  const [committedSection, setCommittedSection] = useState<SectionKey | null>(
    null
  );
  const committedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // 封面上传/清除是原子动作 (不像打字), 完成后自动 commit streamInfo section.
  // 这里只是个标记位 — 真正触发在下面的 useEffect 里, 等 draftChannel
  // 状态更新后再调 commitSection (否则闭包里读的是旧 draft).
  const pendingCoverCommitRef = useRef(false);

  // draftRef 给 LiveKit 异步回调读 quality 时用 (回调里需要最新值, 不通过 state)
  const draftRef = useRef(draftChannel);
  draftRef.current = draftChannel;

  // 只更新本地 draft, 不发请求
  const patchDraft = useCallback(
    (delta: Partial<Channel> & { settings?: Partial<ChannelSettings> }) => {
      setDraftChannel((prev) => ({
        ...prev,
        ...delta,
        settings: {
          ...prev.settings,
          ...(delta.settings || {}),
        },
      }));
    },
    []
  );

  // ─ Timer ─
  const startTimer = (startedAt: number) => {
    if (timerRef.current) clearInterval(timerRef.current);
    setElapsed(Math.floor((Date.now() - startedAt) / 1000));
    timerRef.current = setInterval(() => {
      setElapsed(Math.floor((Date.now() - startedAt) / 1000));
    }, 1000);
  };

  // ─ Cleanup tracks/room ─
  const cleanupBroadcast = useCallback(() => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    if (videoTrackRef.current) {
      try {
        videoTrackRef.current.stop();
      } catch {}
      videoTrackRef.current = null;
    }
    if (audioTrackRef.current) {
      try {
        audioTrackRef.current.stop();
      } catch {}
      audioTrackRef.current = null;
    }
    if (roomRef.current) {
      try {
        roomRef.current.disconnect();
      } catch {}
      roomRef.current = null;
    }
    setViewers(0);
    setElapsed(0);
    setBState("idle");
  }, []);

  // 卸载时清理 (注意: 不调用 DELETE /api/streams; 用户必须显式按"结束直播"。
  // 这对 OBS 模式尤其重要 — 关掉 dashboard 不应该停掉 OBS 推流)
  useEffect(() => {
    return () => {
      if (committedTimerRef.current) clearTimeout(committedTimerRef.current);
      cleanupBroadcast();
    };
  }, [cleanupBroadcast]);

  // ─ Section dirty 比较 + 单 section 提交 ─
  const isFieldEqual = (a: unknown, b: unknown): boolean => {
    if (a === b) return true;
    if (Array.isArray(a) && Array.isArray(b)) {
      if (a.length !== b.length) return false;
      return a.every((v, i) => v === b[i]);
    }
    // null/undefined/'' 视为同义 (用户清空字段后再恢复, 不应误报 dirty)
    const an = a == null || a === "" ? null : a;
    const bn = b == null || b === "" ? null : b;
    return an === bn;
  };

  const isSectionDirty = useCallback(
    (key: SectionKey): boolean => {
      const fields = SECTION_FIELDS[key];
      for (const c of fields.cols) {
        if (!isFieldEqual(draftChannel[c], savedChannel[c])) return true;
      }
      for (const s of fields.settings) {
        if (
          !isFieldEqual(
            (draftChannel.settings as Record<string, unknown>)[s],
            (savedChannel.settings as Record<string, unknown>)[s]
          )
        ) {
          return true;
        }
      }
      return false;
    },
    [draftChannel, savedChannel]
  );

  const commitSection = useCallback(
    async (key: SectionKey) => {
      const fields = SECTION_FIELDS[key];
      const delta: Record<string, unknown> = {};
      const settingsDelta: Record<string, unknown> = {};

      for (const c of fields.cols) {
        if (!isFieldEqual(draftChannel[c], savedChannel[c])) {
          delta[c] = draftChannel[c];
        }
      }
      for (const s of fields.settings) {
        const dv = (draftChannel.settings as Record<string, unknown>)[s];
        const sv = (savedChannel.settings as Record<string, unknown>)[s];
        if (!isFieldEqual(dv, sv)) {
          settingsDelta[s] = dv;
        }
      }
      if (Object.keys(settingsDelta).length > 0) {
        delta.settings = settingsDelta;
      }
      if (Object.keys(delta).length === 0) return;

      setError("");
      setCommittingSection(key);
      try {
        const res = await fetch("/api/channels", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(delta),
        });
        const json = await res.json();
        if (!res.ok) throw new Error(json.error || "更新失败");
        const updated = normalizeChannel(json.channel);
        setSavedChannel(updated);
        // 用服务端确认值合并 draft (其它 section 未提交的改动保留)
        setDraftChannel((prev) => {
          const merged = { ...prev } as unknown as Record<string, unknown>;
          const updatedAny = updated as unknown as Record<string, unknown>;
          for (const c of fields.cols) {
            merged[c] = updatedAny[c];
          }
          if (fields.settings.length > 0) {
            const mergedSettings: Record<string, unknown> = { ...prev.settings };
            for (const s of fields.settings) {
              mergedSettings[s] = (
                updated.settings as Record<string, unknown>
              )[s];
            }
            merged.settings = mergedSettings as ChannelSettings;
          }
          return merged as unknown as Channel;
        });
        // 同步父组件 (避免后续组件刷新时回到旧值)
        setChannel(updated);
        setCommittedSection(key);
        if (committedTimerRef.current) clearTimeout(committedTimerRef.current);
        committedTimerRef.current = setTimeout(
          () => setCommittedSection(null),
          1500
        );
      } catch (e) {
        setError(e instanceof Error ? e.message : "更新失败");
      } finally {
        setCommittingSection(null);
      }
    },
    [draftChannel, savedChannel, setChannel]
  );

  // 封面上传/清除完成后自动 commit streamInfo (复用现有的 commitSection 流程).
  // 监听 draftChannel.thumbnail_url 而不是直接在 uploadCover 末尾调用,
  // 是因为 setDraftChannel 是异步的, commitSection 闭包里读到的是旧 draft.
  // 注: ref 兜住了非封面触发的 effect 重跑 (commitSection 每次按键都会
  // 重建, 但 pendingCoverCommitRef 没置位时直接 early return).
  useEffect(() => {
    if (!pendingCoverCommitRef.current) return;
    pendingCoverCommitRef.current = false;
    commitSection("streamInfo");
  }, [draftChannel.thumbnail_url, commitSection]);

  // ─ OBS: 加载或创建 ingress ─
  const loadIngress = useCallback(async (): Promise<IngressInfo | null> => {
    try {
      const res = await fetch("/api/livekit/ingress");
      if (!res.ok) return null;
      const j = await res.json();
      return j.ingress || null;
    } catch {
      return null;
    }
  }, []);

  const generateIngress = useCallback(async () => {
    setIngressLoading(true);
    setError("");
    try {
      const res = await fetch("/api/livekit/ingress", { method: "POST" });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error || "生成失败");
      setIngress(j.ingress);
    } catch (e) {
      setError(e instanceof Error ? e.message : "生成失败");
    } finally {
      setIngressLoading(false);
    }
  }, []);

  const resetIngress = useCallback(async () => {
    if (!confirm(t("obs.resetConfirm"))) return;
    setIngressLoading(true);
    try {
      await fetch("/api/livekit/ingress", { method: "DELETE" });
      // 立即重建一个新的, 用户体验连续
      const res = await fetch("/api/livekit/ingress", { method: "POST" });
      const j = await res.json();
      if (res.ok) setIngress(j.ingress);
      else setIngress(null);
    } catch {
      setIngress(null);
    } finally {
      setIngressLoading(false);
    }
  }, [t]);

  // ─ OBS: 切到 OBS 模式时, 加载已有 ingress, 顺便连入房间监听 ─
  useEffect(() => {
    if (mode !== "obs") return;
    let cancelled = false;
    (async () => {
      const existing = await loadIngress();
      if (cancelled) return;
      if (existing) setIngress(existing);
    })();
    return () => {
      cancelled = true;
    };
  }, [mode, loadIngress]);

  // ─ OBS: 当有 ingress 时, 连接 LiveKit 房间作为观察者, 监听 OBS 参与者加入 ─
  useEffect(() => {
    if (mode !== "obs") return;
    if (!ingress) return;
    if (roomRef.current) return; // 已经连过了

    let cancelled = false;
    (async () => {
      try {
        const tokenRes = await fetch("/api/livekit/token", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            room: channel.slug,
            identity: nickname || "主播",
            isPublisher: true,
          }),
        });
        if (!tokenRes.ok) return;
        const { token } = await tokenRes.json();
        const livekitUrl = process.env.NEXT_PUBLIC_LIVEKIT_URL;
        if (!livekitUrl || cancelled) return;

        const room = new Room({ adaptiveStream: true, dynacast: true });
        expectedObsIdentityRef.current = ingress.participant_identity;

        room.on(RoomEvent.ParticipantConnected, (p: RemoteParticipant) => {
          setViewers(room.remoteParticipants.size);
          if (p.identity === expectedObsIdentityRef.current) {
            // OBS 推流端连上了 — 自动登记 live_streams 行 + 切换到 live 状态
            handleObsConnected();
          }
        });
        room.on(RoomEvent.ParticipantDisconnected, (p: RemoteParticipant) => {
          setViewers(room.remoteParticipants.size);
          if (p.identity === expectedObsIdentityRef.current) {
            // OBS 推流端断了 — 把 live 状态退回, 但不删 live_streams
            // (用户可能正在重连, 让他们手动按"结束直播"才真正结束)
            setBState("previewing");
            setElapsed(0);
            if (timerRef.current) {
              clearInterval(timerRef.current);
              timerRef.current = null;
            }
          }
        });
        room.on(
          RoomEvent.TrackSubscribed,
          (track: RemoteTrack, _pub: RemoteTrackPublication, p: RemoteParticipant) => {
            if (
              p.identity === expectedObsIdentityRef.current &&
              track.kind === Track.Kind.Video &&
              previewVideoRef.current
            ) {
              track.attach(previewVideoRef.current);
            }
          }
        );

        await room.connect(livekitUrl, token);
        if (cancelled) {
          room.disconnect();
          return;
        }
        roomRef.current = room;

        // 如果 OBS 已经在推流 (页面刷新场景), 房间内可能已有该参与者
        const existingObs = Array.from(room.remoteParticipants.values()).find(
          (p) => p.identity === expectedObsIdentityRef.current
        );
        if (existingObs) {
          handleObsConnected();
          // 立即 attach 已有的 track
          existingObs.videoTrackPublications.forEach((pub) => {
            if (pub.track && previewVideoRef.current) {
              pub.track.attach(previewVideoRef.current);
            }
          });
        } else {
          setBState("previewing"); // 等待 OBS
        }
      } catch (e) {
        setError(e instanceof Error ? e.message : "连接失败");
      }
    })();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, ingress?.ingress_id]);

  // ─ OBS connected → 创建 live_streams 行 ─
  const handleObsConnected = useCallback(async () => {
    // 校验 saved 值 — 因为 POST /api/streams 会从 channels 表读取写入 live_streams,
    // 用户必须先"推送更新" stream info, 否则观众看到的是旧标题
    if (!savedChannel.title.trim()) {
      setError(
        '请先填写直播标题并点击 "推送更新", 然后让 OBS 重新连接'
      );
      return;
    }
    try {
      const res = await fetch("/api/streams", { method: "POST" });
      if (!res.ok) {
        const j = await res.json();
        throw new Error(j.error || "登记失败");
      }
      startedAtRef.current = Date.now();
      startTimer(startedAtRef.current);
      setBState("live");
    } catch (e) {
      setError(e instanceof Error ? e.message : "登记失败");
    }
  }, [savedChannel.title]);

  // ─ Switch mode: 清理之前的连接 ─
  const switchMode = useCallback(
    (next: BroadcastMode) => {
      if (next === mode) return;
      // 如果当前正在直播或预览, 切换前先清理
      cleanupBroadcast();
      setError("");
      setMode(next);
    },
    [mode, cleanupBroadcast]
  );

  // ─ Copy helpers ─
  const copy = async (kind: "url" | "key", text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(kind);
      setTimeout(() => setCopied(null), 1500);
    } catch {}
  };

  // ─ Pick screen source: connect LiveKit + create local tracks (no publish) ─
  const pickScreenSource = useCallback(async () => {
    setError("");
    // 如果之前已有预览, 先清理
    if (videoTrackRef.current) {
      try {
        videoTrackRef.current.stop();
      } catch {}
      videoTrackRef.current = null;
    }
    if (audioTrackRef.current) {
      try {
        audioTrackRef.current.stop();
      } catch {}
      audioTrackRef.current = null;
    }

    try {
      // 1. 取 LiveKit token
      const tokenRes = await fetch("/api/livekit/token", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          room: channel.slug,
          identity: nickname || "主播",
          isPublisher: true,
        }),
      });
      if (!tokenRes.ok) {
        const j = await tokenRes.json();
        throw new Error(j.error || "token 获取失败");
      }
      const { token } = await tokenRes.json();
      const livekitUrl = process.env.NEXT_PUBLIC_LIVEKIT_URL;
      if (!livekitUrl) throw new Error("未配置 LiveKit URL");

      // 2. 连接房间 (不发布任何 track)
      if (!roomRef.current) {
        const room = new Room({ adaptiveStream: true, dynacast: true });
        room.on(RoomEvent.ParticipantConnected, () => {
          setViewers(room.remoteParticipants.size);
        });
        room.on(RoomEvent.ParticipantDisconnected, () => {
          setViewers(room.remoteParticipants.size);
        });
        room.on(RoomEvent.Disconnected, () => {
          cleanupBroadcast();
        });
        await room.connect(livekitUrl, token);
        roomRef.current = room;
      }

      // 3. 创建本地屏幕 track (会触发浏览器屏幕选择 UI)
      const quality = (draftRef.current.quality as QualityLevel) || "1080p";
      const preset = QUALITY_PRESETS[quality];
      const tracks: LocalTrack[] = await createLocalScreenTracks({
        audio: true,
        resolution: preset.resolution,
        contentHint: "detail",
      });

      for (const track of tracks) {
        if (track.kind === Track.Kind.Video) {
          videoTrackRef.current = track as LocalVideoTrack;
          // 用户在浏览器内点"停止共享"时自动清理
          const ms = (track as LocalVideoTrack).mediaStreamTrack;
          if (ms) {
            ms.addEventListener("ended", () => {
              cleanupBroadcast();
            });
          }
        } else if (track.kind === Track.Kind.Audio) {
          audioTrackRef.current = track as LocalAudioTrack;
        }
      }

      // 4. 本地预览
      if (videoTrackRef.current && previewVideoRef.current) {
        videoTrackRef.current.attach(previewVideoRef.current);
      }

      setBState("previewing");
    } catch (e) {
      setError(e instanceof Error ? e.message : t("goLive.error.previewFailed"));
      cleanupBroadcast();
    }
  }, [channel.slug, nickname, t, cleanupBroadcast]);

  // 当预览状态下挂载/重挂载 video 元素, 重新 attach
  useEffect(() => {
    if (
      (bState === "previewing" || bState === "live") &&
      videoTrackRef.current &&
      previewVideoRef.current
    ) {
      videoTrackRef.current.attach(previewVideoRef.current);
    }
  }, [bState]);

  // ─ Start broadcast: publish tracks + insert live_streams row ─
  const startBroadcast = useCallback(async () => {
    if (!roomRef.current || !videoTrackRef.current) return;
    // 校验 saved 值 — 因为 POST /api/streams 写 live_streams 时
    // 是从 channels 表读取的, 必须先"推送更新"才能让观众看到
    if (!savedChannel.title.trim()) {
      setError('请先填写直播标题并点击 "推送更新"');
      return;
    }
    setBState("publishing");
    setError("");
    try {
      const quality = (draftRef.current.quality as QualityLevel) || "1080p";
      const preset = QUALITY_PRESETS[quality];

      await roomRef.current.localParticipant.publishTrack(
        videoTrackRef.current,
        {
          source: Track.Source.ScreenShare,
          videoEncoding: preset.encoding,
          simulcast: false,
        }
      );
      if (audioTrackRef.current) {
        await roomRef.current.localParticipant.publishTrack(
          audioTrackRef.current,
          { source: Track.Source.ScreenShareAudio }
        );
      }

      // 注册到数据库
      const res = await fetch("/api/streams", { method: "POST" });
      if (!res.ok) {
        const j = await res.json();
        throw new Error(j.error || "开播失败");
      }

      startedAtRef.current = Date.now();
      startTimer(startedAtRef.current);
      setBState("live");
    } catch (e) {
      setError(e instanceof Error ? e.message : t("goLive.error.publishFailed"));
      // 失败回到预览态 (track 还在, 不重新选源)
      setBState("previewing");
    }
  }, [savedChannel.title, t]);

  // ─ Stop broadcast: archive + cleanup ─
  const stopBroadcast = useCallback(async () => {
    try {
      await fetch("/api/streams", { method: "DELETE" });
    } catch {}
    cleanupBroadcast();
  }, [cleanupBroadcast]);

  // ─ Cover upload (Supabase storage) ─
  const [uploading, setUploading] = useState(false);
  const uploadCover = async (file: File) => {
    if (file.size > 2 * 1024 * 1024) {
      setError("封面图不能超过 2MB");
      return;
    }
    setUploading(true);
    try {
      const supabase = createClient();
      if (!supabase) throw new Error("未配置");
      const {
        data: { user },
      } = await supabase.auth.getUser();
      const ext = file.name.split(".").pop()?.toLowerCase() || "jpg";
      const path = `${user?.id || "anon"}/${Date.now()}.${ext}`;
      const { error: upErr } = await supabase.storage
        .from("thumbnails")
        .upload(path, file, { upsert: true });
      if (upErr) throw upErr;
      const {
        data: { publicUrl },
      } = supabase.storage.from("thumbnails").getPublicUrl(path);
      // 封面是原子用户动作 (选完文件就完成了), 不像打字需要"推送更新".
      // 标记 pending → patchDraft 触发 re-render → useEffect 自动 commit.
      pendingCoverCommitRef.current = true;
      patchDraft({ thumbnail_url: publicUrl });
    } catch {
      setError("封面图上传失败");
    } finally {
      setUploading(false);
    }
  };

  const formatElapsed = (s: number) => {
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const sec = s % 60;
    return `${h > 0 ? `${h}:` : ""}${String(m).padStart(2, "0")}:${String(
      sec
    ).padStart(2, "0")}`;
  };

  const isLiveOrPublishing = bState === "live" || bState === "publishing";

  return (
    <div className="ambient-gradient min-h-screen">
      <div className="mx-auto max-w-[1400px] px-4 py-6">
        {/* ─ Header ─ */}
        <div className="flex items-center gap-3 mb-5">
          <Link
            href="/"
            className="font-[family-name:var(--font-pixel)] text-[8px] text-text-secondary hover:text-accent-cyan transition-colors"
          >
            ◁ {t("nav.backToHome")}
          </Link>
          <span className="text-border-pixel">│</span>
          <h1 className="font-[family-name:var(--font-pixel)] text-[14px] text-accent-green glow-green">
            {t("goLive.dashboard")}
          </h1>
          <span className="text-border-pixel">│</span>
          <Link
            href={`/watch/${channel.slug}`}
            className="font-[family-name:var(--font-pixel)] text-[8px] text-accent-cyan hover:underline"
          >
            /watch/{channel.slug} ↗
          </Link>
          <div className="flex-1" />
          {committingSection && (
            <span className="font-[family-name:var(--font-pixel)] text-[8px] text-accent-yellow animate-pulse">
              {t("goLive.section.updating")}
            </span>
          )}
          {!committingSection && committedSection && (
            <span className="font-[family-name:var(--font-pixel)] text-[8px] text-accent-green/80">
              {t("goLive.section.updated")}
            </span>
          )}
        </div>

        {error && (
          <div className="pixel-border bg-accent-pink/10 border-accent-pink/30 px-3 py-2 text-xs text-accent-pink mb-4">
            ⚠ {error}
          </div>
        )}

        {/* ─ Main grid: left = preview, right = settings ─ */}
        <div className="grid grid-cols-1 lg:grid-cols-[1fr_420px] gap-4">
          {/* ─ Left: Preview Panel ─ */}
          <div className="space-y-3">
            {/* Mode toggle */}
            <div className="flex gap-1 p-1 bg-bg-primary/40 border border-border-pixel/50 w-fit">
              {(["browser", "obs"] as BroadcastMode[]).map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => switchMode(m)}
                  className={`px-3 py-1.5 text-[9px] font-[family-name:var(--font-pixel)] transition-all ${
                    mode === m
                      ? "bg-accent-cyan/15 text-accent-cyan shadow-[0_0_6px_var(--glow-cyan)]"
                      : "text-text-secondary hover:text-text-primary"
                  }`}
                >
                  {t(m === "browser" ? "obs.modeBrowser" : "obs.modeObs")}
                </button>
              ))}
            </div>

            <div className="relative pixel-border-live aspect-video bg-bg-primary overflow-hidden">
              {/* Preview video element (always rendered, hidden when idle) */}
              <video
                ref={previewVideoRef}
                autoPlay
                muted
                playsInline
                className={`w-full h-full object-contain ${
                  bState === "idle" ? "hidden" : ""
                }`}
              />

              {/* Empty placeholder — different per mode */}
              {bState === "idle" && mode === "browser" && (
                <div className="absolute inset-0 flex flex-col items-center justify-center gap-3">
                  <span className="text-5xl opacity-30">🖥</span>
                  <span className="font-[family-name:var(--font-pixel)] text-[10px] text-text-secondary">
                    {t("goLive.preview.empty")}
                  </span>
                  <span className="text-[10px] text-text-secondary/50">
                    {t("goLive.preview.hint")}
                  </span>
                </div>
              )}
              {bState === "idle" && mode === "obs" && (
                <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 px-4 text-center">
                  <span className="text-5xl opacity-30">📡</span>
                  <span className="font-[family-name:var(--font-pixel)] text-[10px] text-text-secondary">
                    {t("obs.title")}
                  </span>
                  <span className="text-[10px] text-text-secondary/50 max-w-sm">
                    {t("obs.intro")}
                  </span>
                </div>
              )}
              {bState === "previewing" && mode === "obs" && (
                <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 px-4 text-center">
                  <span className="text-4xl opacity-50 animate-pulse">📡</span>
                  <span className="font-[family-name:var(--font-pixel)] text-[10px] text-accent-yellow animate-pulse">
                    {t("obs.waitingTitle")}
                  </span>
                  <span className="text-[10px] text-text-secondary/60 max-w-sm">
                    {t("obs.waitingHint")}
                  </span>
                </div>
              )}

              {/* HUD overlays */}
              {bState === "previewing" && (
                <div className="absolute top-3 left-3 z-20">
                  <span className="hud-panel px-2 py-1 font-[family-name:var(--font-pixel)] text-[8px] text-accent-yellow">
                    {t("goLive.preview.previewing")}
                  </span>
                </div>
              )}
              {isLiveOrPublishing && (
                <div className="absolute top-3 left-3 z-20 flex items-center gap-2">
                  <span className="viewer-badge text-[9px]">
                    <span className="live-dot inline-block w-2 h-2 rounded-full bg-white" />
                    LIVE
                  </span>
                  <span className="hud-panel px-2 py-1 font-[family-name:var(--font-pixel)] text-[8px] text-text-secondary">
                    👁 {viewers}
                  </span>
                </div>
              )}
              {isLiveOrPublishing && (
                <div className="absolute top-3 right-3 z-20">
                  <span className="hud-panel px-2 py-1 font-[family-name:var(--font-pixel)] text-[8px] text-accent-yellow">
                    ⏱ {formatElapsed(elapsed)}
                  </span>
                </div>
              )}
            </div>

            {/* Action bar */}
            <div className="hud-panel p-3 flex flex-wrap items-center gap-3">
              {/* Browser-mode buttons */}
              {mode === "browser" && bState === "idle" && (
                <button
                  onClick={pickScreenSource}
                  className="pixel-btn border-accent-cyan text-accent-cyan hover:bg-accent-cyan hover:text-bg-primary text-[10px] px-4 py-2"
                >
                  {t("goLive.preview.selectSource")}
                </button>
              )}
              {mode === "browser" && bState === "previewing" && (
                <>
                  <button
                    onClick={startBroadcast}
                    disabled={!savedChannel.title.trim()}
                    className="pixel-btn border-accent-green text-accent-green hover:bg-accent-green hover:text-bg-primary text-[10px] px-4 py-2 disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-transparent disabled:hover:text-accent-green"
                  >
                    {t("goLive.btn.startBroadcast")}
                  </button>
                  <button
                    onClick={pickScreenSource}
                    className="pixel-btn border-border-pixel text-text-secondary hover:border-accent-cyan hover:text-accent-cyan text-[10px] px-3 py-2"
                  >
                    {t("goLive.preview.changeSource")}
                  </button>
                </>
              )}
              {bState === "publishing" && (
                <span className="font-[family-name:var(--font-pixel)] text-[10px] text-accent-yellow animate-pulse">
                  {t("status.connecting")}
                </span>
              )}
              {bState === "live" && (
                <button
                  onClick={stopBroadcast}
                  className="pixel-btn border-accent-pink text-accent-pink hover:bg-accent-pink hover:text-white text-[10px] px-4 py-2"
                >
                  {t("goLive.btn.stopBroadcast")}
                </button>
              )}
              {/* OBS mode hint */}
              {mode === "obs" && bState === "previewing" && !error && (
                <span className="font-[family-name:var(--font-pixel)] text-[9px] text-accent-yellow">
                  {t("obs.waitingTitle")}
                </span>
              )}
              <div className="flex-1" />
              <span className="text-[10px] text-text-secondary/60">
                {t("goLive.streamer")}: <span className="text-accent-cyan">{nickname}</span>
              </span>
            </div>

            {/* StreamInfo 同步提示: 解释为什么"开始直播"按钮 disabled, 或为什么直播中改了字段观众没看到.
                两种触发条件:
                  1. saved.title 为空 → 还没"推送更新"过任何标题, 按钮 disabled
                  2. streamInfo dirty → 用户改了 draft 但没推送, 观众看到的还是旧值
                只在 idle 之外的状态显示 (用户准备开播 / 在直播中) */}
            {bState !== "idle" && !savedChannel.title.trim() && (
              <div className="pixel-border bg-accent-yellow/10 border-accent-yellow/40 px-3 py-2 text-[10px] text-accent-yellow">
                {t("goLive.streamInfo.titleMissing")}
              </div>
            )}
            {bState !== "idle" &&
              savedChannel.title.trim() &&
              isSectionDirty("streamInfo") && (
                <div className="pixel-border bg-accent-pink/10 border-accent-pink/40 px-3 py-2 text-[10px] text-accent-pink">
                  {t("goLive.streamInfo.dirtyWarning")}
                </div>
              )}

            {/* OBS panel (URL + key + steps) */}
            {mode === "obs" && (
              <ObsPanel
                ingress={ingress}
                loading={ingressLoading}
                showStreamKey={showStreamKey}
                onToggleShow={() => setShowStreamKey((v) => !v)}
                onGenerate={generateIngress}
                onReset={resetIngress}
                onCopy={copy}
                copied={copied}
              />
            )}
          </div>

          {/* ─ Right: Settings Form ─ */}
          <div className="space-y-3">
            <SettingsSection
              title={t("goLive.section.streamInfo")}
              accentClass="text-accent-purple"
              dirty={isSectionDirty("streamInfo")}
              committing={committingSection === "streamInfo"}
              committed={committedSection === "streamInfo"}
              onCommit={() => commitSection("streamInfo")}
            >
              {/* Title */}
              <Field label={t("goLive.streamTitleRequired")}>
                <input
                  type="text"
                  value={draftChannel.title}
                  onChange={(e) => patchDraft({ title: e.target.value })}
                  placeholder={t("goLive.roomPlaceholder")}
                  maxLength={200}
                  className="w-full bg-bg-primary border border-border-pixel px-3 py-2 text-sm text-text-primary placeholder:text-text-secondary/30 focus:border-accent-purple focus:outline-none transition-colors"
                />
              </Field>

              {/* Cover */}
              <Field label={t("goLive.cover")}>
                <CoverPicker
                  url={draftChannel.thumbnail_url}
                  uploading={uploading}
                  onPick={uploadCover}
                  onClear={() => {
                    // 同样走自动 commit (清除也是原子动作)
                    pendingCoverCommitRef.current = true;
                    patchDraft({ thumbnail_url: "" });
                  }}
                />
              </Field>

              {/* Category */}
              <Field label={t("goLive.category")}>
                <select
                  value={draftChannel.settings.category || ""}
                  onChange={(e) =>
                    patchDraft({ settings: { category: e.target.value } })
                  }
                  className="w-full bg-bg-primary border border-border-pixel px-3 py-2 text-sm text-text-primary focus:border-accent-purple focus:outline-none transition-colors"
                >
                  <option value="">— {t("goLive.categoryPick")} —</option>
                  {CATEGORY_OPTIONS.map((c) => (
                    <option key={c} value={c}>
                      {t(`category.${c}` as TranslationKey)}
                    </option>
                  ))}
                </select>
              </Field>

              {/* Platforms */}
              <Field label={t("goLive.platforms")}>
                <div className="flex flex-wrap gap-1.5">
                  {PLATFORM_OPTIONS.map((p) => {
                    const active = (draftChannel.settings.platforms || []).includes(p);
                    return (
                      <button
                        key={p}
                        type="button"
                        onClick={() => {
                          const cur = draftChannel.settings.platforms || [];
                          const next = active
                            ? cur.filter((x) => x !== p)
                            : [...cur, p];
                          patchDraft({ settings: { platforms: next } });
                        }}
                        className={`px-2.5 py-1 text-[10px] border-2 transition-colors ${
                          active
                            ? "border-accent-cyan text-accent-cyan bg-accent-cyan/10"
                            : "border-border-pixel text-text-secondary hover:border-text-secondary"
                        }`}
                      >
                        {t(`platform.${p}` as TranslationKey)}
                      </button>
                    );
                  })}
                </div>
              </Field>

              {/* Tags */}
              <Field label={t("goLive.tags")}>
                <input
                  type="text"
                  value={draftChannel.settings.tags || ""}
                  onChange={(e) =>
                    patchDraft({ settings: { tags: e.target.value } })
                  }
                  placeholder={t("goLive.tagsPlaceholder")}
                  maxLength={200}
                  className="w-full bg-bg-primary border border-border-pixel px-3 py-2 text-sm text-text-primary placeholder:text-text-secondary/30 focus:border-accent-purple focus:outline-none transition-colors"
                />
              </Field>
            </SettingsSection>

            <SettingsSection
              title={t("goLive.section.projectInfo")}
              accentClass="text-accent-green"
              dirty={isSectionDirty("projectInfo")}
              committing={committingSection === "projectInfo"}
              committed={committedSection === "projectInfo"}
              onCommit={() => commitSection("projectInfo")}
            >
              <Field label={t("goLive.projectName")}>
                <input
                  type="text"
                  value={draftChannel.project_name}
                  onChange={(e) =>
                    patchDraft({ project_name: e.target.value })
                  }
                  placeholder={t("goLive.projectQuestion")}
                  maxLength={200}
                  className="w-full bg-bg-primary border border-border-pixel px-3 py-2 text-sm text-text-primary placeholder:text-text-secondary/30 focus:border-accent-purple focus:outline-none transition-colors"
                />
              </Field>

              <Field label={t("goLive.projectDesc")}>
                <textarea
                  value={draftChannel.project_desc}
                  onChange={(e) =>
                    patchDraft({ project_desc: e.target.value })
                  }
                  placeholder={t("goLive.projectDescPlaceholder")}
                  rows={3}
                  maxLength={1000}
                  className="w-full bg-bg-primary border border-border-pixel px-3 py-2 text-sm text-text-primary placeholder:text-text-secondary/30 focus:border-accent-purple focus:outline-none transition-colors resize-none"
                />
              </Field>

              <Field label={t("goLive.projectStage")}>
                <div className="flex flex-wrap gap-1.5">
                  {STAGE_OPTIONS.map((s) => (
                    <button
                      key={s.value}
                      type="button"
                      onClick={() => patchDraft({ project_stage: s.value })}
                      className={`px-2 py-1 text-[10px] border transition-colors ${
                        draftChannel.project_stage === s.value
                          ? "border-accent-cyan text-accent-cyan bg-accent-cyan/10"
                          : "border-border-pixel text-text-secondary hover:border-text-secondary"
                      }`}
                    >
                      {t(s.labelKey as TranslationKey)}
                    </button>
                  ))}
                </div>
              </Field>

              <Field label={t("goLive.projectUrl")}>
                <input
                  type="url"
                  value={draftChannel.project_url}
                  onChange={(e) => patchDraft({ project_url: e.target.value })}
                  placeholder={t("goLive.projectUrlPlaceholder")}
                  maxLength={500}
                  className="w-full bg-bg-primary border border-border-pixel px-3 py-2 text-sm text-text-primary placeholder:text-text-secondary/30 focus:border-accent-purple focus:outline-none transition-colors"
                />
              </Field>
            </SettingsSection>

            <SettingsSection
              title={t("goLive.section.tech")}
              accentClass="text-accent-cyan"
              dirty={isSectionDirty("tech")}
              committing={committingSection === "tech"}
              committed={committedSection === "tech"}
              onCommit={() => commitSection("tech")}
            >
              <Field label={t("goLive.tool")}>
                <div className="flex flex-wrap gap-1.5">
                  {TOOL_OPTIONS.map((tool) => (
                    <button
                      key={tool.key}
                      type="button"
                      onClick={() => patchDraft({ coding_tool: tool.key })}
                      className={`px-2.5 py-1 text-[10px] border-2 transition-colors ${
                        draftChannel.coding_tool === tool.key
                          ? "border-accent-purple text-accent-purple bg-accent-purple/10"
                          : "border-border-pixel text-text-secondary hover:border-text-secondary"
                      }`}
                    >
                      {tool.labelKey ? t(tool.labelKey) : tool.label}
                    </button>
                  ))}
                </div>
              </Field>

              <Field label={t("goLive.quality")}>
                <div className="flex gap-1.5">
                  {QUALITY_OPTIONS.map((q) => (
                    <button
                      key={q.value}
                      type="button"
                      onClick={() => patchDraft({ quality: q.value })}
                      className={`flex-1 py-1.5 text-[8px] font-[family-name:var(--font-pixel)] border-2 transition-colors ${
                        draftChannel.quality === q.value
                          ? "border-accent-cyan text-accent-cyan bg-accent-cyan/10"
                          : "border-border-pixel text-text-secondary hover:border-text-secondary"
                      }`}
                    >
                      {q.labelKey.startsWith("goLive.")
                        ? t(q.labelKey as TranslationKey)
                        : q.labelKey}
                    </button>
                  ))}
                </div>
              </Field>
            </SettingsSection>

            <SettingsSection
              title={t("goLive.section.chat")}
              accentClass="text-accent-pink"
              dirty={isSectionDirty("chat")}
              committing={committingSection === "chat"}
              committed={committedSection === "chat"}
              onCommit={() => commitSection("chat")}
            >
              {/* Slow mode */}
              <Field label={t("goLive.chat.slowMode")}>
                <div className="flex items-center gap-2 flex-wrap">
                  <ToggleButton
                    enabled={!!draftChannel.settings.slow_mode_enabled}
                    onChange={(v) =>
                      patchDraft({ settings: { slow_mode_enabled: v } })
                    }
                  />
                  <select
                    value={draftChannel.settings.slow_mode_seconds || 5}
                    disabled={!draftChannel.settings.slow_mode_enabled}
                    onChange={(e: ChangeEvent<HTMLSelectElement>) =>
                      patchDraft({
                        settings: { slow_mode_seconds: Number(e.target.value) },
                      })
                    }
                    className="bg-bg-primary border border-border-pixel px-2 py-1 text-xs text-text-primary disabled:opacity-40 focus:border-accent-pink focus:outline-none"
                  >
                    {SLOW_MODE_OPTIONS.map((s) => (
                      <option key={s} value={s}>
                        {t("goLive.chat.slowModeSeconds").replace("{n}", String(s))}
                      </option>
                    ))}
                  </select>
                  <span className="text-[10px] text-text-secondary/60">
                    {t("goLive.chat.slowModeHint")}
                  </span>
                </div>
              </Field>

              {/* Followers only (disabled, "coming soon") */}
              <Field label={t("goLive.chat.followersOnly")}>
                <div className="flex items-center gap-2">
                  <ToggleButton enabled={false} disabled onChange={() => {}} />
                  <span className="text-[10px] text-text-secondary/40 italic">
                    {t("goLive.chat.followersOnlyComing")}
                  </span>
                </div>
              </Field>
            </SettingsSection>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Sub-components ────────────────────────────────────────────────

function SettingsSection({
  title,
  accentClass,
  dirty,
  committing,
  committed,
  onCommit,
  children,
}: {
  title: string;
  accentClass: string;
  dirty: boolean;
  committing: boolean;
  committed: boolean;
  onCommit: () => void;
  children: React.ReactNode;
}) {
  const { t } = useI18n();
  // 状态优先级: 推送中 > 刚推送完 > 有未保存 > 已同步
  const statusLabel = committing
    ? t("goLive.section.updating")
    : committed
    ? t("goLive.section.updated")
    : dirty
    ? t("goLive.section.dirty")
    : t("goLive.section.clean");
  const statusColor = committing
    ? "text-accent-yellow animate-pulse"
    : committed
    ? "text-accent-green"
    : dirty
    ? "text-accent-pink"
    : "text-text-secondary/50";
  return (
    <div className="pixel-border bg-bg-card p-4 space-y-3">
      <div className="flex items-center gap-2">
        <span className={`font-[family-name:var(--font-pixel)] text-[8px] ${accentClass}`}>
          ◈
        </span>
        <span className="font-[family-name:var(--font-pixel)] text-[9px] text-text-secondary">
          {title}
        </span>
        <div className="flex-1" />
        <span className={`text-[9px] ${statusColor}`}>{statusLabel}</span>
      </div>
      <div className="space-y-3">{children}</div>
      <div className="pt-2 border-t border-border-pixel/30 flex justify-end">
        <button
          type="button"
          onClick={onCommit}
          disabled={!dirty || committing}
          className={`pixel-btn text-[9px] px-3 py-1.5 transition-colors ${
            dirty && !committing
              ? `border-accent-cyan text-accent-cyan hover:bg-accent-cyan hover:text-bg-primary`
              : `border-border-pixel text-text-secondary/40 cursor-not-allowed`
          }`}
        >
          {committing
            ? t("goLive.section.updating")
            : t("goLive.section.update")}
        </button>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-xs text-text-secondary mb-1.5">{label}</label>
      {children}
    </div>
  );
}

function ToggleButton({
  enabled,
  disabled,
  onChange,
}: {
  enabled: boolean;
  disabled?: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={() => onChange(!enabled)}
      className={`relative inline-flex items-center w-9 h-5 transition-colors border-2 ${
        enabled
          ? "border-accent-green bg-accent-green/30"
          : "border-border-pixel bg-bg-primary"
      } ${disabled ? "opacity-40 cursor-not-allowed" : "cursor-pointer"}`}
    >
      <span
        className={`absolute top-0 w-3 h-3 bg-text-primary transition-transform ${
          enabled ? "translate-x-4" : "translate-x-0.5"
        }`}
      />
    </button>
  );
}

function ObsPanel({
  ingress,
  loading,
  showStreamKey,
  onToggleShow,
  onGenerate,
  onReset,
  onCopy,
  copied,
}: {
  ingress: IngressInfo | null;
  loading: boolean;
  showStreamKey: boolean;
  onToggleShow: () => void;
  onGenerate: () => void;
  onReset: () => void;
  onCopy: (kind: "url" | "key", text: string) => void;
  copied: "url" | "key" | null;
}) {
  const { t } = useI18n();
  return (
    <div className="pixel-border bg-bg-card p-4 space-y-3">
      <div className="flex items-center gap-2">
        <span className="font-[family-name:var(--font-pixel)] text-[8px] text-accent-pink">◈</span>
        <span className="font-[family-name:var(--font-pixel)] text-[9px] text-text-secondary">
          {t("obs.title")}
        </span>
      </div>

      {!ingress ? (
        <button
          type="button"
          onClick={onGenerate}
          disabled={loading}
          className="pixel-btn border-accent-pink text-accent-pink hover:bg-accent-pink hover:text-white text-[10px] px-4 py-2 disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-transparent disabled:hover:text-accent-pink"
        >
          {loading ? t("obs.generating") : t("obs.generate")}
        </button>
      ) : (
        <>
          {/* URL */}
          <div>
            <label className="block text-[10px] text-text-secondary mb-1">
              {t("obs.url")}
            </label>
            <div className="flex gap-2">
              <input
                type="text"
                readOnly
                value={ingress.url}
                className="flex-1 bg-bg-primary border border-border-pixel px-2 py-1.5 text-xs text-text-primary font-mono select-all"
              />
              <button
                type="button"
                onClick={() => onCopy("url", ingress.url)}
                className="pixel-btn border-accent-cyan text-accent-cyan hover:bg-accent-cyan hover:text-bg-primary text-[9px] px-3 py-1.5"
              >
                {copied === "url" ? t("obs.copied") : t("obs.copy")}
              </button>
            </div>
          </div>

          {/* Stream key */}
          <div>
            <label className="block text-[10px] text-text-secondary mb-1">
              {t("obs.streamKey")}
            </label>
            <div className="flex gap-2">
              <input
                type={showStreamKey ? "text" : "password"}
                readOnly
                value={ingress.stream_key}
                className="flex-1 bg-bg-primary border border-border-pixel px-2 py-1.5 text-xs text-text-primary font-mono select-all"
              />
              <button
                type="button"
                onClick={onToggleShow}
                className="pixel-btn border-border-pixel text-text-secondary hover:border-text-secondary hover:text-text-primary text-[9px] px-3 py-1.5"
              >
                {showStreamKey ? t("obs.hide") : t("obs.show")}
              </button>
              <button
                type="button"
                onClick={() => onCopy("key", ingress.stream_key)}
                className="pixel-btn border-accent-cyan text-accent-cyan hover:bg-accent-cyan hover:text-bg-primary text-[9px] px-3 py-1.5"
              >
                {copied === "key" ? t("obs.copied") : t("obs.copy")}
              </button>
            </div>
          </div>

          {/* Steps */}
          <div className="text-[10px] text-text-secondary/70 space-y-1 pt-1 border-t border-border-pixel/30">
            <div className="font-[family-name:var(--font-pixel)] text-[8px] text-text-secondary mb-1">
              {t("obs.steps.title")}
            </div>
            <div>1. {t("obs.steps.s1")}</div>
            <div>2. {t("obs.steps.s2")}</div>
            <div>3. {t("obs.steps.s3")}</div>
            <div>4. {t("obs.steps.s4")}</div>
            <div>5. {t("obs.steps.s5")}</div>
          </div>

          {/* Reset */}
          <div className="pt-2 border-t border-border-pixel/30">
            <button
              type="button"
              onClick={onReset}
              disabled={loading}
              className="text-[10px] text-text-secondary/60 hover:text-accent-pink transition-colors disabled:opacity-40"
            >
              ↻ {t("obs.reset")}
            </button>
          </div>
        </>
      )}
    </div>
  );
}

function CoverPicker({
  url,
  uploading,
  onPick,
  onClear,
}: {
  url: string;
  uploading: boolean;
  onPick: (file: File) => void;
  onClear: () => void;
}) {
  return (
    <div className="flex items-center gap-3">
      {url ? (
        <div className="relative w-24 h-14 border border-border-pixel overflow-hidden shrink-0 bg-bg-primary">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={url} alt="cover" className="w-full h-full object-cover" />
          <button
            type="button"
            onClick={onClear}
            className="absolute top-0.5 right-0.5 w-4 h-4 bg-black/60 text-white text-[8px] flex items-center justify-center hover:bg-accent-pink transition-colors"
          >
            ✕
          </button>
        </div>
      ) : (
        <label className="cursor-pointer flex items-center gap-2 px-3 py-2 border-2 border-dashed border-border-pixel hover:border-accent-purple text-text-secondary hover:text-accent-purple transition-colors text-xs">
          <span>{uploading ? "上传中..." : "📷 选择图片"}</span>
          <input
            type="file"
            accept="image/*"
            className="hidden"
            disabled={uploading}
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) onPick(f);
            }}
          />
        </label>
      )}
      <span className="text-[10px] text-text-secondary/50">展示在大厅直播列表中</span>
    </div>
  );
}
