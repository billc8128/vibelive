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

type Step = "closed" | "primary" | "live2d" | "live2d-custom";

export function AddSourceMenu({ onAdd }: AddSourceMenuProps) {
  const [step, setStep] = useState<Step>("closed");

  // 自定义 URL 表单状态 — 仅在 step === "live2d-custom" 显示
  const [customModelUrl, setCustomModelUrl] = useState("");
  const [customVtubeUrl, setCustomVtubeUrl] = useState("");
  const [customName, setCustomName] = useState("");
  const [customError, setCustomError] = useState<string | null>(null);

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

  const handleSubmitCustom = () => {
    const url = customModelUrl.trim();
    if (!url) {
      setCustomError("model3.json URL 必填");
      return;
    }
    if (!url.endsWith(".model3.json")) {
      setCustomError("URL 应该以 .model3.json 结尾");
      return;
    }
    // 派生一个稳定 avatarId — 用 URL 路径最后一段去 .model3.json 后缀
    const lastSlash = url.lastIndexOf("/");
    const fileName = lastSlash >= 0 ? url.slice(lastSlash + 1) : url;
    const derivedId = fileName.replace(/\.model3\.json$/, "") || "custom";
    onAdd(
      createLive2DSource({
        name: customName.trim() || derivedId,
        avatarId: derivedId,
        modelUrl: url,
        vtubeConfigUrl: customVtubeUrl.trim() || undefined,
      })
    );
    // 重置 + 关闭
    setCustomModelUrl("");
    setCustomVtubeUrl("");
    setCustomName("");
    setCustomError(null);
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
            {/* 自定义 URL 入口 — 永远在末尾, 用户可以贴第三方 / 自托管 model3.json URL */}
            <button
              type="button"
              onClick={() => {
                setCustomError(null);
                setStep("live2d-custom");
              }}
              className="w-full flex items-center gap-3 px-3 py-2 text-left hover:bg-accent-cyan/10 transition-colors"
            >
              <span className="font-[family-name:var(--font-pixel)] text-accent-cyan w-5 text-center">
                +
              </span>
              <div className="flex-1 min-w-0">
                <p className="text-xs text-accent-cyan">自定义 URL</p>
                <p className="text-[10px] text-text-secondary/70 truncate">
                  贴第三方 / 自托管的 model3.json
                </p>
              </div>
            </button>
          </div>
        </div>
      )}

      {step === "live2d-custom" && (
        <div className="pixel-border bg-bg-card p-3 space-y-2">
          <div className="flex items-center justify-between">
            <span className="font-[family-name:var(--font-pixel)] text-[8px] text-accent-cyan uppercase tracking-wider">
              自定义 Live2D URL
            </span>
            <button
              type="button"
              onClick={() => {
                setStep("live2d");
                setCustomError(null);
              }}
              className="text-[10px] text-text-secondary hover:text-text-primary"
            >
              ← 返回
            </button>
          </div>

          <div>
            <label className="font-[family-name:var(--font-pixel)] text-[7px] text-text-secondary block mb-1">
              model3.json URL <span className="text-accent-red">*</span>
            </label>
            <input
              type="url"
              value={customModelUrl}
              onChange={(e) => setCustomModelUrl(e.target.value)}
              placeholder="https://.../foo.model3.json"
              className="w-full bg-bg-primary border border-border-pixel px-2 py-1 text-xs text-text-primary focus:border-accent-cyan focus:outline-none"
            />
          </div>

          <div>
            <label className="font-[family-name:var(--font-pixel)] text-[7px] text-text-secondary block mb-1">
              .vtube.json URL <span className="opacity-60">(可选, 用于面捕参数映射)</span>
            </label>
            <input
              type="url"
              value={customVtubeUrl}
              onChange={(e) => setCustomVtubeUrl(e.target.value)}
              placeholder="https://.../foo.vtube.json"
              className="w-full bg-bg-primary border border-border-pixel px-2 py-1 text-xs text-text-primary focus:border-accent-cyan focus:outline-none"
            />
          </div>

          <div>
            <label className="font-[family-name:var(--font-pixel)] text-[7px] text-text-secondary block mb-1">
              显示名 <span className="opacity-60">(可选)</span>
            </label>
            <input
              type="text"
              value={customName}
              onChange={(e) => setCustomName(e.target.value)}
              placeholder="留空则用文件名"
              className="w-full bg-bg-primary border border-border-pixel px-2 py-1 text-xs text-text-primary focus:border-accent-cyan focus:outline-none"
            />
          </div>

          {customError && (
            <p className="text-[10px] text-accent-red/90">⚠ {customError}</p>
          )}

          <button
            type="button"
            onClick={handleSubmitCustom}
            className="w-full pixel-border bg-accent-purple/15 hover:bg-accent-purple/25 px-3 py-1.5 text-xs text-accent-purple font-[family-name:var(--font-pixel)] transition-colors"
          >
            + 添加
          </button>

          <p className="text-[10px] text-text-secondary/60 leading-relaxed">
            提示: 模型必须公网可访问且 CORS 允许 vibelieveai.com.
            Cubism 4 / VTube Studio 模型规格.
          </p>
        </div>
      )}
    </div>
  );
}
