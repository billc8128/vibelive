import type { Source, TransformBox } from "../sources";
import type { TrackingInputs } from "../vtube-config";

// ────────────────────────────────────────────────────────────────
// Unified renderer interface.
//
// 每个 source 类型实现一个 SourceRenderer. Compositor 不关心细节,
// 只调用 draw(ctx, box, time) 把当前帧画到目标矩形里.
//
// 生命周期:
//   init()     初始化 (e.g. getUserMedia, 创建内部 HTMLVideoElement)
//   draw()     每帧被 compositor 调用
//   dispose()  组件卸载时清理 (停止轨道, 释放内存)
//
// init/dispose 是可选 async, 因为 camera/screen 需要请求用户授权.
// draw 必须是同步快速, 不阻塞 rAF.
// ────────────────────────────────────────────────────────────────

export interface SourceRenderer {
  /** 首次使用前调用, 可以 async. */
  init(): Promise<void>;

  /** 当前帧画到 ctx 的 box 矩形里. time 是 compositor 的时间戳, 用于动画. */
  draw(ctx: CanvasRenderingContext2D, box: TransformBox, time: number): void;

  /** 组件卸载 / source 被删除时清理资源. */
  dispose(): void;

  /** Renderer 是否已就绪 (init 完成). draw 在 ready=false 时应该空操作或画占位. */
  readonly ready: boolean;

  /**
   * 可选 — face tracker 推送 VTS-命名的 inputs. Compositor 把 inputs
   * 广播给所有 renderer; 不需要追踪的 renderer (camera/screen) 不实现.
   */
  onTrackingInputs?(inputs: TrackingInputs): void;

  /**
   * 可选 — Compositor 在 updateScene 时把"已存在 source 的最新数据"
   * 推给 renderer. 用于 renderer 响应 source 字段变化 (e.g. Live2D 的
   * activeExpression 切换). transform 已经在 draw 里逐帧拿到了, 这个
   * hook 主要给非 transform 的字段用.
   */
  onSourceUpdate?(source: Source): void;
}
