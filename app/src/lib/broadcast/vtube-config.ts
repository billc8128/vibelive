// ────────────────────────────────────────────────────────────────
// VTube Studio .vtube.json parser + parameter applier.
//
// .vtube.json (VTS 模型配置) 的核心字段是 ParameterSettings: 一个数组,
// 每条目把"VTS 追踪输入" (e.g. FaceAngleX) 通过线性 remap + smoothing
// 映射到一个 Live2D 参数 (e.g. ParamAngleX).
//
// 这一层让我们的 face tracker 只需要喂入 VTS 命名的输入字段, 后续
// 换任何 VTube Studio 模型都不用改 renderer / tracker — 只要它的
// .vtube.json 跟着模型一起发, 配置自然套用.
//
// VTS 自身的 smoothing 用了一个未公开的 frame-rate 无关滤波. 我们用
// 简化的指数移动平均 (EMA): smoothing 0 = 直通, 100 = 几乎不动.
// 60fps 下视觉效果跟 VTS 接近, 低帧率会更"硬"一些, 可接受.
// ────────────────────────────────────────────────────────────────

export interface VtubeMapping {
  /** 调试名 (从 .vtube.json 的 Name 字段, e.g. "顔横/FaceX") */
  name: string;
  /** VTS 追踪输入名, 如 "FaceAngleX". 空字符串 = 此条目无输入, 跳过. */
  input: string;
  /** 输入范围 [lower, upper], 用于线性 remap. 注意可能 lower > upper (反向). */
  inputRange: [number, number];
  /** 输出范围 [lower, upper], 对应 Live2D 参数取值. */
  outputRange: [number, number];
  /** Live2D 参数 ID, 如 "ParamAngleX". 空 = 此条目无输出, 跳过. */
  outputLive2D: string;
  /** 0..100, VTS 平滑系数. */
  smoothing: number;
  /** 输入是否 clamp 到 inputRange 内 (clampInput=false 允许超出). */
  clampInput: boolean;
  /** 输出是否 clamp 到 outputRange 内. */
  clampOutput: boolean;
}

export interface VtubeHotkey {
  /** UUID 串, .vtube.json 的 HotkeyID, 用于稳定 React key */
  id: string;
  /** 显示名 (e.g. "照れ/shame", "リセット/reset") */
  name: string;
  /**
   * VTube Studio 行为类型. 我们目前只支持:
   *   - "ToggleExpression"     → 应用 file 指向的 .exp3.json
   *   - "RemoveAllExpressions" → 清空当前表情
   * 其他 (动作播放, 物品 spawn, 颜色叠加 ...) 静默忽略.
   */
  action: "ToggleExpression" | "RemoveAllExpressions" | "Other";
  /** .exp3.json 的相对文件名 (空字符串 = 此 hotkey 没有文件) */
  file: string;
  /** 子目录 (空字符串 = 跟 .vtube.json 同目录, 但实际文件可能在 animetions/) */
  folder: string;
}

export interface VtubeConfig {
  name: string;
  mappings: VtubeMapping[];
  /** 仅保留我们认得的 hotkey: ToggleExpression / RemoveAllExpressions. */
  hotkeys: VtubeHotkey[];
}

// ────────────────────────────────────────────────────────────────
// Loader
// ────────────────────────────────────────────────────────────────

interface RawParameterSetting {
  Name?: string;
  Input?: string;
  InputRangeLower?: number;
  InputRangeUpper?: number;
  OutputRangeLower?: number;
  OutputRangeUpper?: number;
  OutputLive2D?: string;
  Smoothing?: number;
  ClampInput?: boolean;
  ClampOutput?: boolean;
}

interface RawHotkey {
  HotkeyID?: string;
  Name?: string;
  Action?: string;
  File?: string;
  Folder?: string;
}

interface RawVtubeJson {
  Name?: string;
  ParameterSettings?: RawParameterSetting[];
  Hotkeys?: RawHotkey[];
}

export async function loadVtubeConfig(url: string): Promise<VtubeConfig> {
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`vtube config ${url} → HTTP ${res.status}`);
  }
  const json = (await res.json()) as RawVtubeJson;
  const arr: RawParameterSetting[] = Array.isArray(json.ParameterSettings)
    ? json.ParameterSettings
    : [];

  const mappings: VtubeMapping[] = arr
    // 跳过没有 input 或没有 output 的条目 — 它们在 VTS UI 里也是失效状态
    .filter((e) => e.Input && e.OutputLive2D)
    .map((e) => ({
      name: String(e.Name ?? ""),
      input: String(e.Input ?? ""),
      inputRange: [Number(e.InputRangeLower ?? 0), Number(e.InputRangeUpper ?? 1)],
      outputRange: [Number(e.OutputRangeLower ?? 0), Number(e.OutputRangeUpper ?? 1)],
      outputLive2D: String(e.OutputLive2D ?? ""),
      smoothing: Number(e.Smoothing ?? 0),
      clampInput: Boolean(e.ClampInput),
      clampOutput: Boolean(e.ClampOutput),
    }));

  // Hotkeys — 仅保留 ToggleExpression / RemoveAllExpressions, 其他类型忽略.
  // 注意 ToggleExpression 必须有 file (否则无意义), Reset 类的 file 是空的.
  const rawHotkeys: RawHotkey[] = Array.isArray(json.Hotkeys) ? json.Hotkeys : [];
  const hotkeys: VtubeHotkey[] = rawHotkeys
    .map((h): VtubeHotkey | null => {
      const action = String(h.Action ?? "");
      if (action === "ToggleExpression") {
        if (!h.File) return null; // 没文件就跳过
        return {
          id: String(h.HotkeyID ?? ""),
          name: String(h.Name ?? "expression"),
          action: "ToggleExpression",
          file: String(h.File),
          folder: String(h.Folder ?? ""),
        };
      }
      if (action === "RemoveAllExpressions") {
        return {
          id: String(h.HotkeyID ?? ""),
          name: String(h.Name ?? "reset"),
          action: "RemoveAllExpressions",
          file: "",
          folder: "",
        };
      }
      return null;
    })
    .filter((h): h is VtubeHotkey => h !== null);

  return {
    name: String(json.Name ?? ""),
    mappings,
    hotkeys,
  };
}

// ────────────────────────────────────────────────────────────────
// Applier — 持久化 smoothing 状态, 每帧把 tracking inputs 写入 coreModel
// ────────────────────────────────────────────────────────────────

export type TrackingInputs = Record<string, number>;

/** 最简 setParameterValueById 接口, 兼容任何 Cubism 4 coreModel. */
interface CubismLikeModel {
  setParameterValueById(id: string, value: number, weight?: number): void;
}

function remap(v: number, inLo: number, inHi: number, outLo: number, outHi: number): number {
  if (inHi === inLo) return outLo;
  const t = (v - inLo) / (inHi - inLo);
  return outLo + t * (outHi - outLo);
}

function clampToRange(v: number, a: number, b: number): number {
  const lo = Math.min(a, b);
  const hi = Math.max(a, b);
  return Math.max(lo, Math.min(hi, v));
}

export class VtubeApplier {
  private smoothed: Float32Array;
  private hasState: Uint8Array;

  constructor(public readonly config: VtubeConfig) {
    // 一个 mapping 一个 smoothed slot
    this.smoothed = new Float32Array(config.mappings.length);
    this.hasState = new Uint8Array(config.mappings.length);
  }

  /** 把 tracking inputs 写入 coreModel. inputs 里没有的字段直接跳过. */
  apply(coreModel: CubismLikeModel, inputs: TrackingInputs): void {
    const ms = this.config.mappings;
    for (let i = 0; i < ms.length; i++) {
      const m = ms[i];
      const raw = inputs[m.input];
      if (raw === undefined || !Number.isFinite(raw)) continue;

      // 1. 输入 clamp
      const inV = m.clampInput ? clampToRange(raw, m.inputRange[0], m.inputRange[1]) : raw;
      // 2. 线性 remap
      let outV = remap(inV, m.inputRange[0], m.inputRange[1], m.outputRange[0], m.outputRange[1]);
      // 3. 输出 clamp
      if (m.clampOutput) outV = clampToRange(outV, m.outputRange[0], m.outputRange[1]);

      // 4. EMA smoothing
      const alpha = Math.min(0.95, Math.max(0, m.smoothing / 100));
      let final: number;
      if (this.hasState[i]) {
        final = this.smoothed[i] * alpha + outV * (1 - alpha);
      } else {
        final = outV;
        this.hasState[i] = 1;
      }
      this.smoothed[i] = final;

      // 5. 写入 coreModel — 模型上不存在的参数 ID 会抛, 静默吞掉
      try {
        coreModel.setParameterValueById(m.outputLive2D, final);
      } catch {
        // ignore
      }
    }
  }

  /** 清空 smoothing 状态 — 关掉追踪时调用, 避免下次启用时遗留. */
  reset(): void {
    this.smoothed.fill(0);
    this.hasState.fill(0);
  }
}
