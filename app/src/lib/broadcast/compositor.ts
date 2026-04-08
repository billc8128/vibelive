import { sourcesInRenderOrder, type Scene } from "./scene";
import type { Source } from "./sources";
import type { SourceRenderer } from "./renderers/types";
import { CameraRenderer } from "./renderers/camera";
import { ScreenRenderer } from "./renderers/screen";
import { Live2DPlaceholderRenderer } from "./renderers/live2d-placeholder";
import { Live2DRenderer } from "./renderers/live2d";
import type { TrackingInputs } from "./vtube-config";

// ────────────────────────────────────────────────────────────────
// Compositor — Scene → Canvas frame.
//
// 持有:
//   - 一个目标 canvas (要绘制到哪里)
//   - 一个 sourceId → SourceRenderer 的缓存
//   - 一个 rAF 循环
//
// 工作方式:
//   1. start(canvas) — 启动 rAF 循环, 每帧调用 renderFrame
//   2. updateScene(scene) — 当 React state 变化时调用, diff renderer 缓存
//      (新增的 source init, 删除的 source dispose, 保留的不动)
//   3. stop() — 停止循环, dispose 所有 renderer, 释放硬件资源
//
// 为什么不直接在 React useEffect 里跑循环:
//   - rAF 循环不应该跟 React 重渲染绑定 — Scene state 一秒可能变 60 次
//     (例如 inspector 拖拽), 但 webcam 不能每次都重启
//   - Compositor 是 imperative 的对象, React 只是入口
// ────────────────────────────────────────────────────────────────

export interface CompositorEvents {
  /** Renderer init() 异常 (e.g. 用户拒绝摄像头授权) */
  onSourceError?: (sourceId: string, error: Error) => void;
  /** 屏幕共享被用户主动停止 */
  onScreenEnded?: (sourceId: string) => void;
}

export class Compositor {
  private canvas: HTMLCanvasElement | null = null;
  private ctx: CanvasRenderingContext2D | null = null;
  private renderers: Map<string, SourceRenderer> = new Map();
  private currentScene: Scene | null = null;
  private rafId: number | null = null;
  private events: CompositorEvents = {};
  private startTime = 0;

  constructor(events: CompositorEvents = {}) {
    this.events = events;
  }

  /** 把 compositor 绑到一个 canvas, 启动 rAF 循环。 */
  start(canvas: HTMLCanvasElement, scene: Scene): void {
    this.canvas = canvas;
    this.canvas.width = scene.width;
    this.canvas.height = scene.height;
    this.ctx = canvas.getContext("2d");
    this.currentScene = scene;
    this.startTime = performance.now();

    // 初始化第一批 source
    this.diffAndUpdate(scene);

    // 启动循环
    const loop = () => {
      this.renderFrame();
      this.rafId = requestAnimationFrame(loop);
    };
    this.rafId = requestAnimationFrame(loop);
  }

  /**
   * Scene 变化时调用, diff renderer 缓存:
   *   - 新出现的 source.id 走 init()
   *   - 不再存在的 source.id 走 dispose()
   *   - 保留的 id 维持原 renderer (不打断已经在跑的 webcam)
   *
   * canvas 大小如果变了也跟着改.
   */
  updateScene(scene: Scene): void {
    this.currentScene = scene;
    if (this.canvas && (this.canvas.width !== scene.width || this.canvas.height !== scene.height)) {
      this.canvas.width = scene.width;
      this.canvas.height = scene.height;
    }
    this.diffAndUpdate(scene);
  }

  /**
   * 把 face tracker 推送的 VTS-命名 inputs 广播给所有 renderer.
   * 不需要追踪的 renderer (camera/screen) 没实现 onTrackingInputs, 自动跳过.
   * 这个 method 一秒可能被调 30~60 次, 实现要尽量便宜.
   */
  setTrackingInputs(inputs: TrackingInputs): void {
    for (const r of this.renderers.values()) {
      r.onTrackingInputs?.(inputs);
    }
  }

  /** 停止循环, dispose 所有 renderer, 完全释放硬件. */
  stop(): void {
    if (this.rafId !== null) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
    for (const r of this.renderers.values()) {
      try {
        r.dispose();
      } catch {
        // dispose 抛异常忽略, 不阻塞清理
      }
    }
    this.renderers.clear();
    this.canvas = null;
    this.ctx = null;
    this.currentScene = null;
  }

  // ────────────────────────────────────────────────────────────────

  private diffAndUpdate(scene: Scene): void {
    const wantedIds = new Set(scene.sources.map((s) => s.id));

    // 1. dispose 不再存在的
    for (const [id, renderer] of this.renderers.entries()) {
      if (!wantedIds.has(id)) {
        try { renderer.dispose(); } catch {}
        this.renderers.delete(id);
      }
    }

    // 2. init 新增的
    for (const source of scene.sources) {
      if (!this.renderers.has(source.id)) {
        const renderer = this.createRendererFor(source);
        this.renderers.set(source.id, renderer);
        // init 是 async, 不阻塞循环 — renderer.ready 在 init 完成前是 false
        renderer.init().catch((err: Error) => {
          this.events.onSourceError?.(source.id, err);
          // init 失败 → 移出 cache, 避免后续每帧都尝试 draw 一个 broken renderer
          try { renderer.dispose(); } catch {}
          this.renderers.delete(source.id);
        });
      }
    }
  }

  private createRendererFor(source: Source): SourceRenderer {
    switch (source.type) {
      case "camera":
        return new CameraRenderer({ deviceId: source.deviceId });
      case "screen": {
        const r = new ScreenRenderer();
        r.onEnded = () => this.events.onScreenEnded?.(source.id);
        return r;
      }
      case "live2d":
        // 有 modelUrl → 真 PIXI + Cubism Core 渲染
        // 没 modelUrl (空字符串) → 占位 renderer (anime 头像 + idle bob)
        if (source.modelUrl) {
          return new Live2DRenderer({
            modelUrl: source.modelUrl,
            vtubeConfigUrl: source.vtubeConfigUrl,
          });
        }
        return new Live2DPlaceholderRenderer({ avatarId: source.avatarId });
      case "image":
        // MVP 不实现 image renderer (留 stub 以免 TS exhaustiveness 报错)
        return new ImageStubRenderer();
    }
  }

  private renderFrame(): void {
    if (!this.ctx || !this.canvas || !this.currentScene) return;
    const ctx = this.ctx;
    const time = performance.now() - this.startTime;

    // 清屏 (深色背景, 跟项目主题协调)
    ctx.fillStyle = "#0a0a14";
    ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);

    // 按 z-index 升序绘制
    const ordered = sourcesInRenderOrder(this.currentScene);
    for (const source of ordered) {
      if (!source.visible) continue;
      const renderer = this.renderers.get(source.id);
      if (!renderer || !renderer.ready) continue;
      try {
        renderer.draw(ctx, source.transform, time);
      } catch {
        // draw 抛异常忽略, 防止单个坏 source 让整个 compositor 挂掉
      }
    }
  }
}

// ────────────────────────────────────────────────────────────────
// 占位 image renderer (MVP 没真实现 image source). 永远 not ready,
// compositor 跳过 draw, 不出错.
// ────────────────────────────────────────────────────────────────
class ImageStubRenderer implements SourceRenderer {
  get ready() { return false; }
  async init() {}
  draw() {}
  dispose() {}
}
