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
import { studioConfig } from "../studio-config";

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
interface CubismRendererLike {
  /** 默认 mask buffer 是 256x256, 严重欠采样 — 我们调高到 2048 修复 mask 锯齿/破洞 */
  setClippingMaskBufferSize(size: number): void;
  /**
   * Cubism 4 mask 有两种模式:
   *  - low precision (默认 false): 所有 mask 挤在一张共享 RT, 按 sub-region 切分,
   *    最多支持 ~16 个 mask group. saba1B 这种 VTS 模型几十个带 mask 的 drawable
   *    (脸/眼/嘴/头发分层) 严重超载, 表现为 mask 整体失效, 角色"鬼影".
   *  - high precision (true): 每个 drawable 重新 render mask, 无数量上限.
   *    单 model 直播工作室完全可以承受这点 GPU 代价.
   */
  useHighPrecisionMask(high: boolean): void;
}

interface InternalModelLike {
  coreModel: {
    setParameterValueById(id: string, value: number, weight?: number): void;
    getParameterValueById?(id: string): number;
    getParameterIndex?(id: string): number;
    /** 用来 enumerate 模型真实参数名, 排查 vtube.json 里的 ParamX 在不在.
     * Cubism4 没有 getParameterId(index) 方法, ID 存私有 _parameterIds 数组,
     * 直接 cast 拿. */
    getParameterCount?(): number;
    _parameterIds?: string[];
    _parameterValues?: Float32Array;
  };
  /** Cubism4InternalModel 上是 public 的, 直接 .renderer (cubism4.js#10797) */
  renderer?: CubismRendererLike;
  on(event: string, cb: () => void): unknown;
  off?(event: string, cb: () => void): unknown;
}

interface Live2DModelLike {
  internalModel: InternalModelLike;
}

// Cubism 4 mask buffer 分辨率 — 默认 256, 改 2048 修复 mask 边缘锯齿/穿透.
// 越大越精细, 但每个 source 多分配几张 framebuffer texture, 显存代价线性
// 增长. 2048 在 saba1B 这种单模型场景几乎无感.
const MASK_BUFFER_SIZE = 2048;

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

  // 一次性 debug 标记 — 帮诊断面捕链路在哪一步断的, 各只 log 一次
  private didLogFirstInputs = false;
  private didLogFirstApply = false;
  // Alias mirror — vtube.json 写 ParamAngleX, 但模型的 deformer 可能 bind 在
  // ParamAngleMX/SX 上 (saba1B 这种多层 angle 设计). init 时探测模型有哪些
  // alias 参数, handler 里把 vtube applier 的写入 mirror 过去.
  private aliasMirror: Array<[string, string[]]> = [];

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
    //
    // ⚠ antialias: false 是必须的!
    //   开 antialias 时 PIXI 用 MSAA framebuffer 做 main render target.
    //   Cubism 4 mask 用裸 gl.createFramebuffer 创建普通 color FBO, 并通过
    //   _rendererProfile.save/restore 保存/恢复 PIXI 的 GL 状态. 该
    //   save/restore 只存了 FRAMEBUFFER_BINDING 这一个 ID, 但 MSAA framebuffer
    //   有 multisample attachment 等额外内部 state, cubism 在自己的 mask FBO
    //   上写完再"切回 PIXI 的 framebuffer ID"时, MSAA resolve 没正确触发,
    //   mask sampler 读到的 framebuffer 内容是 corrupt 的 → 视觉上 mask
    //   完全失效, 所有 drawable 不被 clip, 整个角色变成图层堆叠的"鬼影".
    //   关掉 antialias 后 main framebuffer 是单 sample 普通 color attachment,
    //   跟 mask FBO 同种格式, 状态切换无歧义. 模型纹理本身高分辨率 + alpha
    //   blend 软边, 视觉上几乎看不到锯齿.
    const app = new Application({
      width: INTERNAL_CANVAS_W,
      height: INTERNAL_CANVAS_H,
      backgroundAlpha: 0,
      antialias: false,
      autoStart: true,
      // PIXI 7 默认 view 是新建的 HTMLCanvasElement
    });
    this.app = app;

    // 5. 加载模型 — pixi-live2d-display 自动 fetch model3.json + 所有依赖
    //
    // 关键 options:
    //   - autoUpdate: true  → ⚠ 必须显式传! Automator 构造器对 options
    //                          做 destructuring + 直接赋值给 setter, 不传
    //                          就是 undefined, setter 用 truthy check 判定
    //                          undefined → false → 把 model 从 PIXI Ticker
    //                          移除, 整个 model.update(dt) 链路停摆,
    //                          beforeModelUpdate 永远不 emit → 面捕完全失效.
    //                          (官方"默认 true"只在整个 options 都不传时
    //                          生效, 一旦部分传了就坑.)
    //   - autoFocus: false  → 不让模型 focus 跟随鼠标 (默认 true 会跟鼠标
    //                          转头, 跟我们的面捕冲突)
    //   - autoHitTest: false → 不监听点击 hit-test (没用到, 关掉省事件)
    let model: Live2DModelType;
    try {
      model = await Live2DModel.from(this.modelUrl, {
        autoUpdate: true,
        autoFocus: false,
        autoHitTest: false,
      });
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

    // 6.5. 配置 cubism 4 渲染器:
    //      A) 启用 high precision mask — 默认 low precision 在 saba1B 这种
    //         有几十个 mask 的 VTS 模型上会爆 sub-region 数量上限, 表现为
    //         mask 整体失效, 角色变"鬼影". high precision 每帧重 render
    //         mask, 单模型场景代价可接受.
    //      B) 把 mask 渲染分辨率从默认 256 提到 2048 — 即使在 high precision
    //         模式下, 这个 buffer 决定单个 mask render texture 的分辨率,
    //         越大边缘越锐利.
    //      try/catch 因为 Cubism2 model 没有 .renderer (我们只用 cubism4
    //      入口理论上不会, 但保险起见).
    try {
      const internal = (model as unknown as Live2DModelLike).internalModel;
      // ⚠ 顺序: useHighPrecisionMask 先, setClippingMaskBufferSize 后.
      // setClippingMaskBufferSize 会 release/recreate _clippingManager, 但
      // _useHighPrecisionMask 是 renderer 自己的字段, 不受影响.
      internal.renderer?.useHighPrecisionMask(true);
      internal.renderer?.setClippingMaskBufferSize(MASK_BUFFER_SIZE);
    } catch (e) {
      console.warn("[live2d] cubism renderer 配置失败:", e);
    }

    this.model = model;

    // 7. 等 vtube config 完成 → 构造 applier + expression applier + hook update
    const config = await configPromise;
    if (config) {
      this.applier = new VtubeApplier(config);
      this.expressions = new ExpressionApplier();

      // ── 诊断 + alias mirror 表构建 ──────────────────────────────
      // saba1B 这种 VTuber 模型的 deformer 实际 bind 在 ParamAngleMX/SX 上,
      // ParamAngleX/Y/Z 是"标准接口"占位字段, 写入会进 _parameterValues
      // 但 mesh 完全没绑, 所以 vtube applier 直接写 ParamAngleX 就是无效的.
      // VTube Studio 内部肯定有 alias mirror, 我们也加一份: 检查模型是否
      // 有 M/S 后缀的 alias, 有就在 handler 里把标准参数的值 mirror 过去.
      try {
        const cm = (model as unknown as Live2DModelLike).internalModel.coreModel;
        const ids = cm._parameterIds ?? [];
        const realIds = new Set<string>(ids);
        const wantedIds = Array.from(new Set(config.mappings.map((m) => m.outputLive2D)));
        const present = wantedIds.filter((id) => realIds.has(id));
        const missing = wantedIds.filter((id) => !realIds.has(id));
        console.log(
          `[live2d] 模型参数检查: ${realIds.size} 个真实参数, vtube 用 ${wantedIds.length} 个, 命中 ${present.length}, 缺失 ${missing.length}`
        );
        if (missing.length > 0) {
          console.warn(
            "[live2d] vtube.json 引用了模型不存在的参数 (silent fail):",
            missing
          );
        }

        // 构建 alias mirror 表 — 已知的多层 angle 命名:
        //   ParamAngleX → ParamAngleMX (Master), ParamAngleSX (Sub)
        //   ParamBodyAngleY → ParamBodyY2 (saba1B 用非标准 Y2/Z2 命名)
        // 只保留模型实际拥有的 alias.
        const aliasCandidates: Record<string, string[]> = {
          ParamAngleX: ["ParamAngleMX", "ParamAngleSX"],
          ParamAngleY: ["ParamAngleMY", "ParamAngleSY"],
          ParamAngleZ: ["ParamAngleMZ", "ParamAngleSZ"],
          // saba1B body 没有标准 M/S 后缀, 但有 Y2/Z2 — 大概率是 deformer
          // 实际 bind 的位置 (类比 head 的 M/S 设计).
          ParamBodyAngleX: ["ParamBodyAngleMX", "ParamBodyAngleSX", "ParamBodyX2"],
          ParamBodyAngleY: ["ParamBodyAngleMY", "ParamBodyAngleSY", "ParamBodyY2"],
          ParamBodyAngleZ: ["ParamBodyAngleMZ", "ParamBodyAngleSZ", "ParamBodyZ2"],
        };
        const mirror: Array<[string, string[]]> = [];
        for (const [from, candidates] of Object.entries(aliasCandidates)) {
          if (!realIds.has(from)) continue;
          const aliases = candidates.filter((id) => realIds.has(id));
          if (aliases.length > 0) mirror.push([from, aliases]);
        }
        this.aliasMirror = mirror;
        if (mirror.length > 0) {
          console.log(
            "[live2d] alias mirror 表:",
            mirror.map(([f, ts]) => `${f} → [${ts.join(", ")}]`).join(" | ")
          );
        }
      } catch (e) {
        console.warn("[live2d] 参数 enumerate 失败:", e);
      }

      const internal = (model as unknown as Live2DModelLike).internalModel;
      // Probe 模式: URL 加 ?probe=1 启用. Handler 在 face apply 之后强制
      // 覆盖几个常用 angle 参数为 sin 波, 用来验证 setParameterValueById
      // 真的能驱动 mesh. 如果模型摇头 → 写入生效, 问题在 face tracker
      // 数据流; 如果不摇 → 这些参数是 dummy, 模型实际驱动的是其他参数名.
      const probeMode =
        typeof window !== "undefined" &&
        window.location.search.includes("probe=1");
      if (probeMode) {
        console.log("[live2d] ⚙ PROBE 模式启用: 强制 sin 波写入 ParamAngleX/Y/Z");
      }

      const handler = () => {
        const now = performance.now();
        const dtMs = this.lastFrameTime === 0 ? 16 : now - this.lastFrameTime;
        this.lastFrameTime = now;

        // 1) face tracking 先写到标准参数
        if (this.applier && this.latestInputs) {
          if (!this.didLogFirstApply) {
            this.didLogFirstApply = true;
            console.log(
              "[live2d] ✓ 首次 applier.apply — face tracking 链路活了",
              { sampleInputs: this.latestInputs }
            );
          }
          this.applier.apply(internal.coreModel, this.latestInputs);
        }

        // 2) Body follows head — vtube applier 写 ParamBodyAngleX 可能是
        //    dummy (saba1B 上 head/body 都需要 alias). 这里手动从 ParamAngleX
        //    的当前值乘 bodyFollowFactor 写到 ParamBodyAngleX/Y/Z, 再让
        //    下面的 alias mirror 复制到 ParamBodyY2/Z2 等候选.
        //    bodyFollowFactor=0 → 完全不跟, 1.0 → 跟头同幅度 (太大),
        //    默认 0.5 是合理的"轻微跟随".
        if (studioConfig.bodyFollowFactor > 0) {
          const cm = internal.coreModel;
          const ax = cm.getParameterValueById?.("ParamAngleX") ?? 0;
          const ay = cm.getParameterValueById?.("ParamAngleY") ?? 0;
          const az = cm.getParameterValueById?.("ParamAngleZ") ?? 0;
          const f = studioConfig.bodyFollowFactor;
          if (Number.isFinite(ax))
            cm.setParameterValueById("ParamBodyAngleX", ax * f);
          if (Number.isFinite(ay))
            cm.setParameterValueById("ParamBodyAngleY", ay * f);
          if (Number.isFinite(az))
            cm.setParameterValueById("ParamBodyAngleZ", az * f);
        }

        // 3) 自己模拟呼吸 — cubism 内置 breath 写 ParamAngleY 但是 dummy.
        //    在 ParamAngleY 上 add sin 波 (面捕的 set 之后 add), 让模型有
        //    持续的轻微上下点头, 模拟自然呼吸. 振幅 / 频率从 studioConfig
        //    读, 用户 UI 可调.
        if (studioConfig.breathEnabled) {
          const cm = internal.coreModel;
          const t = performance.now() / 1000;
          const breath =
            Math.sin(t * 2 * Math.PI * studioConfig.breathFreqHz) *
            studioConfig.breathAmpY;
          const cur = cm.getParameterValueById?.("ParamAngleY") ?? 0;
          if (Number.isFinite(cur)) {
            cm.setParameterValueById("ParamAngleY", cur + breath);
          }
          // 同样在 body Y 上轻微 add 一点呼吸 (一半幅度), 让胸腔起伏
          const curBody = cm.getParameterValueById?.("ParamBodyAngleY") ?? 0;
          if (Number.isFinite(curBody)) {
            cm.setParameterValueById(
              "ParamBodyAngleY",
              curBody + breath * 0.5
            );
          }
        }

        // 4) Alias mirror — 把标准参数的当前值 (face + body + breath 之后)
        //    复制到所有已知 alias (saba1B 的 ParamAngleMX/SX, ParamBodyY2 等
        //    真驱动器). 必须最后跑, 让前面所有写入都被 mirror.
        if (this.aliasMirror.length > 0) {
          const cm = internal.coreModel;
          for (const [from, targets] of this.aliasMirror) {
            const v = cm.getParameterValueById?.(from);
            if (v !== undefined && Number.isFinite(v)) {
              for (const t of targets) {
                cm.setParameterValueById(t, v);
              }
            }
          }
        }
        // 2) expression 后写 → 表情参数覆盖追踪 (与 VTS 一致)
        this.expressions?.apply(internal.coreModel, dtMs);

        // 3) Probe — 覆盖一切. 用 sin/cos 写多个候选参数名, 看哪个驱动 mesh.
        if (probeMode) {
          const t = now / 500; // ~每 3 秒一个完整周期
          const yaw = Math.sin(t) * 25;
          const pitch = Math.cos(t * 0.7) * 15;
          const roll = Math.sin(t * 0.5) * 15;
          // 标准命名
          internal.coreModel.setParameterValueById("ParamAngleX", yaw);
          internal.coreModel.setParameterValueById("ParamAngleY", pitch);
          internal.coreModel.setParameterValueById("ParamAngleZ", roll);
          // saba1B 备选: 多层 angle 参数 (Master/Sub)
          internal.coreModel.setParameterValueById("ParamAngleMX", yaw);
          internal.coreModel.setParameterValueById("ParamAngleMY", pitch);
          internal.coreModel.setParameterValueById("ParamAngleMZ", roll);
          internal.coreModel.setParameterValueById("ParamAngleSX", yaw);
          internal.coreModel.setParameterValueById("ParamAngleSY", pitch);
          internal.coreModel.setParameterValueById("ParamAngleSZ", roll);
        }
      };
      internal.on("beforeModelUpdate", handler);
      this.beforeUpdateHandler = handler;

      console.log(
        `[live2d] vtube 配置就绪: ${config.mappings.length} mapping, ${config.hotkeys.length} hotkey, handler 已挂 beforeModelUpdate`
      );

      // 推送 hotkeys 给 React (UI 渲染按钮)
      this.onHotkeysReady?.(config.hotkeys);
    }

    this._ready = true;
  }

  /** Compositor 把 face tracker 的最新 inputs 推过来. */
  onTrackingInputs(inputs: TrackingInputs): void {
    if (!this.didLogFirstInputs) {
      this.didLogFirstInputs = true;
      console.log("[live2d] ✓ 首次收到 tracking inputs", {
        applierExists: !!this.applier,
        handlerRegistered: !!this.beforeUpdateHandler,
        sampleKeys: Object.keys(inputs).slice(0, 5),
      });
    }
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
