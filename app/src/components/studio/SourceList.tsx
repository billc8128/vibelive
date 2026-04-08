"use client";

import type { Scene, SceneAction } from "@/lib/broadcast/scene";

// ────────────────────────────────────────────────────────────────
// Source list — OBS 风格的 "Sources" 面板.
//
// 功能:
//   - 显示所有 source, 选中态高亮
//   - 单击 row → select
//   - 眼睛图标 → toggle visible
//   - 上下箭头 → 调 z-index (move up/down)
//   - 删除按钮 → 移除
//
// 设计:dispatch 走 reducer, 这个组件只是 view + intent.
// ────────────────────────────────────────────────────────────────

interface SourceListProps {
  scene: Scene;
  dispatch: (action: SceneAction) => void;
}

export function SourceList({ scene, dispatch }: SourceListProps) {
  // 列表显示按 z-index 降序 (上面的 layer 显示在列表顶), 跟 OBS 一致
  const ordered = [...scene.sources].sort(
    (a, b) => b.transform.z - a.transform.z
  );

  if (ordered.length === 0) {
    return (
      <div className="pixel-border bg-bg-card p-6 text-center">
        <p className="font-[family-name:var(--font-pixel)] text-[8px] text-text-secondary opacity-60">
          暂无源 · 点击下方 [+] 添加
        </p>
      </div>
    );
  }

  return (
    <div className="pixel-border bg-bg-card divide-y divide-border-pixel/40">
      {ordered.map((s) => {
        const isSelected = scene.selectedId === s.id;
        return (
          <button
            key={s.id}
            type="button"
            onClick={() => dispatch({ type: "select", id: s.id })}
            className={`w-full flex items-center gap-2 px-3 py-2 text-left transition-colors ${
              isSelected ? "bg-accent-purple/15" : "hover:bg-bg-surface/60"
            }`}
          >
            {/* type 图标 */}
            <span
              className={`font-[family-name:var(--font-pixel)] text-[9px] w-5 text-center ${
                isSelected ? "text-accent-purple" : "text-text-secondary"
              }`}
            >
              {iconFor(s.type)}
            </span>

            {/* name */}
            <span
              className={`flex-1 truncate text-xs ${
                s.visible ? "text-text-primary" : "text-text-secondary/40 line-through"
              }`}
            >
              {s.name}
            </span>

            {/* z-index 显示 */}
            <span className="font-[family-name:var(--font-pixel)] text-[6px] text-text-secondary/40">
              z{s.transform.z}
            </span>

            {/* visibility toggle */}
            <span
              role="button"
              tabIndex={0}
              onClick={(e) => {
                e.stopPropagation();
                dispatch({ type: "toggleVisible", id: s.id });
              }}
              className="px-1.5 text-sm hover:text-accent-cyan transition-colors"
              title="显示 / 隐藏"
            >
              {s.visible ? "👁" : "⊘"}
            </span>

            {/* move up */}
            <span
              role="button"
              tabIndex={0}
              onClick={(e) => {
                e.stopPropagation();
                dispatch({ type: "moveUp", id: s.id });
              }}
              className="px-1 text-xs hover:text-accent-cyan transition-colors"
              title="上移一层"
            >
              ▲
            </span>

            {/* move down */}
            <span
              role="button"
              tabIndex={0}
              onClick={(e) => {
                e.stopPropagation();
                dispatch({ type: "moveDown", id: s.id });
              }}
              className="px-1 text-xs hover:text-accent-cyan transition-colors"
              title="下移一层"
            >
              ▼
            </span>

            {/* delete */}
            <span
              role="button"
              tabIndex={0}
              onClick={(e) => {
                e.stopPropagation();
                dispatch({ type: "removeSource", id: s.id });
              }}
              className="px-1.5 text-xs text-text-secondary hover:text-accent-pink transition-colors"
              title="删除"
            >
              ✕
            </span>
          </button>
        );
      })}
    </div>
  );
}

function iconFor(type: string): string {
  switch (type) {
    case "camera": return "◉";
    case "screen": return "▣";
    case "live2d": return "◈";
    case "image":  return "▤";
    default:       return "?";
  }
}
