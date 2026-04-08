"use client";

import { useState } from "react";
import {
  createCameraSource,
  createScreenSource,
  createLive2DSource,
  type Source,
} from "@/lib/broadcast/sources";

// ────────────────────────────────────────────────────────────────
// AddSourceMenu — 一个 [+ 添加源] 按钮, 点开后显示 4 个 source 类型,
// 选一个就 onAdd(source). 不实现弹窗 / 模态, 用 inline 折叠.
//
// MVP 不支持 image source (renderer 是 stub). 后续 phase 加.
// ────────────────────────────────────────────────────────────────

interface AddSourceMenuProps {
  onAdd: (source: Source) => void;
}

const OPTIONS: { type: "camera" | "screen" | "live2d"; label: string; icon: string; desc: string }[] = [
  { type: "camera", label: "摄像头",   icon: "◉", desc: "网络摄像头实时画面" },
  { type: "screen", label: "屏幕共享", icon: "▣", desc: "桌面 / 窗口 / 标签页" },
  { type: "live2d", label: "Live2D 皮套", icon: "◈", desc: "虚拟形象 (MVP 占位)" },
];

export function AddSourceMenu({ onAdd }: AddSourceMenuProps) {
  const [open, setOpen] = useState(false);

  const handlePick = (type: "camera" | "screen" | "live2d") => {
    let source: Source;
    switch (type) {
      case "camera": source = createCameraSource(); break;
      case "screen": source = createScreenSource(); break;
      case "live2d": source = createLive2DSource(); break;
    }
    onAdd(source);
    setOpen(false);
  };

  return (
    <div className="space-y-2">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full pixel-border bg-bg-card hover:bg-accent-purple/10 px-3 py-2 text-xs text-accent-purple font-[family-name:var(--font-pixel)] transition-colors"
      >
        {open ? "− 取消添加" : "+ 添加源"}
      </button>

      {open && (
        <div className="pixel-border bg-bg-card divide-y divide-border-pixel/40">
          {OPTIONS.map((opt) => (
            <button
              key={opt.type}
              type="button"
              onClick={() => handlePick(opt.type)}
              className="w-full flex items-center gap-3 px-3 py-2 text-left hover:bg-bg-surface/60 transition-colors"
            >
              <span className="font-[family-name:var(--font-pixel)] text-accent-cyan w-5 text-center">
                {opt.icon}
              </span>
              <div className="flex-1 min-w-0">
                <p className="text-xs text-text-primary">{opt.label}</p>
                <p className="text-[10px] text-text-secondary/70 truncate">{opt.desc}</p>
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
