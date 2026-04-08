"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { useI18n } from "@/lib/i18n/context";

type Tab = "streams" | "following" | "followers" | "favorites" | "achievements";

interface FollowEntry {
  id: string;
  created_at: string;
  profiles: {
    id: string;
    display_name: string;
    avatar_url: string | null;
    username: string;
    bio: string;
    followers_count: number;
  };
}

interface FavoriteEntry {
  id: string;
  room_name: string;
  stream_title: string;
  streamer_name: string;
  created_at: string;
}

interface StreamEntry {
  id: string;
  room_name: string;
  title: string;
  project_name: string;
  coding_tool: string;
  status: string;
  thumbnail_url: string;
  started_at: string;
  ended_at: string | null;
  // Postgres generated column (007_channels_and_history.sql:90):
  // greatest(0, extract(epoch from (ended_at - started_at))::int)
  duration_seconds?: number;
}

interface Profile {
  display_name: string;
  username: string;
  avatar_url: string | null;
  bio: string;
  followers_count: number;
  created_at: string;
}

const ACHIEVEMENTS_DATA = [
  { icon: "👁", nameKey: "achievement.first_watch.name", descKey: "achievement.first_watch.desc", unlocked: true },
  { icon: "🚀", nameKey: "achievement.try_10.name", descKey: "achievement.try_10.desc", unlocked: false },
  { icon: "🔥", nameKey: "achievement.watch_10h.name", descKey: "achievement.watch_10h.desc", unlocked: false },
  { icon: "⭐", nameKey: "achievement.fav_5.name", descKey: "achievement.fav_5.desc", unlocked: false },
  { icon: "🏆", nameKey: "achievement.streak_7.name", descKey: "achievement.streak_7.desc", unlocked: false },
  { icon: "💎", nameKey: "achievement.witness_10.name", descKey: "achievement.witness_10.desc", unlocked: false },
];

export default function ProfilePage() {
  const { t } = useI18n();
  const router = useRouter();
  const [activeTab, setActiveTab] = useState<Tab>("streams");
  const [profile, setProfile] = useState<Profile | null>(null);
  const [streams, setStreams] = useState<StreamEntry[]>([]);
  const [follows, setFollows] = useState<FollowEntry[]>([]);
  const [followers, setFollowers] = useState<FollowEntry[]>([]);
  const [favorites, setFavorites] = useState<FavoriteEntry[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const supabase = createClient();
    if (!supabase) {
      router.replace("/login");
      return;
    }

    supabase.auth.getUser().then(async ({ data: { user } }) => {
      if (!user) {
        router.replace("/login");
        return;
      }

      // Fetch profile
      const { data: profileData } = await supabase
        .from("profiles")
        .select("*")
        .eq("id", user.id)
        .single();
      if (profileData) setProfile(profileData);

      // Fetch streams history
      fetch("/api/streams?history=true").then(r => r.json()).then(d => setStreams(d.streams || [])).catch(() => {});

      // Fetch follows + followers
      fetch("/api/follows").then(r => r.json()).then(d => setFollows(d.follows || [])).catch(() => {});
      fetch("/api/follows?type=followers").then(r => r.json()).then(d => setFollowers(d.followers || [])).catch(() => {});

      // Fetch favorites
      fetch("/api/favorites").then(r => r.json()).then(d => setFavorites(d.favorites || [])).catch(() => {});

      setLoading(false);
    });
  }, [router]);

  if (loading) {
    return (
      <div className="ambient-gradient min-h-screen flex items-center justify-center">
        <span className="font-[family-name:var(--font-pixel)] text-[11px] text-accent-cyan animate-pulse">
          加载中...
        </span>
      </div>
    );
  }

  const displayName = profile?.display_name || t('profile.unknownUser');
  const avatarUrl = profile?.avatar_url;
  const joinDate = profile?.created_at ? new Date(profile.created_at).toLocaleDateString("zh-CN") : "";

  // 累计直播时长 — 历史 (stream_history) 所有已结束会话之和。
  // 不包含当前 LIVE 中的会话 (那条在 live_streams, 不在 history endpoint)。
  // 直接复用 Postgres 的 generated column duration_seconds, 避免前端重算 —
  // 单一数据源, 永远跟 row 一致。
  const totalStreamSeconds = streams.reduce(
    (acc, s) => acc + (s.duration_seconds ?? 0),
    0
  );

  const formatTotalTime = (sec: number) => {
    if (sec < 60) return t('time.minutes', { m: 0 });
    const h = Math.floor(sec / 3600);
    const m = Math.floor((sec % 3600) / 60);
    return h > 0 ? t('time.hoursMinutes', { h, m }) : t('time.minutes', { m });
  };

  return (
    <div className="ambient-gradient min-h-screen">
      <div className="mx-auto max-w-5xl px-4 py-6">
        {/* ── Profile Card ──────────────────── */}
        <div className="pixel-border-glow bg-bg-card p-5 mb-6 relative overflow-hidden">
          <div className="scanline-overlay absolute inset-0 opacity-30" />
          <div className="relative z-10">
            <div className="flex items-start gap-5">
              {/* Avatar */}
              <div className="relative">
                <div className="w-20 h-20 bg-bg-surface border-2 border-accent-purple overflow-hidden shadow-[0_0_20px_var(--glow-purple)]">
                  {avatarUrl ? (
                    <img src={avatarUrl} alt={displayName} className="w-full h-full object-cover" />
                  ) : (
                    <span className="flex items-center justify-center w-full h-full font-[family-name:var(--font-pixel)] text-2xl text-accent-purple">
                      {displayName.charAt(0).toUpperCase()}
                    </span>
                  )}
                </div>
              </div>

              {/* Info */}
              <div className="flex-1">
                <h1 className="font-[family-name:var(--font-pixel)] text-sm text-text-primary">
                  {displayName}
                </h1>
                <p className="text-sm text-text-secondary mt-1">
                  @{profile?.username || "user"}
                </p>
                {profile?.bio && (
                  <p className="text-xs text-text-secondary/80 mt-2">{profile.bio}</p>
                )}
                {joinDate && (
                  <p className="font-[family-name:var(--font-pixel)] text-[7px] text-text-secondary/50 mt-2">
                    加入于 {joinDate}
                  </p>
                )}
              </div>

              {/* Stats */}
              <div className="grid grid-cols-2 gap-3 shrink-0">
                {([
                  { label: t('profile.tab.streams'), value: streams.length, color: "text-accent-green", span: false },
                  { label: t('profile.following'), value: follows.length, color: "text-accent-pink", span: false },
                  { label: t('profile.followers'), value: followers.length, color: "text-accent-cyan", span: false },
                  { label: t('profile.tab.favorites'), value: favorites.length, color: "text-accent-yellow", span: false },
                  // 第 5 个 stat: 累计直播时长 — 跨 2 列, 视觉上独立成行突出
                  { label: t('profile.totalStreamTime'), value: formatTotalTime(totalStreamSeconds), color: "text-accent-purple", span: true },
                ] as { label: string; value: number | string; color: string; span: boolean }[]).map((stat) => (
                  <div
                    key={stat.label}
                    className={`pixel-border bg-bg-primary/50 p-2 text-center min-w-[80px] ${
                      stat.span ? "col-span-2" : ""
                    }`}
                  >
                    <p className={`font-[family-name:var(--font-pixel)] text-sm ${stat.color}`}>
                      {stat.value}
                    </p>
                    <p className="font-[family-name:var(--font-pixel)] text-[6px] text-text-secondary mt-1">
                      {stat.label}
                    </p>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>

        {/* ── Tab Navigation ──────────────────── */}
        <div className="flex items-center gap-1 mb-5">
          {[
            { key: "streams" as Tab, label: t('profile.tab.streams'), icon: "▶", count: streams.length },
            { key: "following" as Tab, label: t('profile.tab.following'), icon: "♥", count: follows.length },
            { key: "followers" as Tab, label: t('profile.tab.followers'), icon: "◉", count: followers.length },
            { key: "favorites" as Tab, label: t('profile.tab.favorites'), icon: "★", count: favorites.length },
            { key: "achievements" as Tab, label: t('profile.tab.achievements'), icon: "◆", count: ACHIEVEMENTS_DATA.filter(a => a.unlocked).length },
          ].map((tab) => (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              className={`px-4 py-2 text-xs transition-all border-b-2 ${
                activeTab === tab.key
                  ? "text-accent-cyan border-accent-cyan"
                  : "text-text-secondary border-transparent hover:text-text-primary hover:border-border-pixel"
              }`}
            >
              <span className="font-[family-name:var(--font-pixel)] text-[8px] mr-1.5 opacity-50">{tab.icon}</span>
              {tab.label}
              <span className="ml-2 font-[family-name:var(--font-pixel)] text-[7px] text-text-secondary">{tab.count}</span>
            </button>
          ))}
        </div>

        {/* ── Streams ──────────────────────── */}
        {activeTab === "streams" && (
          <div className="space-y-2">
            {streams.length === 0 ? (
              <EmptyState text={t('profile.emptyStreams')} />
            ) : (
              streams.map((s) => <StreamCard key={s.id} stream={s} />)
            )}
          </div>
        )}

        {/* ── Following ─────────────────────── */}
        {activeTab === "following" && (
          <div className="space-y-2">
            {follows.length === 0 ? (
              <EmptyState text={t('profile.emptyFollowing')} />
            ) : (
              follows.map((f) => (
                <div key={f.id} className="pixel-border bg-bg-card p-3 flex items-center gap-3">
                  <div className="w-10 h-10 bg-bg-surface border border-border-pixel shrink-0 overflow-hidden">
                    {f.profiles?.avatar_url ? (
                      <img src={f.profiles.avatar_url} alt="" className="w-full h-full object-cover" />
                    ) : (
                      <span className="flex items-center justify-center w-full h-full font-[family-name:var(--font-pixel)] text-[10px] text-accent-purple">
                        {(f.profiles?.display_name || "?").charAt(0)}
                      </span>
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <span className="font-semibold text-sm text-text-primary">
                      {f.profiles?.display_name || t('profile.unknownUser')}
                    </span>
                    <p className="text-[11px] text-text-secondary truncate">
                      {f.profiles?.bio || ""}
                    </p>
                  </div>
                  <span className="font-[family-name:var(--font-pixel)] text-[7px] text-text-secondary shrink-0">
                    {f.profiles?.followers_count || 0} {t('profile.followers')}
                  </span>
                </div>
              ))
            )}
          </div>
        )}

        {/* ── Followers ──────────────────────── */}
        {activeTab === "followers" && (
          <div className="space-y-2">
            {followers.length === 0 ? (
              <EmptyState text={t('profile.emptyFollowers')} />
            ) : (
              followers.map((f) => (
                <div key={f.id} className="pixel-border bg-bg-card p-3 flex items-center gap-3">
                  <div className="w-10 h-10 bg-bg-surface border border-border-pixel shrink-0 overflow-hidden">
                    {f.profiles?.avatar_url ? (
                      <img src={f.profiles.avatar_url} alt="" className="w-full h-full object-cover" />
                    ) : (
                      <span className="flex items-center justify-center w-full h-full font-[family-name:var(--font-pixel)] text-[10px] text-accent-purple">
                        {(f.profiles?.display_name || "?").charAt(0)}
                      </span>
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <span className="font-semibold text-sm text-text-primary">
                      {f.profiles?.display_name || t('profile.unknownUser')}
                    </span>
                    <p className="text-[11px] text-text-secondary truncate">
                      {f.profiles?.bio || ""}
                    </p>
                  </div>
                  <span className="font-[family-name:var(--font-pixel)] text-[7px] text-text-secondary shrink-0">
                    {new Date(f.created_at).toLocaleDateString("zh-CN")}
                  </span>
                </div>
              ))
            )}
          </div>
        )}

        {/* ── Favorites ─────────────────────── */}
        {activeTab === "favorites" && (
          <div className="space-y-2">
            {favorites.length === 0 ? (
              <EmptyState text={t('profile.emptyFavorites')} />
            ) : (
              favorites.map((f) => (
                <Link key={f.id} href={`/watch/${f.room_name}`} className="block group">
                  <div className="card-glow pixel-border bg-bg-card p-3 flex items-center gap-3">
                    <div className="w-10 h-10 bg-bg-surface border border-border-pixel shrink-0 flex items-center justify-center">
                      <span className="font-[family-name:var(--font-pixel)] text-[10px] text-accent-cyan">
                        {(f.stream_title || f.room_name).charAt(0).toUpperCase()}
                      </span>
                    </div>
                    <div className="flex-1 min-w-0">
                      <span className="font-[family-name:var(--font-pixel)] text-[10px] text-text-primary group-hover:text-accent-cyan transition-colors">
                        {f.stream_title || f.room_name}
                      </span>
                      <p className="text-[11px] text-text-secondary truncate">
                        by {f.streamer_name} · 房间: {f.room_name}
                      </p>
                    </div>
                    <span className="font-[family-name:var(--font-pixel)] text-[7px] text-text-secondary shrink-0">
                      {new Date(f.created_at).toLocaleDateString("zh-CN")}
                    </span>
                  </div>
                </Link>
              ))
            )}
          </div>
        )}

        {/* ── Achievements ──────────────────── */}
        {activeTab === "achievements" && (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {ACHIEVEMENTS_DATA.map((ach) => (
              <div
                key={ach.nameKey}
                className={`pixel-border p-4 text-center transition-all ${
                  ach.unlocked ? "bg-bg-card" : "bg-bg-primary/50 opacity-40"
                }`}
              >
                <span className="text-3xl block mb-2">{ach.unlocked ? ach.icon : "🔒"}</span>
                <h4 className="font-[family-name:var(--font-pixel)] text-[9px] text-text-primary">{t(ach.nameKey as any)}</h4>
                <p className="text-[11px] text-text-secondary mt-1">{t(ach.descKey as any)}</p>
                {ach.unlocked && (
                  <span className="inline-block mt-2 font-[family-name:var(--font-pixel)] text-[6px] text-accent-green">✓ 已解锁</span>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function StreamCard({ stream: s }: { stream: StreamEntry }) {
  const { t } = useI18n();
  const isLive = s.status === "live";
  const duration = s.ended_at && s.started_at
    ? Math.floor((new Date(s.ended_at).getTime() - new Date(s.started_at).getTime()) / 1000)
    : null;

  const formatDuration = (sec: number) => {
    const h = Math.floor(sec / 3600);
    const m = Math.floor((sec % 3600) / 60);
    return h > 0 ? t('time.hoursMinutes', { h, m }) : t('time.minutes', { m });
  };

  const content = (
    <div className={`pixel-border bg-bg-card p-3 flex items-center gap-3 ${isLive ? "card-glow" : ""}`}>
      <div className="w-20 h-12 bg-bg-surface border border-border-pixel shrink-0 overflow-hidden">
        {s.thumbnail_url ? (
          <img src={s.thumbnail_url} alt="" className="w-full h-full object-cover" />
        ) : (
          <span className="flex items-center justify-center w-full h-full font-[family-name:var(--font-pixel)] text-[10px] text-text-secondary/30">
            📺
          </span>
        )}
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className={`font-[family-name:var(--font-pixel)] text-[10px] ${isLive ? "text-accent-cyan group-hover:text-accent-green" : "text-text-primary"} transition-colors`}>
            {s.project_name || s.title || s.room_name}
          </span>
          {isLive && (
            <span className="font-[family-name:var(--font-pixel)] text-[7px] text-accent-green bg-accent-green/10 border border-accent-green/30 px-1.5 py-0.5">
              LIVE
            </span>
          )}
        </div>
        <p className="text-[11px] text-text-secondary truncate mt-0.5">
          {s.coding_tool !== "other" ? s.coding_tool + " · " : ""}
          {new Date(s.started_at).toLocaleDateString("zh-CN")}
          {duration !== null && ` · ${formatDuration(duration)}`}
        </p>
      </div>
      <span className={`font-[family-name:var(--font-pixel)] text-[7px] shrink-0 ${isLive ? "text-accent-green" : "text-text-secondary/50"}`}>
        {isLive ? t('status.live') : t('status.offline')}
      </span>
    </div>
  );

  if (isLive) {
    return <Link href={`/watch/${s.room_name}`} className="block group">{content}</Link>;
  }
  return <div>{content}</div>;
}

function EmptyState({ text }: { text: string }) {
  const { t } = useI18n();
  return (
    <div className="pixel-border bg-bg-card p-12 text-center">
      <span className="text-3xl block mb-3 opacity-40">📭</span>
      <p className="font-[family-name:var(--font-pixel)] text-[9px] text-text-secondary">{text}</p>
      <Link href="/" className="inline-block mt-3 pixel-btn border-accent-purple text-accent-purple hover:bg-accent-purple hover:text-white text-[8px]">
        {t('btn.goExplore')}
      </Link>
    </div>
  );
}
