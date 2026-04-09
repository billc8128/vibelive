"use client";

import { useState, useRef, type ChangeEvent } from "react";
import { createClient } from "@/lib/supabase/client";

// ────────────────────────────────────────────────────────────────
// ModelUploader — 用户自传 VTuber / Live2D 模型
//
// 流程:
//   1. <input type="file" webkitdirectory> 让用户选一个模型文件夹
//   2. 客户端 detectModel() 扫文件列表找 .model3.json + .vtube.json
//   3. 校验 (大小 / 文件数 / 必有 model3.json)
//   4. 生成本地 model_id (uuid), 并发上传 (concurrency=4) 到
//      vtuber-models bucket, path = {user_id}/{model_id}/{webkitRelativePath}
//   5. 全部成功 → POST /api/vtuber-models 注册元数据
//   6. 任一步失败 → best-effort 清理已上传的文件并上报
//
// 父组件通过 onUploaded 拿到新增 model_id (用来 refetch 列表 / 高亮)
// ────────────────────────────────────────────────────────────────

const BUCKET = "vtuber-models";
const MAX_FILE_COUNT = 1000;
const MAX_TOTAL_BYTES = 200 * 1024 * 1024; // 200MB
const MAX_FILE_BYTES = 50 * 1024 * 1024; // 50MB per file
const UPLOAD_CONCURRENCY = 4;

interface DetectedModel {
  modelName: string;
  modelEntry: File; // .model3.json
  vtubeConfig: File | null; // .vtube.json (optional)
  totalBytes: number;
  fileCount: number;
}

interface DetectError {
  error: string;
}

function detectModel(files: File[]): DetectedModel | DetectError {
  if (files.length === 0) return { error: "未选择文件" };
  if (files.length > MAX_FILE_COUNT) {
    return { error: `文件过多 (${files.length} > ${MAX_FILE_COUNT})` };
  }

  const totalBytes = files.reduce((s, f) => s + f.size, 0);
  if (totalBytes > MAX_TOTAL_BYTES) {
    return {
      error: `总大小 ${(totalBytes / 1024 / 1024).toFixed(1)}MB 超过限制 ${MAX_TOTAL_BYTES / 1024 / 1024}MB`,
    };
  }
  for (const f of files) {
    if (f.size > MAX_FILE_BYTES) {
      return {
        error: `文件 ${f.name} (${(f.size / 1024 / 1024).toFixed(1)}MB) 超过单文件限制 ${MAX_FILE_BYTES / 1024 / 1024}MB`,
      };
    }
  }

  // 找所有 .model3.json, 按路径深度排序, 取最浅的
  const modelCandidates = files
    .filter((f) => /\.model3\.json$/i.test(f.webkitRelativePath))
    .sort(
      (a, b) =>
        a.webkitRelativePath.split("/").length -
        b.webkitRelativePath.split("/").length
    );

  if (modelCandidates.length === 0) {
    return {
      error: "未检测到 .model3.json — 这不是有效的 Cubism 4 / VTube Studio 模型",
    };
  }

  const modelEntry = modelCandidates[0];
  const modelDir = modelEntry.webkitRelativePath
    .split("/")
    .slice(0, -1)
    .join("/");

  // .vtube.json: 优先和 model3.json 同目录, 否则取第一个
  const vtubeCandidates = files.filter((f) =>
    /\.vtube\.json$/i.test(f.webkitRelativePath)
  );
  const vtubeConfig =
    vtubeCandidates.find((f) =>
      f.webkitRelativePath.startsWith(modelDir + "/")
    ) ||
    vtubeCandidates[0] ||
    null;

  // 模型名 = 顶层文件夹名 (webkitRelativePath 第一段)
  // (如果用户选的是 model3.json 所在目录, 顶层 = 模型目录)
  const modelName = modelEntry.webkitRelativePath.split("/")[0];

  return {
    modelName,
    modelEntry,
    vtubeConfig,
    totalBytes,
    fileCount: files.length,
  };
}

interface ModelUploaderProps {
  onUploaded?: (modelId: string) => void;
  onCancel?: () => void;
}

type Phase = "idle" | "picked" | "uploading" | "registering" | "done" | "error";

export function ModelUploader({ onUploaded, onCancel }: ModelUploaderProps) {
  const [phase, setPhase] = useState<Phase>("idle");
  const [detected, setDetected] = useState<DetectedModel | null>(null);
  const [files, setFiles] = useState<File[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const inputRef = useRef<HTMLInputElement | null>(null);

  const reset = () => {
    setPhase("idle");
    setDetected(null);
    setFiles([]);
    setError(null);
    setProgress({ done: 0, total: 0 });
    if (inputRef.current) inputRef.current.value = "";
  };

  const handlePick = (e: ChangeEvent<HTMLInputElement>) => {
    const list = Array.from(e.target.files || []);
    setError(null);
    if (list.length === 0) {
      reset();
      return;
    }
    const result = detectModel(list);
    if ("error" in result) {
      setError(result.error);
      setPhase("error");
      setFiles([]);
      setDetected(null);
      return;
    }
    setFiles(list);
    setDetected(result);
    setPhase("picked");
  };

  const handleUpload = async () => {
    if (!detected || files.length === 0) return;
    setError(null);
    setPhase("uploading");

    const supabase = createClient();
    if (!supabase) {
      setError("Supabase 未配置");
      setPhase("error");
      return;
    }
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      setError("请先登录");
      setPhase("error");
      return;
    }

    // 生成 model_id
    const modelId =
      typeof crypto !== "undefined" && "randomUUID" in crypto
        ? crypto.randomUUID()
        : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const storagePrefix = `${user.id}/${modelId}`;

    setProgress({ done: 0, total: files.length });
    const uploadedRelPaths: string[] = [];
    let nextIndex = 0;
    let cancelled = false;

    // 工作线程: 抢 index 上传
    const worker = async () => {
      while (!cancelled) {
        const i = nextIndex++;
        if (i >= files.length) return;
        const f = files[i];
        const rel = f.webkitRelativePath;
        const absPath = `${storagePrefix}/${rel}`;
        const { error: upErr } = await supabase.storage
          .from(BUCKET)
          .upload(absPath, f, { upsert: false, contentType: f.type || undefined });
        if (upErr) {
          cancelled = true;
          throw new Error(`${rel}: ${upErr.message}`);
        }
        uploadedRelPaths.push(rel);
        setProgress({ done: uploadedRelPaths.length, total: files.length });
      }
    };

    try {
      await Promise.all(
        Array.from({ length: UPLOAD_CONCURRENCY }, () => worker())
      );

      // 注册元数据
      setPhase("registering");
      const entryPath = `${storagePrefix}/${detected.modelEntry.webkitRelativePath}`;
      const vtubePath = detected.vtubeConfig
        ? `${storagePrefix}/${detected.vtubeConfig.webkitRelativePath}`
        : null;

      const res = await fetch("/api/vtuber-models", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: detected.modelName,
          entry_path: entryPath,
          vtube_config_path: vtubePath,
          storage_prefix: storagePrefix,
          file_paths: uploadedRelPaths,
          file_count: files.length,
          total_size_bytes: detected.totalBytes,
        }),
      });

      if (!res.ok) {
        let msg = "注册元数据失败";
        try {
          const json = await res.json();
          if (json?.error) msg = json.error;
        } catch {}
        // 注册失败 → 清理已上传的文件
        await cleanupBestEffort(supabase, BUCKET, uploadedRelPaths, storagePrefix);
        throw new Error(msg);
      }

      const json = await res.json();
      setPhase("done");
      onUploaded?.(json.model?.id ?? modelId);
      // 短暂 idle 后回到初始, 让父组件 refetch
      setTimeout(reset, 600);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "上传失败";
      setError(msg);
      // 清理上传到一半的残留
      if (uploadedRelPaths.length > 0) {
        const supabaseStillThere = createClient();
        if (supabaseStillThere) {
          await cleanupBestEffort(
            supabaseStillThere,
            BUCKET,
            uploadedRelPaths,
            storagePrefix
          );
        }
      }
      setPhase("error");
    }
  };

  return (
    <div className="pixel-border bg-bg-card p-3 space-y-2">
      <div className="flex items-center justify-between">
        <span className="font-[family-name:var(--font-pixel)] text-[8px] text-accent-cyan uppercase tracking-wider">
          上传模型 (VTube Studio 兼容)
        </span>
        {onCancel && (
          <button
            type="button"
            onClick={onCancel}
            className="text-[10px] text-text-secondary hover:text-text-primary"
          >
            ← 返回
          </button>
        )}
      </div>

      {/* 选文件夹 */}
      <label className="block">
        <span className="text-[10px] text-text-secondary/80 leading-relaxed">
          选择一个 VTube Studio 模型文件夹 (含 .model3.json + 资源 +
          可选的 .vtube.json)
        </span>
        <input
          ref={inputRef}
          type="file"
          // @ts-expect-error - webkitdirectory is non-standard but supported by all major browsers
          webkitdirectory=""
          directory=""
          multiple
          onChange={handlePick}
          disabled={phase === "uploading" || phase === "registering"}
          className="block w-full mt-1.5 text-[10px] text-text-secondary
                     file:mr-2 file:px-2 file:py-1 file:border file:border-border-pixel
                     file:bg-bg-primary file:text-accent-purple file:text-[10px]
                     file:font-[family-name:var(--font-pixel)] file:cursor-pointer
                     file:hover:bg-accent-purple/10 disabled:opacity-50"
        />
      </label>

      {/* 检测结果 */}
      {phase === "picked" && detected && (
        <div className="border border-border-pixel/60 bg-bg-primary/40 p-2 space-y-1">
          <div className="text-[10px] text-accent-green">✓ 已识别模型</div>
          <div className="text-[10px] text-text-primary truncate">
            <span className="text-text-secondary">名称:</span> {detected.modelName}
          </div>
          <div className="text-[10px] text-text-secondary truncate">
            entry: {detected.modelEntry.webkitRelativePath}
          </div>
          {detected.vtubeConfig ? (
            <div className="text-[10px] text-accent-cyan/80 truncate">
              ◇ .vtube.json: {detected.vtubeConfig.webkitRelativePath}
            </div>
          ) : (
            <div className="text-[10px] text-text-secondary/60">
              ◇ 没有 .vtube.json — 模型可显示但无面捕参数映射
            </div>
          )}
          <div className="text-[10px] text-text-secondary">
            {detected.fileCount} 个文件 ·{" "}
            {(detected.totalBytes / 1024 / 1024).toFixed(1)} MB
          </div>
          <button
            type="button"
            onClick={handleUpload}
            className="mt-2 w-full pixel-border bg-accent-purple/15 hover:bg-accent-purple/25 px-3 py-1.5 text-xs text-accent-purple font-[family-name:var(--font-pixel)] transition-colors"
          >
            ▲ 开始上传
          </button>
        </div>
      )}

      {/* 上传 / 注册中 */}
      {(phase === "uploading" || phase === "registering") && (
        <div className="border border-accent-yellow/40 bg-accent-yellow/5 p-2 space-y-1">
          <div className="text-[10px] text-accent-yellow animate-pulse">
            {phase === "uploading" ? "▲ 上传中..." : "◈ 注册中..."}
          </div>
          <div className="text-[10px] text-text-secondary">
            {progress.done} / {progress.total}
          </div>
          <div className="h-1 bg-bg-primary/60 overflow-hidden">
            <div
              className="h-full bg-accent-yellow transition-all"
              style={{
                width: `${
                  progress.total > 0
                    ? Math.round((progress.done / progress.total) * 100)
                    : 0
                }%`,
              }}
            />
          </div>
        </div>
      )}

      {/* 完成 */}
      {phase === "done" && (
        <div className="border border-accent-green/40 bg-accent-green/5 p-2">
          <div className="text-[10px] text-accent-green">✓ 上传成功</div>
        </div>
      )}

      {/* 错误 */}
      {phase === "error" && error && (
        <div className="border border-accent-red/40 bg-accent-red/5 p-2 space-y-1">
          <div className="text-[10px] text-accent-red">⚠ {error}</div>
          <button
            type="button"
            onClick={reset}
            className="text-[10px] text-text-secondary hover:text-text-primary"
          >
            重新选择
          </button>
        </div>
      )}
    </div>
  );
}

// ────────────────────────────────────────────────────────────────
// 失败时的 best-effort 清理 — 把已上传的相对路径拼回绝对路径删掉.
// 失败不抛 (清理本身失败也只是孤儿对象, 不阻塞用户重试).
// ────────────────────────────────────────────────────────────────
async function cleanupBestEffort(
  supabase: NonNullable<ReturnType<typeof createClient>>,
  bucket: string,
  relPaths: string[],
  prefix: string
): Promise<void> {
  if (relPaths.length === 0) return;
  const abs = relPaths.map((p) => `${prefix}/${p}`);
  try {
    await supabase.storage.from(bucket).remove(abs);
  } catch {
    // best-effort
  }
}
