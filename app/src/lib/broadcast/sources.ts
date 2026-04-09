// ────────────────────────────────────────────────────────────────
// Source type definitions for the broadcast studio.
//
// 使用歧视联合 (discriminated union on `type`) 而非一个 "大对象带
// optional fields". 这样 TypeScript 在 narrowing 之后能自动推断出
// type-specific 字段, 消除 runtime cast, 且后续加 source 类型不会
// 让其他分支产生 optional 污染.
//
// 所有 source 都共享 placement (x/y/w/h/z), 放在一个单独的 TransformBox
// 里降低每个 variant 的重复.
// ────────────────────────────────────────────────────────────────

export type SourceType = "camera" | "screen" | "live2d" | "image";

export interface TransformBox {
  /** Scene 空间坐标,单位像素。 */
  x: number;
  y: number;
  width: number;
  height: number;
  /** z-index: 越大越靠上。 */
  z: number;
}

interface BaseSource {
  id: string;
  name: string; // UI 显示用
  visible: boolean;
  transform: TransformBox;
}

export interface CameraSource extends BaseSource {
  type: "camera";
  /** 可选: 指定 MediaDeviceInfo.deviceId, 否则使用默认摄像头。 */
  deviceId?: string;
}

export interface ScreenSource extends BaseSource {
  type: "screen";
  // getDisplayMedia 选什么屏 / 窗口是用户运行时选的,不需要持久字段
}

/**
 * Live2D source 的表情 hotkey (从 .vtube.json 解析). 在 renderer 加载完
 * .vtube.json 后由 Compositor.onLive2DReady 回调写回 scene state, UI 用
 * 它渲染按钮列表.
 */
export interface Live2DHotkey {
  id: string;
  name: string;
  /** ToggleExpression / RemoveAllExpressions */
  action: "ToggleExpression" | "RemoveAllExpressions" | "Other";
  /** .exp3.json 文件名 (RemoveAllExpressions 时为空) */
  file: string;
}

export interface Live2DSource extends BaseSource {
  type: "live2d";
  /** 预置 avatar 的标识符 (可显示在 UI), e.g. "saba1B" / "default" */
  avatarId: string;
  /**
   * model3.json 的 URL (相对或绝对). 空字符串 → 用占位 renderer
   * (anime-style 头像 + idle bob), 不需要 Cubism Core / 网络资源.
   * 非空 → 走真 Live2D renderer (PIXI + Cubism Core CDN + 模型加载).
   *
   * 例如:
   *   "/live2d/saba1B/saba1B.model3.json"   (本地 public/)
   *   "https://cdn.example.com/.../foo.model3.json"  (生产 CDN)
   */
  modelUrl: string;
  /**
   * VTube Studio 的 .vtube.json 配置文件 URL. 可选 — 没有就走纯
   * Cubism 4 默认行为 (无面捕参数映射). 有就让 face tracker 的输入
   * 通过它定义的 ParameterSettings 写入模型.
   */
  vtubeConfigUrl?: string;
  /**
   * 表情 hotkey 列表 — renderer 加载完 .vtube.json 后由 Compositor
   * 通过 onLive2DReady 回调写入. UI 渲染表情按钮用.
   */
  hotkeys?: Live2DHotkey[];
  /**
   * 当前激活的表情 .exp3.json 文件名. null/undefined = 无表情.
   * UI 点击 hotkey 按钮时写入, renderer 在 onSourceUpdate 里响应.
   */
  activeExpression?: string | null;
}

export interface ImageSource extends BaseSource {
  type: "image";
  /** data: URL 或 http 绝对路径 */
  src: string;
}

export type Source = CameraSource | ScreenSource | Live2DSource | ImageSource;

// ────────────────────────────────────────────────────────────────
// Factories — 创建新 source 时保证字段齐全 + 合理默认值
// ────────────────────────────────────────────────────────────────

let _idCounter = 0;
function nextId(prefix: string): string {
  _idCounter += 1;
  return `${prefix}-${Date.now().toString(36)}-${_idCounter}`;
}

interface NewSourceOptions {
  transform?: Partial<TransformBox>;
  name?: string;
}

/** 场景的默认分辨率, 用于算"居中" placement。 */
export const DEFAULT_SCENE_WIDTH = 1920;
export const DEFAULT_SCENE_HEIGHT = 1080;

function centerBox(w: number, h: number, z: number): TransformBox {
  return {
    x: Math.round((DEFAULT_SCENE_WIDTH - w) / 2),
    y: Math.round((DEFAULT_SCENE_HEIGHT - h) / 2),
    width: w,
    height: h,
    z,
  };
}

export function createCameraSource(
  opts: NewSourceOptions & { deviceId?: string } = {}
): CameraSource {
  return {
    id: nextId("cam"),
    type: "camera",
    name: opts.name || "摄像头",
    visible: true,
    deviceId: opts.deviceId,
    transform: { ...centerBox(480, 360, 10), ...opts.transform },
  };
}

export function createScreenSource(
  opts: NewSourceOptions = {}
): ScreenSource {
  return {
    id: nextId("scr"),
    type: "screen",
    name: opts.name || "屏幕共享",
    visible: true,
    transform: { ...centerBox(1920, 1080, 0), ...opts.transform },
  };
}

export function createLive2DSource(
  opts: NewSourceOptions & {
    avatarId?: string;
    modelUrl?: string;
    vtubeConfigUrl?: string;
  } = {}
): Live2DSource {
  return {
    id: nextId("l2d"),
    type: "live2d",
    name: opts.name || "Live2D 皮套",
    visible: true,
    avatarId: opts.avatarId || "default",
    // 默认空 → 走占位 renderer; 调用方传 modelUrl 才用真 PIXI/Cubism
    modelUrl: opts.modelUrl ?? "",
    vtubeConfigUrl: opts.vtubeConfigUrl,
    transform: { ...centerBox(400, 500, 20), ...opts.transform },
  };
}

export function createImageSource(
  opts: NewSourceOptions & { src: string; name?: string }
): ImageSource {
  return {
    id: nextId("img"),
    type: "image",
    name: opts.name || "图片",
    visible: true,
    src: opts.src,
    transform: { ...centerBox(400, 400, 5), ...opts.transform },
  };
}
