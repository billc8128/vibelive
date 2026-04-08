import { Application, Ticker } from "pixi.js";
import { Live2DModel } from "pixi-live2d-display-lipsyncpatch/cubism4";
import type { TransformBox } from "../sources";
import type { SourceRenderer } from "./types";
import { loadCubismCore } from "../cubism-loader";

// ────────────────────────────────────────────────────────────────
// 真 Live2D renderer (Cubism 4 / VTube Studio 模型)
//
// 加载流程:
//   1. await loadCubismCore()  - 加载 Live2D Cubism Core JS (CDN)
//   2. 创建一个 detached PIXI Application + 它自己的内部 canvas
//   3. Live2DModel.from(model3.json URL) - pixi-live2d-display 自动 fetch
//      moc3 / 纹理 / physics3 / 表情等
//   4. 加到 stage, scale + center 到 PIXI canvas 内
//   5. 每帧 compositor 调 draw(ctx, box, time), 我们 drawImage(pixiCanvas)
//      把当前帧画到 compositor 的 2D canvas
//
// 关键 caveats:
//   A) PIXI 用 WebGL context, compositor canvas 用 2D context — 同一个
//      <canvas> 只能持有一个 context type, 所以 PIXI 必须有自己的 canvas.
//   B) Cubism 4 only — VTube Studio 模型都是 Cubism 4 (.moc3 v3+),
//      我们只 import cubism4 入口减小 bundle.
//   C) lipsyncpatch fork 要求手动 registerTicker — Live2DModel 内部用
//      PIXI Ticker 跑动画/物理, 不注册的话模型完全静止.
//   D) PIXI Application 的内部 canvas 大小固定 (用 box 的初值),
//      box 后续被 inspector 改大小时, compositor 会缩放 drawImage 输出,
//      不需要 resize PIXI canvas. 这避免了 resize 导致 WebGL context 重建.
// ────────────────────────────────────────────────────────────────

// 全局只 register 一次 PIXI Ticker — 多个 source 实例共享
let tickerRegistered = false;
function ensureTickerRegistered() {
  if (tickerRegistered) return;
  Live2DModel.registerTicker(Ticker);
  tickerRegistered = true;
}

// PIXI 内部 canvas 的固定分辨率. 用一个相对高的值, 然后 compositor
// 在 drawImage 时按目标 box 等比例缩放. 这样模型以接近原生分辨率渲染,
// 缩放质量比小 canvas 更好.
const INTERNAL_CANVAS_W = 800;
const INTERNAL_CANVAS_H = 1000;

export class Live2DRenderer implements SourceRenderer {
  private app: Application | null = null;
  private model: Live2DModel | null = null;
  private modelUrl: string;
  private _ready = false;

  constructor(opts: { modelUrl: string }) {
    this.modelUrl = opts.modelUrl;
  }

  get ready() {
    return this._ready;
  }

  async init(): Promise<void> {
    // 1. 等 Cubism Core 全局可用 (注入 <script> + onload)
    await loadCubismCore();

    // 2. 注册 PIXI ticker (全局一次)
    ensureTickerRegistered();

    // 3. 创建 detached PIXI Application — 它自己的 canvas 不挂 DOM
    //    backgroundAlpha=0 → 透明背景, 让 compositor drawImage 只画到模型像素
    const app = new Application({
      width: INTERNAL_CANVAS_W,
      height: INTERNAL_CANVAS_H,
      backgroundAlpha: 0,
      antialias: true,
      autoStart: true,
      // PIXI 7 默认 view 是新建的 HTMLCanvasElement
    });
    this.app = app;

    // 4. 加载模型 — pixi-live2d-display 自动 fetch model3.json + 所有依赖
    let model: Live2DModel;
    try {
      model = await Live2DModel.from(this.modelUrl);
    } catch (e) {
      // 加载失败 — 释放 PIXI 资源然后抛
      try { app.destroy(true, { children: true, texture: true }); } catch {}
      this.app = null;
      throw new Error(
        `Live2DModel.from(${this.modelUrl}) 失败: ${e instanceof Error ? e.message : String(e)}`
      );
    }

    // 5. 把模型缩放到 PIXI canvas 内, anchor 居中
    //    Live2D 模型的原生大小由 .moc3 决定, 不一定匹配我们的 canvas.
    //    我们算出"等比例适配"的 scale, 然后 anchor 0.5 居中.
    const modelWidth = model.width || INTERNAL_CANVAS_W;
    const modelHeight = model.height || INTERNAL_CANVAS_H;
    const scale = Math.min(
      INTERNAL_CANVAS_W / modelWidth,
      INTERNAL_CANVAS_H / modelHeight
    );
    model.scale.set(scale);
    model.anchor.set(0.5, 0.5);
    model.x = INTERNAL_CANVAS_W / 2;
    model.y = INTERNAL_CANVAS_H / 2;

    app.stage.addChild(model);

    this.model = model;
    this._ready = true;
  }

  draw(ctx: CanvasRenderingContext2D, box: TransformBox): void {
    if (!this._ready || !this.app) return;
    // PIXI 内部 canvas 是 app.view (HTMLCanvasElement)
    const pixiCanvas = this.app.view as HTMLCanvasElement;
    if (pixiCanvas.width === 0 || pixiCanvas.height === 0) return;

    // 等比例 contain 模式: 模型完整可见, 多余空间透明
    const srcAspect = pixiCanvas.width / pixiCanvas.height;
    const dstAspect = box.width / box.height;
    let dw = box.width, dh = box.height, dx = box.x, dy = box.y;
    if (srcAspect > dstAspect) {
      // model 比 box 宽 → 上下留空
      dh = box.width / srcAspect;
      dy = box.y + (box.height - dh) / 2;
    } else {
      // model 比 box 高 → 左右留空
      dw = box.height * srcAspect;
      dx = box.x + (box.width - dw) / 2;
    }
    ctx.drawImage(pixiCanvas, dx, dy, dw, dh);
  }

  dispose(): void {
    if (this.model) {
      try {
        this.model.destroy({ children: true });
      } catch {}
      this.model = null;
    }
    if (this.app) {
      try {
        this.app.destroy(true, { children: true, texture: true });
      } catch {}
      this.app = null;
    }
    this._ready = false;
  }
}
