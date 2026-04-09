// Platform-bundled sticker set — Discord-style starter pack.
// Files live in /public/stickers/<id>.svg.
//
// To add a new sticker:
//   1. Drop the SVG in app/public/stickers/<id>.svg
//   2. Add an entry to STICKERS below
// Streamer-uploaded stickers are not supported in this MVP — see Phase 4.

export interface Sticker {
  id: string;       // matches the SVG filename (without .svg)
  label: string;    // hover tooltip + a11y
  category: "vibes" | "code" | "mood";
}

export const STICKERS: Sticker[] = [
  // Code-culture stickers
  { id: "ship-it",    label: "Ship it",  category: "code" },
  { id: "lgtm",       label: "LGTM",     category: "code" },
  { id: "bug",        label: "有 bug",   category: "code" },
  { id: "perfect",    label: "完美",     category: "code" },
  { id: "coffee",     label: "续命",     category: "code" },

  // Vibes — high-energy reactions
  { id: "mind-blown", label: "炸裂",     category: "vibes" },
  { id: "fire",       label: "屌爆了",   category: "vibes" },
  { id: "celebrate",  label: "牛逼",     category: "vibes" },
  { id: "lol",        label: "笑死",     category: "vibes" },

  // Mood — quieter signals
  { id: "watching",   label: "在看",     category: "mood" },
  { id: "snooze",     label: "看睡了",   category: "mood" },
  { id: "confused",   label: "啥情况",   category: "mood" },
];

export const STICKER_BY_ID: Record<string, Sticker> = Object.fromEntries(
  STICKERS.map((s) => [s.id, s])
);

export function stickerUrl(id: string): string {
  return `/stickers/${id}.svg`;
}

export function isValidStickerId(id: string): boolean {
  return id in STICKER_BY_ID;
}
