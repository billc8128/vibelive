"use client";

import { useEffect, useRef, useState, useMemo } from "react";
import { STICKERS, stickerUrl, type Sticker } from "@/lib/stickers";

interface StickerPickerProps {
  onSelect: (stickerId: string) => void;
  onClose: () => void;
}

const CATEGORY_TABS: { id: Sticker["category"] | "all"; label: string; icon: string }[] = [
  { id: "all",   label: "全部", icon: "🌟" },
  { id: "code",  label: "Code", icon: "💻" },
  { id: "vibes", label: "Vibes", icon: "🔥" },
  { id: "mood",  label: "Mood",  icon: "👀" },
];

export function StickerPicker({ onSelect, onClose }: StickerPickerProps) {
  const [activeTab, setActiveTab] = useState<Sticker["category"] | "all">("all");
  const containerRef = useRef<HTMLDivElement>(null);

  // Click-outside + Esc to close — same pattern as EmojiPicker.
  // Mousedown is delayed one tick so the trigger click that opened us
  // doesn't immediately bubble back and close us.
  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    const timer = setTimeout(() => {
      document.addEventListener("mousedown", handleClick);
    }, 0);
    document.addEventListener("keydown", handleKey);
    return () => {
      clearTimeout(timer);
      document.removeEventListener("mousedown", handleClick);
      document.removeEventListener("keydown", handleKey);
    };
  }, [onClose]);

  const visible = useMemo(
    () => (activeTab === "all" ? STICKERS : STICKERS.filter((s) => s.category === activeTab)),
    [activeTab]
  );

  return (
    <div
      ref={containerRef}
      className="absolute bottom-full right-0 mb-2 w-[300px] h-[340px] bg-bg-card border-2 border-border-pixel shadow-[0_8px_32px_rgba(0,0,0,0.6)] flex flex-col z-50"
    >
      {/* Header */}
      <div className="px-3 py-2 border-b border-border-pixel/50 shrink-0">
        <span className="font-[family-name:var(--font-pixel)] text-[8px] text-text-secondary uppercase tracking-wider">
          Stickers · {visible.length}
        </span>
      </div>

      {/* Sticker grid — clicking sends immediately, doesn't insert into input */}
      <div className="flex-1 overflow-y-auto px-2 py-2 min-h-0">
        <div className="grid grid-cols-3 gap-2">
          {visible.map((s) => (
            <button
              key={s.id}
              type="button"
              onClick={() => {
                onSelect(s.id);
                onClose();
              }}
              title={s.label}
              aria-label={s.label}
              className="aspect-square bg-bg-primary border border-border-pixel/40 hover:border-accent-cyan hover:shadow-[0_0_12px_var(--glow-cyan)] transition-all overflow-hidden group"
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={stickerUrl(s.id)}
                alt={s.label}
                className="w-full h-full object-contain group-hover:scale-105 transition-transform"
                draggable={false}
              />
            </button>
          ))}
        </div>
      </div>

      {/* Category tabs (bottom) */}
      <div className="flex items-center border-t border-border-pixel/50 px-1 py-1 gap-0.5 shrink-0">
        {CATEGORY_TABS.map((cat) => (
          <button
            key={cat.id}
            type="button"
            onClick={() => setActiveTab(cat.id)}
            title={cat.label}
            aria-label={cat.label}
            className={`flex-1 h-7 flex items-center justify-center text-base rounded transition-colors ${
              activeTab === cat.id
                ? "bg-accent-cyan/20 shadow-[inset_0_-2px_0_var(--accent-cyan)]"
                : "hover:bg-bg-surface opacity-70 hover:opacity-100"
            }`}
          >
            {cat.icon}
          </button>
        ))}
      </div>
    </div>
  );
}
