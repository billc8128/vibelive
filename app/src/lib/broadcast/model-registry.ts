// ────────────────────────────────────────────────────────────────
// Live2D 模型注册表 — 把"可用的预置模型"集中在一个地方, AddSourceMenu
// 从这里读, 加新模型只用改这一份配置.
//
// Phase 3f: 模型从 public/ 搬到 Vercel Blob (store xmshd6g6jkhxjpnl).
// 优点:
//   - git repo 不再背 15MB+ 的 .moc3/.png/纹理
//   - CDN edge caching, 全球加载快
//   - 加新模型只改这份 registry, 跑 vercel blob put 上传文件
//
// 加新模型流程:
//   1. 把模型目录 (model3.json + moc3 + textures + physics + vtube.json + 表情)
//      拷到本地任意位置 (e.g. /tmp/foo/)
//   2. 循环上传, pathname 用 live2d/{avatarId}/{原始相对路径}:
//        for f in $(find . -type f); do
//          vercel blob put "$f" --pathname "live2d/foo/${f#./}"
//        done
//   3. 在下面 LIVE2D_MODEL_REGISTRY 加一条新 entry, modelUrl 拼:
//        ${BLOB_BASE}/live2d/foo/foo.model3.json
//
// 自定义 URL (用户运行时输入) 走 AddSourceMenu live2d-custom 表单, 不走
// 这里, 但 entry 的 modelUrl 形态完全一样.
// ────────────────────────────────────────────────────────────────

/** Vercel Blob store base URL — 改这一处可全局换 store. */
const BLOB_BASE = "https://xmshd6g6jkhxjpnl.public.blob.vercel-storage.com";

export interface Live2DModelEntry {
  /** 内部稳定 ID, 不要因为改 name 而改 */
  avatarId: string;
  /** 显示名 — 列表里给用户看 */
  name: string;
  /** 一行简介 — 列表副标题 */
  description: string;
  /** Cubism model3.json 的 URL */
  modelUrl: string;
  /** VTube Studio .vtube.json 的 URL — 没有就传 undefined (不影响渲染, 只是没面捕映射) */
  vtubeConfigUrl?: string;
  /** UI icon (单字符, e.g. ◈ ◉ ▣) */
  icon?: string;
}

/**
 * 内置模型列表. 所有 URL 都来自 Vercel Blob (Phase 3f 起).
 *
 * 排序按"用户最常想用的"放前面 — 默认 / 推荐先, 实验性 / 老的后.
 */
export const LIVE2D_MODEL_REGISTRY: Live2DModelEntry[] = [
  {
    avatarId: "saba1B",
    name: "saba1B",
    description: "VTube Studio 内置示例 · 全套 expressions",
    modelUrl: `${BLOB_BASE}/live2d/saba1B/saba1B.model3.json`,
    vtubeConfigUrl: `${BLOB_BASE}/live2d/saba1B/saba1B.vtube.json`,
    icon: "◈",
  },
];

/** 默认模型 — 用于 /studio 初始 scene 和 placeholder. */
export const DEFAULT_LIVE2D_MODEL = LIVE2D_MODEL_REGISTRY[0];

export function findLive2DModel(avatarId: string): Live2DModelEntry | null {
  return LIVE2D_MODEL_REGISTRY.find((m) => m.avatarId === avatarId) ?? null;
}
