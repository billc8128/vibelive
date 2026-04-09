"use client";

import { useState, useRef, useEffect, useMemo } from "react";

// localStorage key for recently used emojis
const RECENT_KEY = "vibelive-recent-emoji";
const RECENT_MAX = 32;

// Hand-curated emoji set — ~240 emoji across 6 Discord-style categories.
// Not exhaustive (Unicode has thousands), but covers what people actually
// use in chat. We can extend later by importing a full emoji DB if needed.
const EMOJI_CATEGORIES: { id: string; label: string; icon: string; emojis: string[] }[] = [
  {
    id: "smileys",
    label: "表情",
    icon: "😀",
    emojis: [
      "😀","😃","😄","😁","😆","😅","🤣","😂","🙂","🙃",
      "😉","😊","😇","🥰","😍","🤩","😘","😗","☺️","😚",
      "😙","🥲","😋","😛","😜","🤪","😝","🤑","🤗","🤭",
      "🤫","🤔","🤐","🤨","😐","😑","😶","😏","😒","🙄",
      "😬","🤥","😌","😔","😪","🤤","😴","😷","🤒","🤕",
      "🤢","🤮","🤧","🥵","🥶","🥴","😵","🤯","🤠","🥳",
      "😎","🤓","🧐","😕","😟","🙁","☹️","😮","😯","😲",
      "😳","🥺","😦","😧","😨","😰","😥","😢","😭","😱",
      "😖","😣","😞","😓","😩","😫","🥱","😤","😡","😠",
      "🤬","😈","👿","💀","☠️","👻","👽","🤖","💩","🤡",
    ],
  },
  {
    id: "gestures",
    label: "手势 & 人",
    icon: "👋",
    emojis: [
      "👋","🤚","🖐️","✋","🖖","👌","🤌","🤏","✌️","🤞",
      "🫰","🤟","🤘","🤙","👈","👉","👆","🖕","👇","☝️",
      "👍","👎","✊","👊","🤛","🤜","👏","🙌","👐","🤲",
      "🤝","🙏","✍️","💅","🤳","💪","🦾","🦵","🦶","👂",
      "🦻","👃","🧠","🫀","🫁","🦷","🦴","👀","👁️","👅",
      "👄","💋","🩸",
    ],
  },
  {
    id: "hearts",
    label: "心 & 符号",
    icon: "❤️",
    emojis: [
      "❤️","🧡","💛","💚","💙","💜","🖤","🤍","🤎","💔",
      "❣️","💕","💞","💓","💗","💖","💘","💝","💟","💌",
      "♥️","💯","💢","💥","💫","💦","💨","🕳️","💬","💭",
      "🗯️","♨️","🌀","♻️","✨","⭐","🌟","💫","⚡","🔥",
      "🎉","🎊","🎈","🎁","🎀","🏆","🥇","🥈","🥉","🏅",
    ],
  },
  {
    id: "animals",
    label: "动物 & 自然",
    icon: "🐶",
    emojis: [
      "🐶","🐱","🐭","🐹","🐰","🦊","🐻","🐼","🐨","🐯",
      "🦁","🐮","🐷","🐽","🐸","🐵","🙈","🙉","🙊","🐒",
      "🐔","🐧","🐦","🐤","🐣","🐥","🦆","🦅","🦉","🦇",
      "🐺","🐗","🐴","🦄","🐝","🐛","🦋","🐌","🐞","🐜",
      "🪲","🦗","🕷️","🦂","🐢","🐍","🦎","🦖","🦕","🐙",
      "🦑","🦐","🦞","🦀","🐡","🐠","🐟","🐬","🐳","🐋",
      "🦈","🐊","🐅","🐆","🦓","🦍","🦧","🐘","🦛","🦏",
      "🐪","🐫","🦒","🦘","🐃","🐂","🐄","🐎","🐖","🐏",
      "🐑","🐐","🦌","🐕","🐩","🦮","🐈","🐓","🦃","🦚",
      "🌵","🎄","🌲","🌳","🌴","🌱","🌿","☘️","🍀","🌾",
      "🌺","🌻","🌹","🥀","🌷","🌸","🌼","🌞","🌝","🌚",
      "🌛","🌜","🌙","⭐","🌟","💫","☀️","☁️","⛅","🌈",
    ],
  },
  {
    id: "food",
    label: "食物 & 饮品",
    icon: "🍔",
    emojis: [
      "🍎","🍐","🍊","🍋","🍌","🍉","🍇","🍓","🫐","🍈",
      "🍒","🍑","🥭","🍍","🥥","🥝","🍅","🍆","🥑","🥦",
      "🥬","🥒","🌶️","🫑","🌽","🥕","🫒","🧄","🧅","🥔",
      "🍠","🥐","🥯","🍞","🥖","🥨","🧀","🥚","🍳","🥞",
      "🧇","🥓","🥩","🍗","🍖","🌭","🍔","🍟","🍕","🥪",
      "🥙","🧆","🌮","🌯","🥗","🥘","🍝","🍜","🍲","🍛",
      "🍣","🍱","🥟","🍤","🍙","🍚","🍘","🍥","🥠","🍢",
      "🍡","🍧","🍨","🍦","🥧","🧁","🍰","🎂","🍮","🍭",
      "🍬","🍫","🍿","🍩","🍪","☕","🍵","🍶","🍺","🍻",
      "🥂","🍷","🥃","🍸","🍹","🍾","🥤","🧋","🧃","🥛",
    ],
  },
  {
    id: "objects",
    label: "物品 & 旅行",
    icon: "🚀",
    emojis: [
      "🚀","✈️","🛸","🛰️","🚁","🛶","⛵","🚤","🛥️","🚢",
      "🚂","🚆","🚇","🚊","🚉","🚝","🚄","🚅","🚈","🚞",
      "🚋","🚃","🚎","🚌","🚍","🚙","🚗","🚕","🛺","🚐",
      "🚛","🚜","🏎️","🏍️","🛵","🚲","🛴","🛹","⛽","🚏",
      "🗺️","🗽","🗼","🏰","🏯","🏟️","🎡","🎢","🎠","⛲",
      "⛱️","🏖️","🏝️","🏜️","🌋","⛰️","🏔️","🗻","🏕️","⛺",
      "💻","⌨️","🖥️","🖨️","🖱️","💾","💿","📀","💽","🧮",
      "📱","☎️","📞","📟","📠","📺","📷","📸","📹","🎥",
      "🎬","🎮","🕹️","🎲","🧩","🎯","🎳","🎰","🎨","🖌️",
      "🖍️","✏️","✒️","🖋️","🖊️","📝","💼","📁","📂","🗂️",
      "📅","📆","🗒️","🗓️","📇","📈","📉","📊","📋","📌",
      "📍","📎","🖇️","📏","📐","✂️","🗃️","🗄️","🗑️","🔒",
      "🔓","🔏","🔐","🔑","🗝️","🔨","🪓","⛏️","⚒️","🛠️",
      "⚙️","🧲","🔫","💣","🧨","🪒","🧪","🧫","🧬","🔬",
      "🔭","📡","💉","💊","🩺","🚪","🛏️","🛋️","🪑","🚽",
      "🚿","🛁","🪞","🪟","🧴","🧷","🧹","🧺","🧻","🧼",
    ],
  },
];

interface EmojiPickerProps {
  onSelect: (emoji: string) => void;
  onClose: () => void;
}

// Read recents synchronously during state init — avoids the
// "setState in effect" cascade and gives the right tab on first render.
function loadRecent(): string[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(RECENT_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

export function EmojiPicker({ onSelect, onClose }: EmojiPickerProps) {
  const [recent, setRecent] = useState<string[]>(loadRecent);
  const [activeTab, setActiveTab] = useState<string>(() =>
    loadRecent().length > 0 ? "recent" : "smileys"
  );
  const containerRef = useRef<HTMLDivElement>(null);
  const gridRef = useRef<HTMLDivElement>(null);

  // Click-outside + Esc to close.
  // The mousedown listener has to be attached on the next tick — otherwise the
  // same click that opens the picker (on the trigger button) bubbles to document
  // and immediately closes it.
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

  // Reset scroll when changing tab so user always sees top of new category
  useEffect(() => {
    if (gridRef.current) gridRef.current.scrollTop = 0;
  }, [activeTab]);

  const handlePick = (emoji: string) => {
    onSelect(emoji);
    setRecent((prev) => {
      const next = [emoji, ...prev.filter((e) => e !== emoji)].slice(0, RECENT_MAX);
      try { localStorage.setItem(RECENT_KEY, JSON.stringify(next)); } catch {}
      return next;
    });
  };

  const visibleEmojis = useMemo(() => {
    if (activeTab === "recent") return recent;
    return EMOJI_CATEGORIES.find((c) => c.id === activeTab)?.emojis || [];
  }, [activeTab, recent]);

  const tabs = useMemo(
    () => [{ id: "recent", label: "常用", icon: "🕐" }, ...EMOJI_CATEGORIES.map((c) => ({ id: c.id, label: c.label, icon: c.icon }))],
    []
  );

  return (
    <div
      ref={containerRef}
      className="absolute bottom-full right-0 mb-2 w-[300px] h-[340px] bg-bg-card border-2 border-border-pixel shadow-[0_8px_32px_rgba(0,0,0,0.6)] flex flex-col z-50"
    >
      {/* Header — current category label */}
      <div className="px-3 py-2 border-b border-border-pixel/50 shrink-0">
        <span className="font-[family-name:var(--font-pixel)] text-[8px] text-text-secondary uppercase tracking-wider">
          {tabs.find((t) => t.id === activeTab)?.label || ""}
        </span>
      </div>

      {/* Emoji grid */}
      <div ref={gridRef} className="flex-1 overflow-y-auto px-2 py-2 min-h-0">
        {visibleEmojis.length === 0 ? (
          <p className="text-xs text-text-secondary/40 text-center pt-8">
            还没有最近使用
          </p>
        ) : (
          <div className="grid grid-cols-8 gap-0.5">
            {visibleEmojis.map((emoji, i) => (
              <button
                key={`${activeTab}-${i}`}
                type="button"
                onClick={() => handlePick(emoji)}
                className="aspect-square flex items-center justify-center text-lg hover:bg-bg-surface rounded transition-colors"
              >
                {emoji}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Category tabs (bottom) */}
      <div className="flex items-center border-t border-border-pixel/50 px-1 py-1 gap-0.5 shrink-0">
        {tabs.map((cat) => (
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
