// ────────────────────────────────────────────────────────────────
// Live2D 模型注册表 — 把"可用的预置模型"集中在一个地方, AddSourceMenu
// 从这里读, 加新模型只用改这一份配置.
//
// Phase 3b: 只有 saba1B 一个 (从 VTube Studio 复制到 public/live2d/).
// 后续:
//   - 拉更多 VTS 模型进 public/ → 在这里加条目
//   - 模型迁移到 Vercel Blob 后, modelUrl/vtubeConfigUrl 改 CDN URL
//   - 加"自定义 URL 加载"入口 (用户手输 model3.json URL)
//
// 每条目包含展示信息 + Live2DSource factory 需要的 URL.
// avatarId 是稳定标识 (内部用), name 是显示名 (中日英都支持).
// ────────────────────────────────────────────────────────────────

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
 * 内置模型列表. Phase 3b 只有 saba1B; Phase 3c 之后会加更多.
 *
 * 排序按"用户最常想用的"放前面 — 默认 / 推荐先, 实验性 / 老的后.
 */
export const LIVE2D_MODEL_REGISTRY: Live2DModelEntry[] = [
  {
    avatarId: "saba1B",
    name: "saba1B",
    description: "VTube Studio 内置示例 · 全套 expressions",
    modelUrl: "/live2d/saba1B/saba1B.model3.json",
    vtubeConfigUrl: "/live2d/saba1B/saba1B.vtube.json",
    icon: "◈",
  },
];

/** 默认模型 — 用于 /studio 初始 scene 和 placeholder. */
export const DEFAULT_LIVE2D_MODEL = LIVE2D_MODEL_REGISTRY[0];

export function findLive2DModel(avatarId: string): Live2DModelEntry | null {
  return LIVE2D_MODEL_REGISTRY.find((m) => m.avatarId === avatarId) ?? null;
}
