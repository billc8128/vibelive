"use client";

import Link from "next/link";
import Image from "next/image";
import { Stream } from "@/lib/types";
import { ToolBadge } from "./ToolBadge";
import { ProgressBar } from "./ProgressBar";
import { useI18n } from "@/lib/i18n/context";

interface StreamCardProps {
  stream: Stream;
  variant?: "featured" | "default" | "compact";
}

export function StreamCard({ stream, variant = "default" }: StreamCardProps) {
  const { t } = useI18n();
  const { streamer, project, status, codingTool, viewers, stages } =
    stream;
  const isLive = status === "live";
  const isAway = status === "away";

  if (variant === "featured") {
    return <FeaturedCard stream={stream} />;
  }

  if (variant === "compact") {
    return <CompactCard stream={stream} />;
  }

  return (
    <Link href={`/stream/${stream.id}`} className="block group">
      <div
        className={`card-glow overflow-hidden bg-bg-card relative ${
          isLive ? "pixel-border-live" : "pixel-border"
        }`}
      >
        {/* Thumbnail */}
        <div className="relative aspect-video bg-bg-primary overflow-hidden">
          {project.thumbnailUrl ? (
            <Image
              src={project.thumbnailUrl}
              alt={project.name}
              fill
              className="object-cover"
              sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 25vw"
            />
          ) : (
            <div className="absolute inset-0 flex items-center justify-center">
              <span className="font-[family-name:var(--font-pixel)] text-3xl text-border-pixel/40 block">
                {project.name.slice(0, 2).toUpperCase()}
              </span>
            </div>
          )}
          <div className="scanline-overlay absolute inset-0" />

          {/* Status */}
          <div className="absolute top-2 left-2 z-10">
            {isLive && (
              <span className="viewer-badge">
                <span className="live-dot inline-block w-1.5 h-1.5 rounded-full bg-white" />
                {viewers}
              </span>
            )}
            {isAway && (
              <span className="viewer-badge bg-amber-600/80 backdrop-blur-sm">
                {t('status.away')}
              </span>
            )}
            {status === "offline" && (
              <span className="viewer-badge bg-gray-600/80 backdrop-blur-sm">
                {t('status.offline')}
              </span>
            )}
          </div>

          <div className="absolute top-2 right-2 z-10">
            <ToolBadge tool={codingTool} />
          </div>

          {/* Progress at bottom */}
          <div className="absolute bottom-0 left-0 right-0 z-10 px-2 pb-1.5">
            <ProgressBar stages={stages} compact />
          </div>
        </div>

        {/* Info */}
        <div className="p-3 space-y-2">
          <div className="flex items-start gap-2">
            <div className="min-w-0 flex-1">
              <h3 className="font-[family-name:var(--font-pixel)] text-[10px] text-text-primary truncate group-hover:text-accent-cyan transition-colors">
                {project.name}
              </h3>
              <p className="text-[11px] text-text-secondary mt-1">
                {streamer.displayName}
              </p>
            </div>
            <div className="w-7 h-7 shrink-0 bg-bg-surface border border-border-pixel overflow-hidden">
              {streamer.avatarUrl ? (
                <Image src={streamer.avatarUrl} alt={streamer.displayName} width={28} height={28} className="object-cover" />
              ) : (
                <span className="flex items-center justify-center w-full h-full font-[family-name:var(--font-pixel)] text-[7px] text-accent-purple">
                  {streamer.displayName.charAt(0)}
                </span>
              )}
            </div>
          </div>

          <p className="text-[11px] text-text-secondary line-clamp-2 leading-relaxed">
            {project.description}
          </p>

          <div className="flex flex-wrap gap-1">
            <span className="pixel-tag">{t(`category.${project.category}` as any)}</span>
            {project.platforms.map((p) => (
              <span key={p} className="pixel-tag">{t(`platform.${p}` as any)}</span>
            ))}
          </div>
        </div>
      </div>
    </Link>
  );
}

function FeaturedCard({ stream }: { stream: Stream }) {
  const { t } = useI18n();
  const { streamer, project, codingTool, viewers, stages } = stream;

  return (
    <Link href={`/stream/${stream.id}`} className="block group h-full">
      <div className="card-glow pixel-border-live overflow-hidden bg-bg-card relative h-full flex flex-col">
        {/* Large Thumbnail */}
        <div className="relative flex-1 min-h-[200px] bg-bg-primary overflow-hidden">
          {project.thumbnailUrl ? (
            <Image
              src={project.thumbnailUrl}
              alt={project.name}
              fill
              className="object-cover opacity-80"
              sizes="(max-width: 768px) 100vw, 60vw"
              priority
            />
          ) : (
            <div className="absolute inset-0 flex items-center justify-center ambient-gradient">
              <div className="text-center">
                <span className="font-[family-name:var(--font-pixel)] text-6xl text-accent-purple/20 block">
                  {project.name.slice(0, 3).toUpperCase()}
                </span>
                <span className="font-[family-name:var(--font-pixel)] text-[8px] text-text-secondary/40 mt-2 block">
                  LIVE CODING
                </span>
              </div>
            </div>
          )}
          <div className="scanline-overlay absolute inset-0" />

          {/* Overlay Info */}
          <div className="absolute inset-0 z-10 flex flex-col justify-between p-4">
            {/* Top */}
            <div className="flex items-start justify-between">
              <div className="flex items-center gap-2">
                <span className="viewer-badge text-[10px]">
                  <span className="live-dot inline-block w-2 h-2 rounded-full bg-white" />
                  LIVE · {viewers}
                </span>
                <ToolBadge tool={codingTool} />
              </div>
              <span className="font-[family-name:var(--font-pixel)] text-[7px] text-text-secondary bg-bg-primary/60 backdrop-blur-sm px-2 py-1 border border-border-pixel/50">
                {t('home.hot')}
              </span>
            </div>

            {/* Bottom */}
            <div>
              <div className="hud-panel p-3 space-y-2">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 bg-bg-surface border border-border-pixel shrink-0 overflow-hidden">
                    {streamer.avatarUrl ? (
                      <Image src={streamer.avatarUrl} alt={streamer.displayName} width={40} height={40} className="object-cover" />
                    ) : (
                      <span className="flex items-center justify-center w-full h-full font-[family-name:var(--font-pixel)] text-xs text-accent-purple">
                        {streamer.displayName.charAt(0)}
                      </span>
                    )}
                  </div>
                  <div className="min-w-0">
                    <h2 className="font-[family-name:var(--font-pixel)] text-[12px] text-text-primary group-hover:text-accent-cyan transition-colors truncate">
                      {project.name}
                    </h2>
                    <p className="text-xs text-text-secondary">
                      {streamer.displayName} · {project.description.slice(0, 40)}...
                    </p>
                  </div>
                </div>
                <ProgressBar stages={stages} compact />
              </div>
            </div>
          </div>
        </div>

      </div>
    </Link>
  );
}

function CompactCard({ stream }: { stream: Stream }) {
  const { streamer, project, status, codingTool, viewers } = stream;
  const isLive = status === "live";

  return (
    <Link href={`/stream/${stream.id}`} className="block group">
      <div className="card-glow pixel-border bg-bg-card p-3 flex items-center gap-3 hover:bg-bg-surface transition-colors">
        {/* Mini thumbnail */}
        <div className="w-14 h-14 shrink-0 bg-bg-primary border border-border-pixel relative overflow-hidden">
          {project.thumbnailUrl ? (
            <Image src={project.thumbnailUrl} alt={project.name} fill className="object-cover" sizes="56px" />
          ) : (
            <span className="flex items-center justify-center w-full h-full font-[family-name:var(--font-pixel)] text-sm text-border-pixel/50">
              {project.name.charAt(0)}
            </span>
          )}
          {isLive && (
            <span className="absolute top-0 right-0 w-2 h-2 bg-accent-pink rounded-full live-dot" />
          )}
        </div>

        {/* Info */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <h4 className="font-[family-name:var(--font-pixel)] text-[9px] text-text-primary truncate group-hover:text-accent-cyan transition-colors">
              {project.name}
            </h4>
            <ToolBadge tool={codingTool} />
          </div>
          <p className="text-[11px] text-text-secondary mt-0.5 truncate">
            {streamer.displayName}
          </p>
        </div>

        {/* Stats */}
        <div className="shrink-0 text-right">
          {isLive && (
            <span className="font-[family-name:var(--font-pixel)] text-[8px] text-accent-pink flex items-center gap-1">
              <span className="live-dot w-1.5 h-1.5 rounded-full bg-accent-pink inline-block" />
              {viewers}
            </span>
          )}
        </div>
      </div>
    </Link>
  );
}
