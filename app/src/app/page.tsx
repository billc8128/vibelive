"use client";

import { useState, useMemo, useEffect } from "react";
import { StreamCard } from "@/components/StreamCard";
import { LiveStreamCard } from "@/components/LiveStreamCard";
import { FilterBar } from "@/components/FilterBar";
import { LiveTicker } from "@/components/LiveTicker";
import { MOCK_STREAMS } from "@/lib/mock-data";
import { ProductCategory, PlatformType } from "@/lib/types";
import { useI18n } from "@/lib/i18n/context";

interface Filters {
  category: ProductCategory | null;
  platform: PlatformType | null;
  sortBy: "viewers" | "recent";
}

interface RealStream {
  id: string;
  room_name: string;
  user_id: string;
  streamer_name: string;
  title: string;
  coding_tool: string;
  status: string;
  viewers_count: number;
  started_at: string;
  profiles?: {
    display_name: string;
    avatar_url: string | null;
    username: string;
    bio: string;
    followers_count: number;
  };
}

export default function HomePage() {
  const { t } = useI18n();
  const [filters, setFilters] = useState<Filters>({
    category: null,
    platform: null,
    sortBy: "viewers",
  });
  const [realStreams, setRealStreams] = useState<RealStream[]>([]);
  const [followingIds, setFollowingIds] = useState<Set<string>>(new Set());

  // Fetch real live streams + following list
  useEffect(() => {
    const fetchStreams = async () => {
      try {
        const res = await fetch("/api/streams");
        if (res.ok) {
          const { streams } = await res.json();
          setRealStreams(streams);
        }
      } catch {}
    };

    const fetchFollows = async () => {
      try {
        const res = await fetch("/api/follows");
        if (res.ok) {
          const { follows } = await res.json();
          if (follows?.length) {
            setFollowingIds(new Set(follows.map((f: { profiles?: { id: string } }) => f.profiles?.id).filter(Boolean)));
          }
        }
      } catch {}
    };

    fetchStreams();
    fetchFollows();
    const interval = setInterval(fetchStreams, 10000);
    return () => clearInterval(interval);
  }, []);

  const followingLive = realStreams.filter((s) => followingIds.has(s.user_id));

  const filteredStreams = useMemo(() => {
    let streams = [...MOCK_STREAMS];

    if (filters.category) {
      streams = streams.filter((s) => s.project.category === filters.category);
    }
    if (filters.platform) {
      streams = streams.filter((s) =>
        s.project.platforms.includes(filters.platform!)
      );
    }

    streams.sort((a, b) => {
      if (filters.sortBy === "viewers") return b.viewers - a.viewers;
      return new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime();
    });

    const live = streams.filter((s) => s.status === "live");
    const away = streams.filter((s) => s.status === "away");
    const offline = streams.filter((s) => s.status === "offline");
    return [...live, ...away, ...offline];
  }, [filters]);

  // Filter real streams by coding tool (when category filter maps to a tool)
  const filteredRealStreams = useMemo(() => {
    // No filters active → show all real streams
    if (!filters.category && !filters.platform) return realStreams;
    // Real streams don't have category/platform, but we can filter by coding_tool
    return realStreams;
  }, [realStreams, filters]);

  const liveStreams = filteredStreams.filter((s) => s.status === "live");
  const featuredStream = liveStreams[0];
  const sideStreams = liveStreams.slice(1, 3);
  const restStreams = filteredStreams.filter((s) => s !== featuredStream && !sideStreams.includes(s));

  return (
    <div className="ambient-gradient min-h-screen">
      {/* Live Ticker */}
      <LiveTicker />

      <div className="mx-auto max-w-[1400px] px-4 py-5">
        {/* ── Stats Dashboard Strip ─────────── */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-6">
          {[
            { label: t('stat.liveNow'), value: (realStreams.length + liveStreams.length).toString(), icon: "◉", color: "text-accent-pink", glow: "glow-pink" },
            { label: t('stat.viewers'), value: MOCK_STREAMS.reduce((s, st) => s + st.viewers, 0).toString(), icon: "◈", color: "text-accent-cyan", glow: "glow-cyan" },
            { label: t('stat.totalProjects'), value: (MOCK_STREAMS.length + realStreams.length).toString(), icon: "◇", color: "text-accent-green", glow: "glow-green" },
          ].map((stat) => (
            <div key={stat.label} className="pixel-border bg-bg-card/80 p-3 text-center">
              <span className={`font-[family-name:var(--font-pixel)] text-[8px] ${stat.color} opacity-60`}>
                {stat.icon} {stat.label}
              </span>
              <p className={`font-[family-name:var(--font-pixel)] text-lg mt-1 ${stat.color} ${stat.glow}`}>
                {stat.value}
              </p>
            </div>
          ))}
        </div>

        {/* ── Following Live ────────────────── */}
        {followingLive.length > 0 && (
          <>
            <div className="flex items-center gap-3 mb-4">
              <span className="font-[family-name:var(--font-pixel)] text-[10px] text-accent-pink glow-pink">
                ♥ {t('home.followingLive')}
              </span>
              <span className="live-dot inline-block w-2 h-2 rounded-full bg-accent-pink" />
              <div className="flex-1 h-px bg-gradient-to-r from-accent-pink/40 to-transparent" />
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4 mb-8">
              {followingLive.map((stream) => (
                <LiveStreamCard key={`fol-${stream.id}`} stream={stream} />
              ))}
            </div>
          </>
        )}

        {/* ── Real Live Streams ─────────────── */}
        {filteredRealStreams.length > 0 && (
          <>
            <div className="flex items-center gap-3 mb-4">
              <span className="font-[family-name:var(--font-pixel)] text-[10px] text-accent-green glow-green">
                ◉ {t('stat.liveNow')}
              </span>
              <span className="live-dot inline-block w-2 h-2 rounded-full bg-accent-green" />
              <div className="flex-1 h-px bg-gradient-to-r from-accent-green/40 to-transparent" />
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4 mb-8">
              {filteredRealStreams.map((stream) => (
                <LiveStreamCard key={stream.id} stream={stream} />
              ))}
            </div>
          </>
        )}

        {/* ── Bento Layout: Featured + Side ──── */}
        {featuredStream && (
          <div className="bento-grid mb-6">
            <div className="bento-featured">
              <StreamCard stream={featuredStream} variant="featured" />
            </div>
            {sideStreams.map((stream) => (
              <div key={stream.id} className="bento-side">
                <StreamCard stream={stream} />
              </div>
            ))}
          </div>
        )}

        {/* ── Section Divider ────────────────── */}
        <div className="flex items-center gap-3 mb-4 mt-2">
          <span className="font-[family-name:var(--font-pixel)] text-[10px] text-accent-purple glow-purple">
            ◈ {t('home.discover')}
          </span>
          <div className="flex-1 h-px bg-gradient-to-r from-accent-purple/40 to-transparent" />
        </div>

        {/* ── Filters ────────────────────────── */}
        <div className="hud-panel p-3 mb-5">
          <FilterBar onFilterChange={setFilters} />
        </div>

        {/* ── Rest of streams ────────────────── */}
        {restStreams.length > 0 ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
            {restStreams.map((stream) => (
              <StreamCard key={stream.id} stream={stream} />
            ))}
          </div>
        ) : (
          <div className="pixel-border bg-bg-card p-16 text-center">
            <span className="font-[family-name:var(--font-pixel)] text-4xl block mb-4 opacity-40">
              ⌀
            </span>
            <p className="font-[family-name:var(--font-pixel)] text-[10px] text-text-secondary">
              {t('home.noMatch')}
            </p>
          </div>
        )}

        {/* ── Quick Access: Compact List ──────── */}
        {restStreams.length > 0 && (
          <>
            <div className="flex items-center gap-3 mb-4 mt-8">
              <span className="font-[family-name:var(--font-pixel)] text-[10px] text-accent-cyan glow-cyan">
                ◇ {t('home.quickBrowse')}
              </span>
              <div className="flex-1 h-px bg-gradient-to-r from-accent-cyan/40 to-transparent" />
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
              {MOCK_STREAMS.map((stream) => (
                <StreamCard key={`compact-${stream.id}`} stream={stream} variant="compact" />
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
