"use client";

import { useState, useEffect, useCallback, useRef, memo } from "react";
import Link from "next/link";
import Image from "next/image";
import { MOCK_STREAMS } from "@/lib/mock-data";
import { Stream } from "@/lib/types";
import { ToolBadge } from "@/components/ToolBadge";
import { useI18n } from "@/lib/i18n/context";

// ─── Star Field (Canvas) ─────────────────────────
function StarField() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let animId: number;
    const stars: { x: number; y: number; z: number; speed: number }[] = [];
    const COUNT = 400;

    const resize = () => {
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;
    };
    resize();
    window.addEventListener("resize", resize);

    for (let i = 0; i < COUNT; i++) {
      stars.push({
        x: (Math.random() - 0.5) * canvas.width * 2,
        y: (Math.random() - 0.5) * canvas.height * 2,
        z: Math.random() * 1500 + 100,
        speed: Math.random() * 2 + 0.5,
      });
    }

    const draw = () => {
      ctx.fillStyle = "rgba(5, 5, 16, 0.15)";
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      const cx = canvas.width / 2;
      const cy = canvas.height / 2;

      for (const star of stars) {
        star.z -= star.speed;
        if (star.z <= 1) {
          star.z = 1500;
          star.x = (Math.random() - 0.5) * canvas.width * 2;
          star.y = (Math.random() - 0.5) * canvas.height * 2;
        }

        const sx = (star.x / star.z) * 400 + cx;
        const sy = (star.y / star.z) * 400 + cy;
        const r = Math.max(0.3, (1 - star.z / 1500) * 2.5);
        const alpha = Math.max(0.1, 1 - star.z / 1500);

        if (sx < 0 || sx > canvas.width || sy < 0 || sy > canvas.height)
          continue;

        ctx.beginPath();
        ctx.arc(sx, sy, r, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(180, 160, 255, ${alpha})`;
        ctx.fill();

        if (star.speed > 1.5) {
          ctx.beginPath();
          ctx.moveTo(sx, sy);
          ctx.lineTo(sx + (star.x / star.z) * 2, sy + (star.y / star.z) * 2);
          ctx.strokeStyle = `rgba(180, 160, 255, ${alpha * 0.3})`;
          ctx.lineWidth = 0.5;
          ctx.stroke();
        }
      }
      animId = requestAnimationFrame(draw);
    };
    draw();

    return () => {
      cancelAnimationFrame(animId);
      window.removeEventListener("resize", resize);
    };
  }, []);

  return <canvas ref={canvasRef} className="fixed inset-0 z-0" />;
}

// ─── Memoized Card Content ──────────────────────
const CardContent = memo(function CardContent({
  stream,
  onSelect,
}: {
  stream: Stream;
  onSelect: (stream: Stream) => void;
}) {
  const { t } = useI18n();
  const { streamer, project, status, codingTool, viewers, stages } =
    stream;
  const isLive = status === "live";

  return (
    <div
      className={`holo-card-3d w-64 cursor-pointer group ${
        isLive ? "holo-card-3d-live" : ""
      }`}
      onClick={() => onSelect(stream)}
      data-hoverable="true"
    >
      <div className="holo-scanline" />

      <div className="relative h-36 bg-[#08081a] overflow-hidden">
        {project.thumbnailUrl ? (
          <Image
            src={project.thumbnailUrl}
            alt={project.name}
            fill
            className="object-cover opacity-50 group-hover:opacity-70 transition-opacity duration-500"
            sizes="256px"
          />
        ) : (
          <div className="absolute inset-0 flex items-center justify-center">
            <span className="font-[family-name:var(--font-pixel)] text-3xl text-accent-purple/15">
              {project.name.slice(0, 2).toUpperCase()}
            </span>
          </div>
        )}

        <div className="absolute inset-0 holo-noise opacity-0 group-hover:opacity-100 transition-opacity" />
        <div className="scanline-overlay absolute inset-0 opacity-20" />

        <div className="absolute top-2 left-2 z-10 flex items-center gap-1.5">
          {isLive && (
            <span className="inline-flex items-center gap-1 bg-red-500/80 backdrop-blur-sm px-2 py-0.5 font-[family-name:var(--font-pixel)] text-[7px] text-white">
              <span className="live-dot w-1.5 h-1.5 rounded-full bg-white inline-block" />
              LIVE · {viewers}
            </span>
          )}
          {status === "away" && (
            <span className="inline-flex items-center gap-1 bg-amber-600/80 backdrop-blur-sm px-2 py-0.5 font-[family-name:var(--font-pixel)] text-[7px] text-white">
              {t('status.away')}
            </span>
          )}
          {status === "offline" && (
            <span className="inline-flex items-center gap-1 bg-gray-600/80 backdrop-blur-sm px-2 py-0.5 font-[family-name:var(--font-pixel)] text-[7px] text-white">
              {t('status.offline')}
            </span>
          )}
        </div>

        <div className="absolute top-2 right-2 z-10">
          <ToolBadge tool={codingTool} />
        </div>

        <div className="absolute bottom-0 left-0 right-0 flex z-10">
          {stages.map((stage, i) => (
            <div
              key={i}
              className={`flex-1 h-1 ${
                stage.completed ? "bg-accent-green/80" : "bg-white/5"
              } ${i > 0 ? "ml-px" : ""}`}
            />
          ))}
        </div>
      </div>

      <div className="p-3 relative">
        <div className="flex items-start gap-2">
          <div className="w-7 h-7 shrink-0 bg-bg-surface border border-border-pixel/50 overflow-hidden">
            {streamer.avatarUrl ? (
              <Image
                src={streamer.avatarUrl}
                alt={streamer.displayName}
                width={28}
                height={28}
                className="object-cover"
              />
            ) : (
              <span className="flex items-center justify-center w-full h-full font-[family-name:var(--font-pixel)] text-[7px] text-accent-purple">
                {streamer.displayName.charAt(0)}
              </span>
            )}
          </div>
          <div className="min-w-0 flex-1">
            <h3 className="font-[family-name:var(--font-pixel)] text-[9px] text-text-primary truncate group-hover:text-accent-cyan transition-colors">
              {project.name}
            </h3>
            <p className="text-[10px] text-text-secondary truncate mt-0.5">
              {streamer.displayName}
            </p>
          </div>
        </div>

        <div className="mt-2">
          <span className="pixel-tag text-[5px]">
            {t(`category.${project.category}`)}
          </span>
        </div>
      </div>
    </div>
  );
});

// ─── Detail Panel (flies in from card) ───────────
function DetailPanel({
  stream,
  onClose,
}: {
  stream: Stream;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const { streamer, project, status, codingTool, viewers, stages } =
    stream;
  const isLive = status === "live";
  const completedStages = stages.filter((s) => s.completed).length;

  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-[150] flex items-center justify-center"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="absolute inset-0 bg-black/70 backdrop-blur-lg" />

      <div className="relative z-10 w-[92vw] max-w-xl detail-fly-in">
        <div className="holo-card-focused relative overflow-hidden">
          <div className="relative h-52 bg-[#08081a] overflow-hidden">
            {project.thumbnailUrl ? (
              <Image
                src={project.thumbnailUrl}
                alt={project.name}
                fill
                className="object-cover opacity-50"
                sizes="90vw"
              />
            ) : (
              <div className="absolute inset-0 ambient-gradient" />
            )}
            <div className="absolute inset-0 bg-gradient-to-t from-[rgba(17,17,50,0.95)] via-transparent to-transparent" />
            <div className="holo-scanline" />
            <div className="scanline-overlay absolute inset-0 opacity-20" />

            <div className="absolute top-3 left-3 flex items-center gap-2 z-10">
              {isLive && (
                <span className="viewer-badge">
                  <span className="live-dot inline-block w-2 h-2 rounded-full bg-white" />
                  LIVE · {viewers}
                </span>
              )}
              {status === "away" && (
                <span className="viewer-badge bg-amber-600/80">{t('status.away')}</span>
              )}
              {status === "offline" && (
                <span className="viewer-badge bg-gray-600/80">{t('status.offline')}</span>
              )}
              <ToolBadge tool={codingTool} />
            </div>

            <button
              onClick={onClose}
              className="absolute top-3 right-3 z-10 w-8 h-8 flex items-center justify-center bg-black/30 backdrop-blur-sm border border-white/10 text-white/50 hover:text-white hover:border-accent-cyan/50 hover:shadow-[0_0_12px_rgba(0,229,255,0.3)] transition-all text-sm"
            >
              ✕
            </button>

            <div className="absolute bottom-4 left-4 right-4 z-10">
              <h2 className="font-[family-name:var(--font-pixel)] text-base text-text-primary glow-cyan">
                {project.name}
              </h2>
              <p className="text-sm text-text-secondary/80 mt-1.5 line-clamp-2">
                {project.description}
              </p>
            </div>
          </div>

          <div className="p-5 space-y-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-bg-surface border border-border-pixel/50 overflow-hidden shrink-0">
                {streamer.avatarUrl ? (
                  <Image
                    src={streamer.avatarUrl}
                    alt={streamer.displayName}
                    width={40}
                    height={40}
                    className="object-cover"
                  />
                ) : (
                  <span className="flex items-center justify-center w-full h-full font-[family-name:var(--font-pixel)] text-xs text-accent-purple">
                    {streamer.displayName.charAt(0)}
                  </span>
                )}
              </div>
              <div className="min-w-0">
                <p className="text-sm font-semibold text-text-primary">
                  {streamer.displayName}
                </p>
                <p className="text-xs text-text-secondary truncate">
                  {streamer.bio}
                </p>
              </div>
            </div>

            <div className="grid grid-cols-1 gap-2">
              {[
                { label: t('stat.viewers_label'), value: viewers, color: "text-accent-pink" },
              ].map((s) => (
                <div
                  key={s.label}
                  className="text-center p-2 bg-[#0a0a20]/60 border border-border-pixel/20"
                >
                  <p
                    className={`font-[family-name:var(--font-pixel)] text-sm ${s.color}`}
                  >
                    {s.value}
                  </p>
                  <p className="font-[family-name:var(--font-pixel)] text-[5px] text-text-secondary mt-1">
                    {s.label}
                  </p>
                </div>
              ))}
            </div>

            <div>
              <div className="flex items-center justify-between mb-2">
                <span className="font-[family-name:var(--font-pixel)] text-[7px] text-text-secondary">
                  {t('explore.progress')}
                </span>
                <span className="font-[family-name:var(--font-pixel)] text-[7px] text-accent-cyan">
                  {completedStages}/{stages.length}
                </span>
              </div>
              <div className="flex gap-1">
                {stages.map((stage, i) => (
                  <div key={i} className="flex-1 group/s relative">
                    <div
                      className={`h-2.5 border border-border-pixel/30 transition-all ${
                        stage.completed
                          ? "bg-accent-green/80 shadow-[0_0_8px_rgba(0,255,136,0.2)]"
                          : "bg-[#0a0a20]"
                      }`}
                    />
                    <span className="absolute -bottom-4 left-1/2 -translate-x-1/2 font-[family-name:var(--font-pixel)] text-[4px] text-text-secondary/60 opacity-0 group-hover/s:opacity-100 transition-opacity whitespace-nowrap">
                      {stage.name}
                    </span>
                  </div>
                ))}
              </div>
            </div>

            <div className="flex flex-wrap gap-1.5 pt-1">
              <span className="pixel-tag">
                {t(`category.${project.category}`)}
              </span>
              {project.tags.map((tag) => (
                <span
                  key={tag}
                  className="pixel-tag text-accent-cyan border-accent-cyan/20"
                >
                  #{tag}
                </span>
              ))}
            </div>

            <div className="flex gap-2 pt-1">
              <Link
                href={stream.id.startsWith("real-") ? `/watch/${(stream as Stream & { _roomName?: string })._roomName || stream.id}` : `/stream/${stream.id}`}
                className="flex-1 pixel-btn border-accent-green text-accent-green hover:bg-accent-green hover:text-bg-primary text-center text-[9px]"
              >
                {isLive ? t('btn.enterStream') : t('btn.viewProject')}
              </Link>
              {project.productUrl && (
                <a
                  href={project.productUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="pixel-btn border-accent-cyan text-accent-cyan hover:bg-accent-cyan hover:text-bg-primary text-[9px]"
                >
                  {t('btn.tryIt')}
                </a>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Main Explore Page ───────────────────────────
export default function ExplorePage() {
  const { t } = useI18n();
  const containerRef = useRef<HTMLDivElement>(null);
  const reticleRef = useRef<HTMLDivElement>(null);
  const reticleOuterRef = useRef<HTMLDivElement>(null);
  const reticleInnerRef = useRef<HTMLDivElement>(null);
  const reticleCrosshairRef = useRef<HTMLDivElement>(null);
  const carouselRef = useRef<HTMLDivElement>(null);
  const cardRefs = useRef<(HTMLDivElement | null)[]>([]);
  const indicatorRefs = useRef<(HTMLDivElement | null)[]>([]);

  // All high-frequency values as refs — no re-renders
  const rotationRef = useRef(0);
  const zoomRef = useRef(1);
  const verticalTiltRef = useRef(0);
  const isDraggingRef = useRef(false);
  const dragStartRef = useRef(0);
  const rotationStartRef = useRef(0);
  const hoveringRef = useRef(false);
  const autoRotateRef = useRef(true);
  const animRef = useRef(0);

  // Only discrete state that needs re-render
  const [selectedStream, setSelectedStream] = useState<Stream | null>(null);
  const [mounted, setMounted] = useState(false);
  const [realStreams, setRealStreams] = useState<Stream[]>([]);
  const selectedStreamRef = useRef<Stream | null>(null);

  // Fetch real streams and convert to Stream shape
  useEffect(() => {
    fetch("/api/streams").then(r => r.json()).then(({ streams: raw }) => {
      if (!raw?.length) return;
      const converted: Stream[] = raw.map((s: Record<string, string | number>) => ({
        id: `real-${s.id}`,
        streamer: {
          id: s.user_id as string,
          username: (s.streamer_name as string) || "streamer",
          displayName: (s.streamer_name as string) || "主播",
          avatarUrl: "",
          bio: "",
          followers: 0,
        },
        project: {
          id: `rp-${s.id}`,
          name: (s.project_name as string) || (s.title as string) || (s.room_name as string),
          description: (s.description as string) || "正在直播中...",
          category: "other" as const,
          platforms: ["web" as const],
          tags: [],
          thumbnailUrl: "",
        },
        status: "live" as const,
        codingTool: ((s.coding_tool as string) || "other") as Stream["codingTool"],
        viewers: (s.viewers_count as number) || 0,
        stages: [{ name: (s.stage as string) || "编码中", completed: false }],
        startedAt: s.started_at as string,
        totalDevTime: 0,
        _roomName: s.room_name as string, // extra field for linking
      }));
      setRealStreams(converted);
    }).catch(() => {});
  }, []);

  const streams = [...realStreams, ...MOCK_STREAMS];
  const radius = 500;
  const angleStep = (Math.PI * 2) / streams.length;

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    selectedStreamRef.current = selectedStream;
  }, [selectedStream]);

  // ── Reticle appearance helper ─────────────────
  const updateReticleAppearance = useCallback((hovering: boolean) => {
    if (reticleOuterRef.current) {
      reticleOuterRef.current.className = hovering
        ? "rounded-full border transition-all duration-200 w-10 h-10 border-accent-cyan shadow-[0_0_20px_rgba(0,229,255,0.4)] opacity-100"
        : "rounded-full border transition-all duration-200 w-6 h-6 border-white/30 opacity-60";
    }
    if (reticleInnerRef.current) {
      reticleInnerRef.current.className = hovering
        ? "absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full transition-all duration-200 w-2 h-2 bg-accent-cyan shadow-[0_0_8px_rgba(0,229,255,0.6)]"
        : "absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full transition-all duration-200 w-1 h-1 bg-white/50";
    }
    if (reticleCrosshairRef.current) {
      reticleCrosshairRef.current.style.display = hovering ? "" : "none";
    }
  }, []);

  // ── Main animation loop (direct DOM updates) ──
  useEffect(() => {
    if (!mounted) return;

    const animate = () => {
      if (
        autoRotateRef.current &&
        !isDraggingRef.current &&
        !selectedStreamRef.current
      ) {
        rotationRef.current += 0.002;
      }

      if (carouselRef.current) {
        carouselRef.current.style.transform = `rotateX(${verticalTiltRef.current}deg)`;
      }

      const zoom = zoomRef.current;
      const rot = rotationRef.current;

      cardRefs.current.forEach((el, i) => {
        if (!el) return;
        const theta = i * angleStep + rot;
        const x = Math.sin(theta) * radius;
        const z = Math.cos(theta) * radius;
        const scaleFactor = (z + radius) / (radius * 2);
        const depthScale = 0.5 + scaleFactor * 0.6;
        const opacity = 0.2 + scaleFactor * 0.8;
        const blur = Math.max(0, (1 - scaleFactor) * 4);
        const isFront = z > 0;

        el.style.transform = `translate(-50%, -50%) translateX(${x * zoom}px) translateZ(${z * zoom}px) scale(${depthScale * zoom})`;
        el.style.zIndex = String(Math.round(z + radius));
        el.style.opacity = String(opacity);
        el.style.filter = `blur(${blur}px)`;
        el.style.pointerEvents = isFront ? "auto" : "none";
      });

      indicatorRefs.current.forEach((el, i) => {
        if (!el) return;
        const theta = i * angleStep + rot;
        const z = Math.cos(theta);
        const isFront = z > 0.7;
        const stream = streams[i];

        if (isFront) {
          el.className =
            stream.status === "live"
              ? "w-1.5 h-1.5 rounded-full transition-all duration-300 bg-accent-green shadow-[0_0_6px_rgba(0,255,136,0.5)]"
              : "w-1.5 h-1.5 rounded-full transition-all duration-300 bg-accent-purple shadow-[0_0_4px_rgba(139,92,246,0.3)]";
        } else {
          el.className =
            "w-1.5 h-1.5 rounded-full transition-all duration-300 bg-border-pixel/30";
        }
      });

      animRef.current = requestAnimationFrame(animate);
    };

    animRef.current = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(animRef.current);
  }, [mounted, angleStep, radius, streams, updateReticleAppearance]);

  // ── Mouse tracking (window-level, works over DetailPanel) ──
  useEffect(() => {
    const onMouseMove = (e: MouseEvent) => {
      if (reticleRef.current) {
        reticleRef.current.style.left = `${e.clientX}px`;
        reticleRef.current.style.top = `${e.clientY}px`;
      }

      const target = e.target as HTMLElement;
      const isHovering = !!target.closest("[data-hoverable]");
      if (isHovering !== hoveringRef.current) {
        hoveringRef.current = isHovering;
        updateReticleAppearance(isHovering);
      }

      verticalTiltRef.current =
        (e.clientY / window.innerHeight - 0.5) * 2 * 8;

      if (isDraggingRef.current) {
        const delta = (e.clientX - dragStartRef.current) * 0.004;
        rotationRef.current = rotationStartRef.current + delta;
      }
    };

    window.addEventListener("mousemove", onMouseMove);
    return () => window.removeEventListener("mousemove", onMouseMove);
  }, [updateReticleAppearance]);

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    if (selectedStreamRef.current) return;
    const target = e.target as HTMLElement;
    if (target.closest("[data-hoverable]")) return;
    isDraggingRef.current = true;
    dragStartRef.current = e.clientX;
    rotationStartRef.current = rotationRef.current;
    autoRotateRef.current = false;
  }, []);

  const handleMouseUp = useCallback(() => {
    isDraggingRef.current = false;
    setTimeout(() => {
      autoRotateRef.current = true;
    }, 3000);
  }, []);

  const handleWheel = useCallback((e: React.WheelEvent) => {
    if (selectedStreamRef.current) return;
    zoomRef.current = Math.max(
      0.5,
      Math.min(1.8, zoomRef.current - e.deltaY * 0.001)
    );
  }, []);

  // ── Keyboard ──────────────────────────────────
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (selectedStreamRef.current && e.key === "Escape") {
        setSelectedStream(null);
        return;
      }
      if (e.key === "ArrowLeft" || e.key === "a") {
        rotationRef.current += 0.15;
        autoRotateRef.current = false;
        setTimeout(() => {
          autoRotateRef.current = true;
        }, 3000);
      }
      if (e.key === "ArrowRight" || e.key === "d") {
        rotationRef.current -= 0.15;
        autoRotateRef.current = false;
        setTimeout(() => {
          autoRotateRef.current = true;
        }, 3000);
      }
      if (e.key === "ArrowUp" || e.key === "w") {
        zoomRef.current = Math.min(1.8, zoomRef.current + 0.1);
      }
      if (e.key === "ArrowDown" || e.key === "s") {
        zoomRef.current = Math.max(0.5, zoomRef.current - 0.1);
      }
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, []);

  const liveCount = streams.filter((s) => s.status === "live").length;
  const totalViewers = streams.reduce((s, st) => s + st.viewers, 0);

  return (
    <div
      ref={containerRef}
      className="fixed inset-0 overflow-hidden bg-[#030310] select-none [&_*]:!cursor-none"
      style={{ cursor: "none", perspective: "1000px" }}
      onMouseDown={handleMouseDown}
      onMouseUp={handleMouseUp}
      onMouseLeave={handleMouseUp}
      onWheel={handleWheel}
    >
      {/* Star warp field */}
      <StarField />

      {/* Ambient glow orbs */}
      <div className="absolute inset-0 pointer-events-none z-[1]">
        <div
          className="absolute w-[700px] h-[700px] rounded-full blur-[180px] opacity-[0.06]"
          style={{
            background: "radial-gradient(circle, #8b5cf6, transparent 70%)",
            left: "20%",
            top: "10%",
          }}
        />
        <div
          className="absolute w-[500px] h-[500px] rounded-full blur-[150px] opacity-[0.04]"
          style={{
            background: "radial-gradient(circle, #00e5ff, transparent 70%)",
            right: "10%",
            bottom: "20%",
          }}
        />
        <div
          className="absolute w-[400px] h-[400px] rounded-full blur-[130px] opacity-[0.03]"
          style={{
            background: "radial-gradient(circle, #ff2d78, transparent 70%)",
            left: "50%",
            bottom: "10%",
          }}
        />
      </div>

      {/* ── Tron Grid Floor ──────────────────── */}
      <div
        className="absolute left-0 right-0 bottom-0 h-[60vh] pointer-events-none z-[2] overflow-hidden"
        style={{
          perspective: "600px",
          perspectiveOrigin: "50% 0%",
        }}
      >
        <div
          className="w-full h-full origin-top"
          style={{
            transform: "rotateX(65deg) translateZ(0px) scale(3)",
            backgroundImage:
              "linear-gradient(rgba(139,92,246,0.12) 1px, transparent 1px), linear-gradient(90deg, rgba(139,92,246,0.12) 1px, transparent 1px)",
            backgroundSize: "60px 60px",
            maskImage:
              "linear-gradient(to bottom, transparent 0%, black 30%, black 70%, transparent 100%)",
            WebkitMaskImage:
              "linear-gradient(to bottom, transparent 0%, black 30%, black 70%, transparent 100%)",
          }}
        />
        <div className="absolute top-0 left-0 right-0 h-20 bg-gradient-to-b from-accent-purple/5 to-transparent" />
      </div>

      {/* ── Center Title HUD ─────────────────── */}
      <div className="absolute z-10 left-1/2 top-[12%] -translate-x-1/2 text-center pointer-events-none">
        <h1 className="font-[family-name:var(--font-pixel)] text-[22px] text-accent-green glow-green tracking-[6px] mb-2">
          EXPLORE
        </h1>
        <p className="text-text-secondary/40 text-xs tracking-wider">
          {t('explore.subtitle')}
        </p>
        <div className="flex items-center justify-center gap-5 mt-3">
          <span className="font-[family-name:var(--font-pixel)] text-[7px] text-accent-pink">
            ◉ {liveCount} LIVE
          </span>
          <span className="font-[family-name:var(--font-pixel)] text-[7px] text-accent-cyan">
            ◈ {totalViewers} {t('nav.online')}
          </span>
          <span className="font-[family-name:var(--font-pixel)] text-[7px] text-accent-yellow">
            ◆ {streams.length} {t('explore.projects')}
          </span>
        </div>
      </div>

      {/* ── 3D Carousel ──────────────────────── */}
      <div
        className="absolute inset-0 z-20"
        style={{
          perspective: "1000px",
          perspectiveOrigin: "50% 45%",
        }}
      >
        <div
          ref={carouselRef}
          className="absolute left-1/2 top-[52%] w-0 h-0"
          style={{
            transformStyle: "preserve-3d",
            transition: "transform 0.3s ease-out",
          }}
        >
          {mounted &&
            streams.map((stream, i) => (
              <div
                key={stream.id}
                ref={(el) => {
                  cardRefs.current[i] = el;
                }}
                className="absolute left-1/2 top-1/2 -translate-y-1/2 transition-[filter] duration-300"
              >
                <CardContent stream={stream} onSelect={setSelectedStream} />
              </div>
            ))}
        </div>
      </div>

      {/* ── Detail Panel ─────────────────────── */}
      {selectedStream && (
        <DetailPanel
          stream={selectedStream}
          onClose={() => setSelectedStream(null)}
        />
      )}

      {/* ── VR Reticle Cursor (ref-driven) ────── */}
      {mounted && (
        <div
          ref={reticleRef}
          className="fixed pointer-events-none z-[200]"
          style={{ transform: "translate(-50%, -50%)", left: 0, top: 0 }}
        >
          <div
            ref={reticleOuterRef}
            className="rounded-full border transition-all duration-200 w-6 h-6 border-white/30 opacity-60"
          >
            <div
              ref={reticleInnerRef}
              className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full transition-all duration-200 w-1 h-1 bg-white/50"
            />
          </div>
          <div ref={reticleCrosshairRef} style={{ display: "none" }}>
            <div className="absolute left-1/2 -top-2 w-px h-1.5 bg-accent-cyan/50 -translate-x-1/2" />
            <div className="absolute left-1/2 -bottom-2 w-px h-1.5 bg-accent-cyan/50 -translate-x-1/2" />
            <div className="absolute top-1/2 -left-2 h-px w-1.5 bg-accent-cyan/50 -translate-y-1/2" />
            <div className="absolute top-1/2 -right-2 h-px w-1.5 bg-accent-cyan/50 -translate-y-1/2" />
          </div>
        </div>
      )}

      {/* ── Bottom HUD ───────────────────────── */}
      <div className="absolute bottom-0 left-0 right-0 z-30 pointer-events-auto">
        <div className="flex items-center justify-between px-6 py-3 bg-gradient-to-t from-black/80 via-black/40 to-transparent">
          <Link
            href="/"
            className="font-[family-name:var(--font-pixel)] text-[8px] text-text-secondary hover:text-accent-cyan transition-colors"
            style={{ cursor: "none" }}
            data-hoverable="true"
          >
            ◁ {t('nav.home')}
          </Link>

          <div className="flex items-center gap-6 font-[family-name:var(--font-pixel)] text-[6px] text-text-secondary/30">
            <span>{t('explore.rotate')}</span>
            <span>{t('explore.zoom')}</span>
            <span>{t('explore.drag')}</span>
            <span>{t('explore.close')}</span>
          </div>

          <Link
            href="/profile"
            className="font-[family-name:var(--font-pixel)] text-[8px] text-text-secondary hover:text-accent-purple transition-colors"
            style={{ cursor: "none" }}
            data-hoverable="true"
          >
            {t('nav.profile')} ▷
          </Link>
        </div>
      </div>

      {/* ── Side indicators ──────────────────── */}
      <div className="absolute left-4 top-1/2 -translate-y-1/2 z-30 flex flex-col gap-2 pointer-events-none">
        {streams.map((s, i) => (
          <div
            key={s.id}
            ref={(el) => {
              indicatorRefs.current[i] = el;
            }}
            className="w-1.5 h-1.5 rounded-full transition-all duration-300 bg-border-pixel/30"
          />
        ))}
      </div>
    </div>
  );
}
