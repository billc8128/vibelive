import type { TransformBox } from "../sources";

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
}
