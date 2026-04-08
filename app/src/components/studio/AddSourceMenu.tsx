"use client";

import { useState } from "react";
import {
  createCameraSource,
  createScreenSource,
  createLive2DSource,
  type Source,
} from "@/lib/broadcast/sources";
import {
  LIVE2D_MODEL_REGISTRY,
  type Live2DModelEntry,
} from "@/lib/broadcast/model-registry";

// ────────────────────────────────────────────────────────────────
// AddSourceMenu — 一个 [+ 添加源] 按钮, 点开后显示 4 个 source 类型,
// 选一个就 onAdd(source). 不实现弹窗 / 模态, 用 inline 折叠.
//
// Phase 3b: Live2D 选项进入二级菜单, 列出 LIVE2D_MODEL_REGISTRY 里
// 的所有预置模型. 当前只有 saba1B, 后续加模型不用改这个组件.
//
// MVP 不支持 image source (renderer 是 stub). 后续 phase 加.
// ────────────────────────────────────────────────────────────────

interface AddSourceMenuProps {
  onAdd: (source: Source) => void;
}

const PRIMARY_OPTIONS: {
  type: "camera" | "screen" | "live2d";
  label: string;
  icon: string;
  desc: string;
}[] = [
  { type: "camera", label: "摄像头",   icon: "◉", desc: "网络摄像头实时画面" },
  { type: "screen", label: "屏幕共享", icon: "▣", desc: "桌面 / 窗口 / 标签页" },
  {
    type: "live2d",
    label: "Live2D 皮套",
    icon: "◈",
    desc: `${LIVE2D_MODEL_REGISTRY.length} 个预置模型 · VTube Studio 兼容`,
  },
];

type Step = "closed" | "primary" | "live2d";

export function AddSourceMenu({ onAdd }: AddSourceMenuProps) {
  const [step, setStep] = useState<Step>("closed");

  const handlePickPrimary = (type: "camera" | "screen" | "live2d") => {
    if (type === "camera") {
      onAdd(createCameraSource());
      setStep("closed");
      return;
    }
    if (type === "screen") {
      onAdd(createScreenSource());
      setStep("closed");
      return;
    }
    // Live2D — 进入二级菜单
    setStep("live2d");
  };

  const handlePickLive2DModel = (entry: Live2DModelEntry) => {
    onAdd(
      createLive2DSource({
        name: entry.name,
        avatarId: entry.avatarId,
        modelUrl: entry.modelUrl,
        vtubeConfigUrl: entry.vtubeConfigUrl,
      })
    );
    setStep("closed");
  };

  return (
    <div className="space-y-2">
      <button
        type="button"
        onClick={() => setStep((s) => (s === "closed" ? "primary" : "closed"))}
        className="w-full pixel-border bg-bg-card hover:bg-accent-purple/10 px-3 py-2 text-xs text-accent-purple font-[family-name:var(--font-pixel)] transition-colors"
      >
        {step === "closed" ? "+ 添加源" : "− 取消添加"}
      </button>

      {step === "primary" && (
        <div className="pixel-border bg-bg-card divide-y divide-border-pixel/40">
          {PRIMARY_OPTIONS.map((opt) => (
            <button
              key={opt.type}
              type="button"
              onClick={() => handlePickPrimary(opt.type)}
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

      {step === "live2d" && (
        <div className="pixel-border bg-bg-card">
          <div className="flex items-center justify-between px-3 py-1.5 border-b border-border-pixel/40">
            <span className="font-[family-name:var(--font-pixel)] text-[8px] text-accent-cyan uppercase tracking-wider">
              选择 Live2D 模型
            </span>
            <button
              type="button"
              onClick={() => setStep("primary")}
              className="text-[10px] text-text-secondary hover:text-text-primary"
            >
              ← 返回
            </button>
          </div>
          <div className="divide-y divide-border-pixel/40">
            {LIVE2D_MODEL_REGISTRY.map((entry) => (
              <button
                key={entry.avatarId}
                type="button"
                onClick={() => handlePickLive2DModel(entry)}
                className="w-full flex items-center gap-3 px-3 py-2 text-left hover:bg-accent-purple/10 transition-colors"
              >
                <span className="font-[family-name:var(--font-pixel)] text-accent-purple w-5 text-center">
                  {entry.icon ?? "◈"}
                </span>
                <div className="flex-1 min-w-0">
                  <p className="text-xs text-text-primary">{entry.name}</p>
                  <p className="text-[10px] text-text-secondary/70 truncate">
                    {entry.description}
                  </p>
                </div>
              </button>
            ))}
            {LIVE2D_MODEL_REGISTRY.length === 0 && (
              <p className="px-3 py-3 text-[10px] text-text-secondary/60">
                还没有预置模型 — 在 model-registry.ts 里加条目
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
