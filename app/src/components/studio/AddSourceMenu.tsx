"use client";

import { useEffect, useState, useCallback } from "react";
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
import {
  fetchUserModels,
  toLive2DEntry,
  deleteUserModel,
  type UserVtuberModel,
} from "@/lib/broadcast/user-models";
import { ModelUploader } from "./ModelUploader";

// ────────────────────────────────────────────────────────────────
// AddSourceMenu — 一个 [+ 添加源] 按钮, 点开后显示 4 个 source 类型,
// 选一个就 onAdd(source). 不实现弹窗 / 模态, 用 inline 折叠.
//
// Phase 3b: Live2D 选项进入二级菜单, 列出 LIVE2D_MODEL_REGISTRY 里
// 的所有预置模型 + 当前用户从 /api/vtuber-models 上传的私有模型,
// 点击都直接当 Live2D source 加进 scene. 同一个二级菜单还提供
// 删除自有模型 / 上传新模型 / 自定义 URL 入口.
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

type Step = "closed" | "primary" | "live2d" | "live2d-custom" | "live2d-upload";

export function AddSourceMenu({ onAdd }: AddSourceMenuProps) {
  const [step, setStep] = useState<Step>("closed");

  // 自定义 URL 表单状态 — 仅在 step === "live2d-custom" 显示
  const [customModelUrl, setCustomModelUrl] = useState("");
  const [customVtubeUrl, setCustomVtubeUrl] = useState("");
  const [customName, setCustomName] = useState("");
  const [customError, setCustomError] = useState<string | null>(null);

  // 当前用户已上传的模型 — 进 live2d 菜单时拉一次, 上传/删除完 refetch
  const [userModels, setUserModels] = useState<UserVtuberModel[]>([]);
  const [userModelsLoading, setUserModelsLoading] = useState(false);
  const [userModelsError, setUserModelsError] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const refreshUserModels = useCallback(async () => {
    setUserModelsLoading(true);
    setUserModelsError(null);
    try {
      const list = await fetchUserModels();
      setUserModels(list);
    } catch (e) {
      setUserModelsError(e instanceof Error ? e.message : "加载失败");
    } finally {
      setUserModelsLoading(false);
    }
  }, []);

  // 进 live2d 菜单时拉用户模型 — 不在 closed 时拉, 避免登出/未登录场景
  // 不必要的 401 噪音
  useEffect(() => {
    if (step === "live2d") {
      refreshUserModels();
    }
  }, [step, refreshUserModels]);

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

  const handlePickUserModel = (m: UserVtuberModel) => {
    handlePickLive2DModel(toLive2DEntry(m));
  };

  const handleDeleteUserModel = async (id: string) => {
    if (deletingId) return;
    if (!confirm("删除这个模型? 文件将从云端永久移除, 不可恢复.")) return;
    setDeletingId(id);
    try {
      await deleteUserModel(id);
      // 局部更新, 避免 spinner
      setUserModels((prev) => prev.filter((m) => m.id !== id));
    } catch (e) {
      setUserModelsError(e instanceof Error ? e.message : "删除失败");
    } finally {
      setDeletingId(null);
    }
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
            {/* ── 内置模型 ─────────────────── */}
            <div className="px-3 py-1 bg-bg-primary/30">
              <span className="font-[family-name:var(--font-pixel)] text-[7px] text-text-secondary/70 uppercase">
                内置 · {LIVE2D_MODEL_REGISTRY.length}
              </span>
            </div>
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

            {/* ── 我的模型 ─────────────────── */}
            <div className="px-3 py-1 bg-bg-primary/30 flex items-center justify-between">
              <span className="font-[family-name:var(--font-pixel)] text-[7px] text-text-secondary/70 uppercase">
                我的 · {userModelsLoading ? "..." : userModels.length}
              </span>
              <button
                type="button"
                onClick={() => {
                  setUserModelsError(null);
                  setStep("live2d-upload");
                }}
                className="font-[family-name:var(--font-pixel)] text-[7px] text-accent-cyan hover:underline uppercase"
              >
                + 上传
              </button>
            </div>
            {userModelsError && (
              <p className="px-3 py-1.5 text-[10px] text-accent-red/80">
                ⚠ {userModelsError}
              </p>
            )}
            {!userModelsLoading && userModels.length === 0 && !userModelsError && (
              <p className="px-3 py-2 text-[10px] text-text-secondary/60">
                还没有上传过模型 — 点 [+ 上传] 添加 VTube Studio 模型文件夹
              </p>
            )}
            {userModels.map((m) => (
              <div
                key={m.id}
                className="w-full flex items-center gap-2 pl-3 pr-2 py-2 hover:bg-accent-cyan/5 transition-colors group"
              >
                <button
                  type="button"
                  onClick={() => handlePickUserModel(m)}
                  className="flex items-center gap-3 flex-1 min-w-0 text-left"
                >
                  <span className="font-[family-name:var(--font-pixel)] text-accent-cyan w-5 text-center">
                    ▤
                  </span>
                  <div className="flex-1 min-w-0">
                    <p className="text-xs text-text-primary truncate">{m.name}</p>
                    <p className="text-[10px] text-text-secondary/70 truncate">
                      {m.file_count} 文件 ·{" "}
                      {(m.total_size_bytes / 1024 / 1024).toFixed(1)} MB
                      {m.vtube_config_path ? " · ◇" : ""}
                    </p>
                  </div>
                </button>
                <button
                  type="button"
                  onClick={() => handleDeleteUserModel(m.id)}
                  disabled={deletingId === m.id}
                  title="删除"
                  className="opacity-0 group-hover:opacity-100 text-[10px] text-accent-red/80 hover:text-accent-red px-1.5 py-0.5 transition-opacity disabled:opacity-50"
                >
                  {deletingId === m.id ? "..." : "✕"}
                </button>
              </div>
            ))}

            {/* ── 自定义 URL 入口 ─────────── */}
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

      {step === "live2d-upload" && (
        <ModelUploader
          onCancel={() => setStep("live2d")}
          onUploaded={() => {
            // 上传成功 → 回到列表 + refetch
            setStep("live2d");
            refreshUserModels();
          }}
        />
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
