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
  /** 眼睛开合 (blink) 灵敏度. 1.0 = 原始. 调大 = 更早判定为闭眼,
   *  调小 = 需要明显闭才闭. */
  eyeOpenScale: number;
  /** 眼睛默认开合度 — "基准线" (不是 cap), 你眼睛默认状态对应的输出值.
   *  output = default - blinkRel (single linear baseline shift).
   *  1.0 = 默认瞪大眼, 0.8 = 自然放松, 0.6 = 半睁惺忪, 0.3 = 眯眼.
   *  闭眼时从基准线下降, 睁更大时从基准线上升, 而不是从 1.0 衰减. */
  eyeOpenDefault: number;
  /** 眼球追踪 (look up/down/left/right) 灵敏度. 1.0 = 原始. */
  eyeBallScale: number;
  /** 嘴巴开合灵敏度. 1.0 = 原始. */
  mouthOpenScale: number;
  /** 眉毛灵敏度. 1.0 = 原始. */
  browScale: number;
  /** 身体跟随头部强度. 0 = 不跟, 1 = 跟头同步 (但通过 0.3x ratio 缩
   *  到合理 body 转动幅度). saba1B 默认 vtube.json mapping 可能 dummy,
   *  我们手动写 body 参数. */
  bodyFollowFactor: number;
  /** 呼吸模拟开关. cubism 内置 breath 写 ParamAngleY (dummy), 我们自己写. */
  breathEnabled: boolean;
  /** 呼吸 Y 轴上下振幅 (度). */
  breathAmpY: number;
  /** 呼吸频率 Hz. ~0.25 Hz 接近 normal 人类呼吸 (15 次/分钟). */
  breathFreqHz: number;
  /** Calibration 版本号 — 自增触发 face tracker 在下一帧记录 baseline.
   *  新的 baseline 用作"中性姿态", 后续 raw input 减去 baseline. */
  calibrationVersion: number;
}

/**
 * 默认值. 改这里影响 face tracker / renderer 的初始行为, UI 启动时
 * 也读这些做 useState 初值.
 */
export const STUDIO_CONFIG_DEFAULTS: StudioConfig = {
  faceAngleScale: 0.4,
  eyeOpenScale: 1.0,
  eyeOpenDefault: 0.8,
  eyeBallScale: 1.0,
  mouthOpenScale: 1.0,
  browScale: 1.5,
  bodyFollowFactor: 0.5,
  breathEnabled: true,
  breathAmpY: 4,
  breathFreqHz: 0.25,
  calibrationVersion: 0,
};

/**
 * Live module-level config — face-tracker / live2d renderer 直接读.
 * React UI 通过 mutation 修改字段, 改动立刻对所有 reader 可见.
 */
export const studioConfig: StudioConfig = { ...STUDIO_CONFIG_DEFAULTS };
