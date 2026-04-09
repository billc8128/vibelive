// ────────────────────────────────────────────────────────────────
// 用户上传的 VTuber 模型 — 客户端 helper
//
// 内置模型 (LIVE2D_MODEL_REGISTRY) 是构建期常量, 走 Vercel Blob.
// 用户自传模型来自 /api/vtuber-models, 走 Supabase Storage public URL.
//
// 这一层的责任:
//   1. fetch /api/vtuber-models → 拿到 DB 里的元数据 (含 storage 路径)
//   2. 把 storage 路径转成可被 pixi-live2d-display fetch 的公开 URL
//   3. 包装成跟内置模型一样的 Live2DModelEntry shape, 让 AddSourceMenu /
//      createLive2DSource 不用区分两种来源
//
// 公开 URL 拼装公式:
//   {NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/vtuber-models/{path}
// ────────────────────────────────────────────────────────────────

import type { Live2DModelEntry } from "./model-registry";

const BUCKET = "vtuber-models";

export interface UserVtuberModel {
  id: string;
  name: string;
  entry_path: string;
  vtube_config_path: string | null;
  storage_prefix: string;
  file_count: number;
  total_size_bytes: number;
  created_at: string;
}

interface ListResponse {
  models?: UserVtuberModel[];
  error?: string;
}

/**
 * 拼出 Supabase Storage public URL.
 * NEXT_PUBLIC_SUPABASE_URL 在 client component 里可读 — Next.js inline 进 bundle.
 */
export function getStoragePublicUrl(path: string): string {
  const base = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!base) {
    // 没配 env → 返回原 path, 让 fetch 报清晰错误而不是静默死
    return path;
  }
  return `${base}/storage/v1/object/public/${BUCKET}/${path}`;
}

/**
 * 把 DB 行转成 Live2DModelEntry — AddSourceMenu / createLive2DSource 通用 shape.
 * avatarId 用 UUID (vtuber_models.id), 不会跟内置模型冲突.
 */
export function toLive2DEntry(model: UserVtuberModel): Live2DModelEntry {
  const sizeMB = (model.total_size_bytes / 1024 / 1024).toFixed(1);
  return {
    avatarId: model.id,
    name: model.name,
    description: `${model.file_count} 个文件 · ${sizeMB} MB${
      model.vtube_config_path ? " · 含 .vtube.json" : ""
    }`,
    modelUrl: getStoragePublicUrl(model.entry_path),
    vtubeConfigUrl: model.vtube_config_path
      ? getStoragePublicUrl(model.vtube_config_path)
      : undefined,
    icon: "▤",
  };
}

/**
 * 拉当前用户的所有模型. 未登录或服务未配置返回空数组 (不抛).
 */
export async function fetchUserModels(): Promise<UserVtuberModel[]> {
  try {
    const res = await fetch("/api/vtuber-models", { cache: "no-store" });
    if (!res.ok) return [];
    const json = (await res.json()) as ListResponse;
    return json.models ?? [];
  } catch {
    return [];
  }
}

/**
 * 删除一个模型 (含 storage). 抛错 → UI 显示.
 */
export async function deleteUserModel(id: string): Promise<void> {
  const res = await fetch(`/api/vtuber-models/${encodeURIComponent(id)}`, {
    method: "DELETE",
  });
  if (!res.ok) {
    let msg = "删除失败";
    try {
      const json = await res.json();
      if (json?.error) msg = json.error;
    } catch {}
    throw new Error(msg);
  }
}
