// ────────────────────────────────────────────────────────────────
// Studio 全局可调参数 — module-level singleton, 跨 face tracker /
// live2d renderer / React UI 共享.
//
// 不走 React Context — face tracker 和 renderer 是 imperative 类,
// 跨 React 边界访问. 直接 module-level object, React 端用 useState
// 持有显示值 + useEffect 同步到这里, 非 React 代码读这个 object.
//
// 简单 pub/sub: setter 触发 listener, React 用 useSyncExternalStore
// 也可以订阅. 现阶段我们的 UI 用 useState 直接 mutation, 不需要订阅.
// ────────────────────────────────────────────────────────────────

export interface StudioConfig {
  /** Face tracker 输出 angle 缩放. 0.4 = MediaPipe 物理 ±50° 压成 ±20°
   *  匹配 vtube.json 校准. 调大 = 更灵敏, 调小 = 更迟钝. */
  faceAngleScale: number;
  /** 呼吸模拟开关. cubism 内置 breath 写 ParamAngleY (dummy), 我们自己写. */
  breathEnabled: boolean;
  /** 呼吸 Y 轴上下振幅 (度). */
  breathAmpY: number;
  /** 呼吸频率 Hz. ~0.25 Hz 接近 normal 人类呼吸 (15 次/分钟). */
  breathFreqHz: number;
}

/**
 * 默认值. 改这里影响 face tracker / renderer 的初始行为, UI 启动时
 * 也读这些做 useState 初值.
 */
export const STUDIO_CONFIG_DEFAULTS: StudioConfig = {
  faceAngleScale: 0.4,
  breathEnabled: true,
  breathAmpY: 4,
  breathFreqHz: 0.25,
};

/**
 * Live module-level config — face-tracker / live2d renderer 直接读.
 * React UI 通过 mutation 修改字段, 改动立刻对所有 reader 可见.
 */
export const studioConfig: StudioConfig = { ...STUDIO_CONFIG_DEFAULTS };
