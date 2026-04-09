"use client";

import { useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { Stream, CATEGORY_LABELS, PLATFORM_LABELS } from "@/lib/types";
import { ToolBadge } from "@/components/ToolBadge";
import { ProgressBar } from "@/components/ProgressBar";
import { ChatPanel } from "@/components/ChatPanel";
import { useI18n } from "@/lib/i18n/context";

interface StreamDetailClientProps {
  stream: Stream;
}

export function StreamDetailClient({ stream }: StreamDetailClientProps) {
  const { t } = useI18n();
  const { streamer, project, status, codingTool, viewers, stages } =
    stream;
  const isLive = status === "live";
  const isAway = status === "away";
  const [isFollowing, setIsFollowing] = useState(false);
  const [isFavorited, setIsFavorited] = useState(false);
  const [chatOpen, setChatOpen] = useState(true);

  const formatDevTime = (minutes: number) => {
    const h = Math.floor(minutes / 60);
    const m = minutes % 60;
    if (h === 0) return `${m}m`;
    return m > 0 ? `${h}h ${m}m` : `${h}h`;
  };

  return (
    <div className="ambient-gradient min-h-screen">
      <div className="mx-auto max-w-[1400px] px-4 py-3">
        {/* ── Top Bar ─────────────────────────── */}
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-3">
            <Link
              href="/"
              className="font-[family-name:var(--font-pixel)] text-[8px] text-text-secondary hover:text-accent-cyan transition-colors"
            >
              ◁ {t('nav.backToHome')}
            </Link>
            <span className="text-border-pixel">│</span>
            <h1 className="font-[family-name:var(--font-pixel)] text-[12px] text-text-primary glitch-hover">
              {project.name}
            </h1>
            <ToolBadge tool={codingTool} />
          </div>

          <div className="flex items-center gap-2">
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
            <button
              onClick={() => setIsFavorited(!isFavorited)}
              className={`pixel-btn text-[8px] ${
                isFavorited
                  ? "border-accent-yellow text-bg-primary bg-accent-yellow"
                  : "border-accent-yellow text-accent-yellow"
              }`}
            >
              {isFavorited ? t('btn.favorited') : t('btn.favorite')}
            </button>
          </div>
        </div>

        {/* ── Main Layout ─────────────────────── */}
        <div className="flex gap-4">
          {/* Video + Info Area */}
          <div className={`flex-1 min-w-0 space-y-4 ${chatOpen ? "" : ""}`}>
            {/* ── Immersive Video ──────────────── */}
            <div className="relative pixel-border-live aspect-video bg-bg-primary overflow-hidden">
              <div className="scanline-overlay absolute inset-0" />
              <div className="absolute inset-0 ambient-gradient" />

              {/* Video content area */}
              {isLive && (
                <div className="absolute inset-0 flex flex-col items-center justify-center z-10">
                  <span className="font-[family-name:var(--font-pixel)] text-7xl text-accent-purple/15">
                    {project.name.slice(0, 3).toUpperCase()}
                  </span>
                  <span className="font-[family-name:var(--font-pixel)] text-[9px] text-text-secondary/60 mt-3">
                    屏幕共享直播中...
                  </span>
                </div>
              )}

              {isAway && (
                <div className="absolute inset-0 flex flex-col items-center justify-center z-10">
                  <span className="text-6xl mb-3">☕</span>
                  <span className="font-[family-name:var(--font-pixel)] text-[12px] text-accent-yellow glow-purple">
                    {t('stream.awayTitle')}
                  </span>
                  <span className="text-sm text-text-secondary mt-2">
                    {t('stream.awayDesc')}
                  </span>
                </div>
              )}

              {status === "offline" && (
                <div className="absolute inset-0 flex flex-col items-center justify-center z-10">
                  <span className="text-6xl mb-3">🏁</span>
                  <span className="font-[family-name:var(--font-pixel)] text-[12px] text-accent-green glow-green">
                    {t('stream.completedTitle')}
                  </span>
                  {project.productUrl && (
                    <a
                      href={project.productUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="mt-4 pixel-btn border-accent-cyan text-accent-cyan hover:bg-accent-cyan hover:text-bg-primary"
                    >
                      🚀 {t('stream.tryProduct')}
                    </a>
                  )}
                </div>
              )}

              {/* ── HUD Overlays ──────────────── */}

              {/* Top-left: Status */}
              <div className="absolute top-3 left-3 z-20 flex items-center gap-2">
                {isLive && (
                  <span className="viewer-badge text-[9px]">
                    <span className="live-dot inline-block w-2 h-2 rounded-full bg-white" />
                    LIVE
                  </span>
                )}
                <span className="hud-panel px-2 py-1 font-[family-name:var(--font-pixel)] text-[8px] text-text-secondary">
                  👁 {viewers}
                </span>
              </div>

              {/* Top-right: Dev time */}
              <div className="absolute top-3 right-3 z-20">
                <span className="hud-panel px-2 py-1 font-[family-name:var(--font-pixel)] text-[8px] text-accent-yellow">
                  ⏱ {formatDevTime(stream.totalDevTime)}
                </span>
              </div>

              {/* Bottom: Progress bar overlay */}
              <div className="absolute bottom-0 left-0 right-0 z-20">
                <div className="bg-gradient-to-t from-bg-primary/90 to-transparent p-3 pt-8">
                  <ProgressBar stages={stages} compact />
                </div>
              </div>
            </div>

            {/* ── Project Info + Streamer ──────── */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {/* Project Info */}
              <div className="pixel-border bg-bg-card p-4 space-y-3">
                <div className="flex items-center gap-2 mb-2">
                  <span className="font-[family-name:var(--font-pixel)] text-[8px] text-accent-purple">◈</span>
                  <span className="font-[family-name:var(--font-pixel)] text-[9px] text-text-secondary">
                    {t('stream.projectInfo')}
                  </span>
                </div>

                <p className="text-sm text-text-primary leading-relaxed">
                  {project.description}
                </p>

                <div className="flex flex-wrap gap-1.5">
                  <span className="pixel-tag">{t(`category.${project.category}`)}</span>
                  {project.platforms.map((p) => (
                    <span key={p} className="pixel-tag">{PLATFORM_LABELS[p]}</span>
                  ))}
                  {project.tags.map((tag) => (
                    <span key={tag} className="pixel-tag text-accent-cyan border-accent-cyan/30">
                      #{tag}
                    </span>
                  ))}
                </div>

                {project.productUrl && (
                  <a
                    href={project.productUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="block text-xs text-accent-green hover:underline mt-2"
                  >
                    🔗 {project.productUrl}
                  </a>
                )}
              </div>

              {/* Streamer Card */}
              <div className="pixel-border bg-bg-card p-4">
                <div className="flex items-center gap-2 mb-3">
                  <span className="font-[family-name:var(--font-pixel)] text-[8px] text-accent-pink">◈</span>
                  <span className="font-[family-name:var(--font-pixel)] text-[9px] text-text-secondary">
                    {t('stream.streamer')}
                  </span>
                </div>

                <div className="flex items-center gap-3">
                  <div className="w-14 h-14 bg-bg-surface border-2 border-border-pixel shrink-0 overflow-hidden">
                    {streamer.avatarUrl ? (
                      <Image src={streamer.avatarUrl} alt={streamer.displayName} width={56} height={56} className="object-cover" />
                    ) : (
                      <span className="flex items-center justify-center w-full h-full font-[family-name:var(--font-pixel)] text-lg text-accent-purple">
                        {streamer.displayName.charAt(0)}
                      </span>
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <h3 className="font-semibold text-text-primary">
                      {streamer.displayName}
                    </h3>
                    <p className="text-xs text-text-secondary mt-0.5">
                      {streamer.bio}
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-3 mt-3 pt-3 border-t border-border-pixel/50">
                  <span className="font-[family-name:var(--font-pixel)] text-[8px] text-text-secondary">
                    {streamer.followers} 关注者
                  </span>
                  <div className="flex-1" />
                  <button
                    onClick={() => setIsFollowing(!isFollowing)}
                    className={`pixel-btn text-[8px] ${
                      isFollowing
                        ? "border-text-secondary text-text-secondary bg-bg-surface"
                        : "border-accent-pink text-accent-pink hover:bg-accent-pink hover:text-white"
                    }`}
                    title="演示数据"
                  >
                    {isFollowing ? t('btn.following') : t('btn.follow')}
                  </button>
                </div>
              </div>
            </div>

            {/* ── Progress Detail ──────────────── */}
            <div className="pixel-border bg-bg-card p-4">
              <div className="flex items-center gap-2 mb-3">
                <span className="font-[family-name:var(--font-pixel)] text-[8px] text-accent-green">◈</span>
                <span className="font-[family-name:var(--font-pixel)] text-[9px] text-text-secondary">
                  {t('stream.progress')}
                </span>
                <div className="flex-1" />
                <span className="font-[family-name:var(--font-pixel)] text-[8px] text-accent-yellow">
                  ⏱ 累计 {formatDevTime(stream.totalDevTime)}
                </span>
              </div>
              <ProgressBar stages={stages} />
            </div>
          </div>

          {/* ── Chat Panel (slide in/out) ──────── */}
          {chatOpen && (
            <div className="w-[340px] shrink-0 hidden lg:block">
              <div className="sticky top-14 h-[calc(100vh-72px)]">
                <ChatPanel />
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
