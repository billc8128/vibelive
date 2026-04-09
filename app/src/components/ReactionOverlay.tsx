"use client";

import { useState, useEffect, useRef } from "react";

// ── Types ──────────────────────────────────────
export type ReactionKind = "want_to_use" | "interesting" | "looking_forward" | "mind_blown" | "big_brain";

export interface ReactionConfig {
  label: string;
  icon: string;
  color: string;      // tailwind color name (e.g. "accent-cyan")
  glowVar: string;    // CSS glow variable value
}

export const REACTION_CONFIG: Record<ReactionKind, ReactionConfig> = {
  want_to_use:     { label: "想用", icon: "🚀", color: "accent-cyan",   glowVar: "var(--glow-cyan)" },
  interesting:     { label: "有趣", icon: "✨", color: "accent-yellow", glowVar: "var(--glow-yellow, rgba(255,215,0,0.5))" },
  looking_forward: { label: "期待", icon: "🔥", color: "accent-pink",   glowVar: "var(--glow-pink, rgba(255,100,130,0.5))" },
  mind_blown:      { label: "炸裂", icon: "🤯", color: "accent-pink",   glowVar: "var(--glow-pink, rgba(255,100,130,0.5))" },
  big_brain:       { label: "高手", icon: "🧠", color: "accent-purple", glowVar: "var(--glow-purple)" },
};

export interface OverlayBurst {
  id: string;
  icon: string;
  x: number;       // 5-95%
  tier: 0 | 1 | 2 | 3;
  glowVar: string;
  color: string;
  // Per-particle motion variation — every emoji animates uniquely
  drift: number;     // -70..70 px end-position horizontal drift
  rotStart: number;  // -25..25 deg
  rotEnd: number;    // -120..120 deg
  duration: number;  // ms — varies by tier + jitter
  scale: number;     // 0.85..1.2 base scale
  delay: number;     // ms — staggers particles within a single burst
}

export type ComboTier = 0 | 1 | 2 | 3;

interface ComboEntry {
  timestamps: number[];
  tier: ComboTier;
}

export interface ComboState {
  [kind: string]: ComboEntry;
}

const COMBO_WINDOW_MS = 3000;
const TIER_THRESHOLDS = [0, 5, 15, 30]; // tier 0: <5, tier 1: 5-14, tier 2: 15-29, tier 3: 30+
const MAX_BURSTS = 80; // ↑ from 30 — meltdown should feel chaotic, not capped

// Particles emitted per click, by current tier of that kind
const PARTICLES_PER_EVENT: Record<ComboTier, number> = { 0: 3, 1: 4, 2: 5, 3: 6 };

function rand(min: number, max: number) {
  return min + Math.random() * (max - min);
}

function getTier(count: number): ComboTier {
  if (count >= TIER_THRESHOLDS[3]) return 3;
  if (count >= TIER_THRESHOLDS[2]) return 2;
  if (count >= TIER_THRESHOLDS[1]) return 1;
  return 0;
}

// ── Hook: useReactionSystem ────────────────────
export function useReactionSystem() {
  const [bursts, setBursts] = useState<OverlayBurst[]>([]);
  const [combo, setCombo] = useState<ComboState>({});
  const [showBanner, setShowBanner] = useState<{ icon: string; count: number; color: string } | null>(null);
  const [screenFlash, setScreenFlash] = useState(false);
  const [screenShake, setScreenShake] = useState(false);
  const bannerTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const shakeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Get the highest active combo tier across all kinds
  const maxTier: ComboTier = Object.values(combo).reduce(
    (max, entry) => Math.max(max, entry.tier) as ComboTier, 0 as ComboTier
  );

  // Register a reaction event (called for both local sends and remote receives)
  const addReaction = (kind: ReactionKind) => {
    const cfg = REACTION_CONFIG[kind];
    if (!cfg) return;

    const now = Date.now();

    // Update combo state
    setCombo(prev => {
      const entry = prev[kind] || { timestamps: [], tier: 0 };
      const cutoff = now - COMBO_WINDOW_MS;
      const timestamps = [...entry.timestamps.filter(t => t > cutoff), now];
      const tier = getTier(timestamps.length);

      // Tier 3 just crossed → meltdown impact: banner + screen flash + shake
      if (tier === 3 && entry.tier < 3) {
        if (bannerTimer.current) clearTimeout(bannerTimer.current);
        if (shakeTimer.current) clearTimeout(shakeTimer.current);
        setShowBanner({ icon: cfg.icon, count: timestamps.length, color: cfg.color });
        setScreenFlash(true);
        setScreenShake(true);
        setTimeout(() => setScreenFlash(false), 400);
        shakeTimer.current = setTimeout(() => setScreenShake(false), 650);
        bannerTimer.current = setTimeout(() => setShowBanner(null), 2000);
      }

      return { ...prev, [kind]: { timestamps, tier } };
    });

    // Spawn burst — multiple particles with randomized motion per particle.
    // Read the freshly-computed tier from combo state via functional update.
    setCombo(prev => {
      const entry = prev[kind] || { timestamps: [], tier: 0 };
      const tier = entry.tier;
      const burstCount = PARTICLES_PER_EVENT[tier];

      const newBursts: OverlayBurst[] = Array.from({ length: burstCount }, (_, i) => ({
        id: `${now}-${Math.random()}-${i}`,
        icon: cfg.icon,
        x: 8 + Math.random() * 84,
        tier,
        glowVar: cfg.glowVar,
        color: cfg.color,
        drift: rand(-70, 70),
        rotStart: rand(-25, 25),
        rotEnd: rand(-120, 120),
        duration: 1800 + tier * 250 + rand(0, 500),
        scale: rand(0.85, 1.2),
        delay: i * rand(20, 90),
      }));

      setBursts(prev => [...prev.slice(-(MAX_BURSTS - burstCount)), ...newBursts]);

      // Cleanup after the longest particle (duration + delay) finishes
      const maxLifetime = Math.max(...newBursts.map(b => b.duration + b.delay)) + 100;
      setTimeout(() => {
        setBursts(prev => prev.filter(b => !newBursts.some(nb => nb.id === b.id)));
      }, maxLifetime);

      return prev;
    });
  };

  // Decay combo tiers every second
  useEffect(() => {
    const interval = setInterval(() => {
      const now = Date.now();
      const cutoff = now - COMBO_WINDOW_MS;
      setCombo(prev => {
        let changed = false;
        const next = { ...prev };
        for (const kind of Object.keys(next)) {
          const entry = next[kind];
          const timestamps = entry.timestamps.filter(t => t > cutoff);
          const tier = getTier(timestamps.length);
          if (timestamps.length !== entry.timestamps.length || tier !== entry.tier) {
            next[kind] = { timestamps, tier };
            changed = true;
          }
        }
        return changed ? next : prev;
      });
    }, 1000);
    return () => clearInterval(interval);
  }, []);

  return { bursts, combo, maxTier, showBanner, screenFlash, screenShake, addReaction };
}

// ── Overlay Component ──────────────────────────
export function ReactionOverlay({
  bursts,
  showBanner,
  screenFlash,
}: {
  bursts: OverlayBurst[];
  showBanner: { icon: string; count: number; color: string } | null;
  screenFlash: boolean;
}) {
  return (
    <>
      {/* Screen flash effect */}
      {screenFlash && (
        <div className="absolute inset-0 z-25 pointer-events-none screen-flash" />
      )}

      {/* Reaction particles — each carries its own motion vars */}
      <div className="reaction-overlay">
        {bursts.map((b) => (
          <span
            key={b.id}
            className={`reaction-particle tier-${b.tier}`}
            style={{
              left: `${b.x}%`,
              "--reaction-glow": b.glowVar,
              "--rise-drift": `${b.drift}px`,
              "--rise-rot-start": `${b.rotStart}deg`,
              "--rise-rot-end": `${b.rotEnd}deg`,
              "--rise-duration": `${b.duration}ms`,
              "--rise-scale": b.scale,
              animationDelay: `${b.delay}ms`,
            } as React.CSSProperties}
          >
            {b.icon}
          </span>
        ))}

        {/* Combo banner (tier 3) */}
        {showBanner && (
          <div className="combo-banner">
            <div className="pixel-border bg-bg-primary/90 px-6 py-3 text-center" style={{ boxShadow: `0 0 30px var(--${showBanner.color}), 0 0 60px var(--${showBanner.color})` }}>
              <div className="font-[family-name:var(--font-pixel)] text-[20px] mb-1">
                {showBanner.icon} COMBO x{showBanner.count} {showBanner.icon}
              </div>
              <div className="font-[family-name:var(--font-pixel)] text-[9px] text-accent-cyan tracking-widest">
                M E L T D O W N
              </div>
            </div>
          </div>
        )}
      </div>
    </>
  );
}
