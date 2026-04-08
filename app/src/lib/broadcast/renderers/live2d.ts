import { Application, Ticker } from "pixi.js";
// ⚠ 不能 static import "pixi-live2d-display-lipsyncpatch/cubism4" —
// 那个模块在顶层有 `if (!window.Live2DCubismCore) throw`, 一旦被 bundler
// 解析 (静态 import) 就立刻 evaluate, 而那时我们的 loadCubismCore 还没跑.
// 改用 `import type` (TS 编译后擦除, 无 runtime side effect) + dynamic
// import 在 init() 里, 顺序保证: loadCubismCore → import() → 拿构造器.
import type { Live2DModel as Live2DModelType } from "pixi-live2d-display-lipsyncpatch/cubism4";
import type { Source, TransformBox } from "../sources";
import type { SourceRenderer } from "./types";
import { loadCubismCore } from "../cubism-loader";
import {
  loadVtubeConfig,
  VtubeApplier,
  type TrackingInputs,
  type VtubeHotkey,
} from "../vtube-config";
import { ExpressionApplier } from "../expression-applier";

// ────────────────────────────────────────────────────────────────
// 真 Live2D renderer (Cubism 4 / VTube Studio 模型)
//
// 加载流程:
//   1. await loadCubismCore()  - 加载 Live2D Cubism Core JS (CDN)
//   2. 创建一个 detached PIXI Application + 它自己的内部 canvas
//   3. Live2DModel.from(model3.json URL) - pixi-live2d-display 自动 fetch
//      moc3 / 纹理 / physics3 / 表情等
//   4. 加到 stage, scale + center 到 PIXI canvas 内
//   5. 如果有 vtubeConfigUrl, 平行加载 .vtube.json, 构造 VtubeApplier,
//      hook beforeModelUpdate — 每帧把 latestInputs 写入 coreModel
//   6. 每帧 compositor 调 draw(ctx, box, time), 我们 drawImage(pixiCanvas)
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
//   E) 面捕注入点: 用 `internalModel.on("beforeModelUpdate", cb)`. 这
//      是 Cubism4InternalModel.update() 里 motion + focus + natural +
//      physics 全部跑完之后、最终 model.update() 之前的 hook. 我们用
//      setParameterValueById 全量覆盖, 视觉上自动接管这些参数. 物理
//      (头发摆动等) 用上一帧的旧值, 1 帧延迟可忽略.
// ────────────────────────────────────────────────────────────────

// 第一次成功 dynamic import 后填充, 之后所有 Live2DRenderer 共享.
// 用模块级缓存避免每个 source 都做一次完整的 cubism4 module load.
let Live2DModelCtor: typeof Live2DModelType | null = null;

async function ensureLive2DModule(): Promise<typeof Live2DModelType> {
  if (Live2DModelCtor) return Live2DModelCtor;
  // 顺序很重要 — Cubism Core 必须先注入 window.Live2DCubismCore,
  // 否则下一行的 dynamic import 一 evaluate cubism4 模块就 throw.
  await loadCubismCore();
  const mod = await import("pixi-live2d-display-lipsyncpatch/cubism4");
  Live2DModelCtor = mod.Live2DModel;
  return Live2DModelCtor;
}

// 全局只 register 一次 PIXI Ticker — 多个 source 实例共享
let tickerRegistered = false;
function ensureTickerRegistered(Live2DModel: typeof Live2DModelType) {
  if (tickerRegistered) return;
  Live2DModel.registerTicker(Ticker);
  tickerRegistered = true;
}

// PIXI 内部 canvas 的固定分辨率. 用一个相对高的值, 然后 compositor
// 在 drawImage 时按目标 box 等比例缩放. 这样模型以接近原生分辨率渲染,
// 缩放质量比小 canvas 更好.
const INTERNAL_CANVAS_W = 800;
const INTERNAL_CANVAS_H = 1000;

// pixi-live2d-display 的 internalModel 没有公开类型, 我们需要的字段
// 拿一个最小接口出来, 避开 any 散落
interface InternalModelLike {
  coreModel: { setParameterValueById(id: string, value: number, weight?: number): void };
  on(event: string, cb: () => void): unknown;
  off?(event: string, cb: () => void): unknown;
}

interface Live2DModelLike {
  internalModel: InternalModelLike;
}

export class Live2DRenderer implements SourceRenderer {
  private app: Application | null = null;
  private model: Live2DModelType | null = null;
  private modelUrl: string;
  private vtubeConfigUrl: string | undefined;
  private applier: VtubeApplier | null = null;
  private expressions: ExpressionApplier | null = null;
  /** 表情文件查找用的 baseUrl 列表 — saba1B 的 exp 在 animetions/, 兼容多布局 */
  private expressionBaseUrls: string[] = [];
  /** 当前 source 的 activeExpression 字段, 用于 dedup 切换 */
  private currentExpressionName: string | null = null;
  private latestInputs: TrackingInputs | null = null;
  private beforeUpdateHandler: (() => void) | null = null;
  private lastFrameTime = 0;
  private onHotkeysReady: ((hotkeys: VtubeHotkey[]) => void) | undefined;
  private _ready = false;

  constructor(opts: {
    modelUrl: string;
    vtubeConfigUrl?: string;
    onHotkeysReady?: (hotkeys: VtubeHotkey[]) => void;
  }) {
    this.modelUrl = opts.modelUrl;
    this.vtubeConfigUrl = opts.vtubeConfigUrl;
    this.onHotkeysReady = opts.onHotkeysReady;

    // 表情文件查找的 baseUrl: 跟 .vtube.json 同目录, 以及 animetions/ 子目录
    if (opts.vtubeConfigUrl) {
      const lastSlash = opts.vtubeConfigUrl.lastIndexOf("/");
      const dir = lastSlash >= 0 ? opts.vtubeConfigUrl.slice(0, lastSlash) : "";
      this.expressionBaseUrls = [`${dir}/animetions`, dir];
    }
  }

  get ready() {
    return this._ready;
  }

  async init(): Promise<void> {
    // 1. 加载 Cubism Core + dynamic import cubism4 模块, 拿到 Live2DModel
    //    构造器. ensureLive2DModule 内部保证两步顺序正确, 模块级缓存复用.
    const Live2DModel = await ensureLive2DModule();

    // 2. 注册 PIXI ticker (全局一次)
    ensureTickerRegistered(Live2DModel);

    // 3. 平行启动: vtube config 加载 (可选, 失败不阻塞模型)
    const configPromise = this.vtubeConfigUrl
      ? loadVtubeConfig(this.vtubeConfigUrl).catch((e) => {
          console.warn(
            `[live2d] vtube config ${this.vtubeConfigUrl} 加载失败:`,
            e instanceof Error ? e.message : e
          );
          return null;
        })
      : Promise.resolve(null);

    // 4. 创建 detached PIXI Application — 它自己的 canvas 不挂 DOM
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

    // 5. 加载模型 — pixi-live2d-display 自动 fetch model3.json + 所有依赖
    let model: Live2DModelType;
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

    // 6. 把模型缩放到 PIXI canvas 内, anchor 居中
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

    // 7. 等 vtube config 完成 → 构造 applier + expression applier + hook update
    const config = await configPromise;
    if (config) {
      this.applier = new VtubeApplier(config);
      this.expressions = new ExpressionApplier();

      const internal = (model as unknown as Live2DModelLike).internalModel;
      const handler = () => {
        const now = performance.now();
        const dtMs = this.lastFrameTime === 0 ? 16 : now - this.lastFrameTime;
        this.lastFrameTime = now;

        // 1) face tracking 先写
        if (this.applier && this.latestInputs) {
          this.applier.apply(internal.coreModel, this.latestInputs);
        }
        // 2) expression 后写 → 表情参数覆盖追踪 (与 VTS 一致)
        this.expressions?.apply(internal.coreModel, dtMs);
      };
      internal.on("beforeModelUpdate", handler);
      this.beforeUpdateHandler = handler;

      console.log(
        `[live2d] vtube 配置就绪: ${config.mappings.length} mapping, ${config.hotkeys.length} hotkey`
      );

      // 推送 hotkeys 给 React (UI 渲染按钮)
      this.onHotkeysReady?.(config.hotkeys);
    }

    this._ready = true;
  }

  /** Compositor 把 face tracker 的最新 inputs 推过来. */
  onTrackingInputs(inputs: TrackingInputs): void {
    this.latestInputs = inputs;
  }

  /** Compositor 在 updateScene 时推 source 的最新数据 — 监听 activeExpression 变化. */
  onSourceUpdate(source: Source): void {
    if (source.type !== "live2d") return;
    if (!this.expressions) return;
    const next = source.activeExpression ?? null;
    if (next === this.currentExpressionName) return;
    this.currentExpressionName = next;
    // setActive 是 fire-and-forget — 内部 fetch + cache + fade
    this.expressions.setActive(this.expressionBaseUrls, next).catch((e) => {
      console.warn("[live2d] expression load failed:", e);
    });
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
    // 先解绑 update hook, 避免 destroy 过程中 callback 访问已释放对象
    if (this.beforeUpdateHandler && this.model) {
      const internal = (this.model as unknown as Live2DModelLike).internalModel;
      try { internal.off?.("beforeModelUpdate", this.beforeUpdateHandler); } catch {}
      this.beforeUpdateHandler = null;
    }
    this.applier = null;
    this.expressions?.reset();
    this.expressions = null;
    this.currentExpressionName = null;
    this.latestInputs = null;

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
