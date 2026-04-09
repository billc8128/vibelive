"use client";

import {
  FaceLandmarker,
  FilesetResolver,
  type FaceLandmarkerResult,
  type NormalizedLandmark,
} from "@mediapipe/tasks-vision";
import type { TrackingInputs } from "./vtube-config";
import { studioConfig } from "./studio-config";

/**
 * Live snapshot — face tracker 每帧更新, UI (preview modal) 可以
 * 直接读 faceTracker.snapshot 在 RAF 循环里画 landmarks.
 *
 * 不走 listener 是因为 preview 只在用户手动打开 modal 时存在,
 * 用 polling 比 event subscription 更简单 (不需要 unsubscribe).
 */
export interface FaceTrackerSnapshot {
  /** 478 个 face landmarks (含 iris), normalized [0,1] */
  landmarks: NormalizedLandmark[];
  /** 实时 FPS, 1 秒一次刷新 */
  fps: number;
  /** 是否检测到 face (landmarks.length > 0) */
  hasDetection: boolean;
}

// ────────────────────────────────────────────────────────────────
// Singleton MediaPipe FaceLandmarker → VTube Studio tracking inputs.
//
// 一个 webcam, 一个 landmarker, 多个 listener (e.g. 多个 Live2DRenderer
// 共用同一个追踪源). 单例避免每个 source 都开一个独立的摄像头.
//
// 输出"VTS 命名"的字段 (FaceAngleX/Y/Z, EyeOpenLeft/Right, MouthOpen,
// MouthSmile, ...). 这样 .vtube.json 里写好的 mapping 直接拿来用,
// renderer 不需要知道 mediapipe 的 blendshape 命名.
//
// 注意点:
//   - WASM 走 jsdelivr CDN — npm 包里有 wasm/ 目录, 但 Next.js 不直接
//     拷贝到 public/, 用 CDN 最省事 (跟 Cubism Core 一样的策略).
//   - GPU delegate 在 Mac/Win Chrome 都跑得动. 失败 fallback CPU.
//   - detectForVideo 用 video element 当源, 一个隐藏 <video>挂到 DOM
//     外, srcObject 是 getUserMedia 的 MediaStream.
// ────────────────────────────────────────────────────────────────

const WASM_BASE =
  "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.34/wasm";
const MODEL_URL =
  "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task";

export type TrackingListener = (inputs: TrackingInputs) => void;

class FaceTrackerImpl {
  private landmarker: FaceLandmarker | null = null;
  private video: HTMLVideoElement | null = null;
  private stream: MediaStream | null = null;
  private rafId: number | null = null;
  private listeners = new Set<TrackingListener>();
  private starting: Promise<void> | null = null;
  private _running = false;
  private _error: Error | null = null;
  // 一次性 log 标记 — 帮诊断 detect 是不是真的在跑 (用户报"摄像头亮但模型不动"用)
  private didLogFirstDetect = false;
  private didLogFirstBroadcast = false;
  // 周期性 debug log: 每隔 N 帧打印一次完整矩阵 + 解出来的 yaw/pitch/roll,
  // 帮用户在头部跟随出问题时直接看 console 数值. 60 帧 ≈ 1 秒.
  private debugFrameCounter = 0;
  // Calibration baseline — 用户点"校准"按钮时, 累积 N 帧 raw 数据求
  // 平均作为 baseline. 单帧 snapshot 容易踩到 blink/说话/抖动的瞬间,
  // 多帧平均把 MediaPipe 的 frame-to-frame jitter 压下去.
  private lastCalibVersion = 0;
  private baseYaw = 0;
  private basePitch = 0;
  private baseRoll = 0;
  // 全 blendshapes baseline — eye blink/look, brow, mouth, jaw 都用这个减.
  // 不同人光线 / 脸型, raw blendshape 在静态时也有非零基线.
  private baseBlendshapes: Record<string, number> = {};
  // 校准累积 buffer — 校准触发后这些字段累积 N 帧, 然后求平均
  private calibFramesNeeded = 0; // > 0 表示校准进行中, 0 表示空闲
  private calibSumYaw = 0;
  private calibSumPitch = 0;
  private calibSumRoll = 0;
  private calibSumBlendshapes: Record<string, number> = {};
  private static CALIB_FRAMES = 30; // ≈ 0.5 秒 @ 60fps
  // Snapshot for preview UI (FPS + landmarks)
  private _snapshot: FaceTrackerSnapshot = {
    landmarks: [],
    fps: 0,
    hasDetection: false,
  };
  private fpsFrameCount = 0;
  private fpsLastTime = 0;
  private currentFps = 0;

  /** UI preview 用 — 直接读 snapshot, RAF 循环里轮询. */
  get snapshot(): FaceTrackerSnapshot {
    return this._snapshot;
  }

  get running(): boolean {
    return this._running;
  }

  get error(): Error | null {
    return this._error;
  }

  /** UI 查询: 校准是否还在采样中 (true) 还是空闲 (false) */
  get isCalibrating(): boolean {
    return this.calibFramesNeeded > 0;
  }

  /**
   * 启动追踪 — 加载模型 + 申请摄像头权限 + 启动检测循环.
   * 已经在跑则直接返回; 正在启动则返回同一个 promise (避免并发 start).
   */
  async start(): Promise<void> {
    if (this._running) return;
    if (this.starting) return this.starting;

    this.starting = this.doStart();
    try {
      await this.starting;
    } finally {
      this.starting = null;
    }
  }

  private async doStart(): Promise<void> {
    this._error = null;

    // 1. 加载 MediaPipe FaceLandmarker (WASM 来自 CDN, 模型来自 google storage)
    let landmarker: FaceLandmarker;
    try {
      const fileset = await FilesetResolver.forVisionTasks(WASM_BASE);
      landmarker = await FaceLandmarker.createFromOptions(fileset, {
        baseOptions: {
          modelAssetPath: MODEL_URL,
          delegate: "GPU",
        },
        runningMode: "VIDEO",
        outputFaceBlendshapes: true,
        outputFacialTransformationMatrixes: true,
        numFaces: 1,
      });
    } catch (e) {
      const err = e instanceof Error ? e : new Error(String(e));
      this._error = err;
      throw err;
    }
    this.landmarker = landmarker;

    // 2. 申请摄像头 — 用低分辨率, 追踪不需要 1080p
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        video: { width: 640, height: 480, facingMode: "user" },
        audio: false,
      });
    } catch (e) {
      // 用户拒绝 / 没设备 — 释放 landmarker 然后抛
      try { landmarker.close(); } catch {}
      this.landmarker = null;
      const err = e instanceof Error ? e : new Error(String(e));
      this._error = err;
      throw err;
    }
    this.stream = stream;

    // 3. 隐藏 <video> 当输入源, 不挂 DOM (detectForVideo 接受任何 video)
    const video = document.createElement("video");
    video.srcObject = stream;
    video.muted = true;
    video.playsInline = true;
    try {
      await video.play();
    } catch {
      // play() 在某些浏览器里需要 user gesture, 但我们的 toggle 按钮就是
      // 一个 user gesture, 这里忽略偶发异常
    }
    this.video = video;

    // 4. 启动循环
    this._running = true;
    this.loop();
  }

  stop(): void {
    this._running = false;
    if (this.rafId !== null) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
    if (this.video) {
      try { this.video.pause(); } catch {}
      this.video.srcObject = null;
      this.video = null;
    }
    if (this.stream) {
      this.stream.getTracks().forEach((t) => t.stop());
      this.stream = null;
    }
    if (this.landmarker) {
      try { this.landmarker.close(); } catch {}
      this.landmarker = null;
    }
  }

  /** 订阅追踪事件, 返回 unsubscribe 函数. */
  subscribe(fn: TrackingListener): () => void {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  }

  // ────────────────────────────────────────────────────────────────
  // 检测循环 — 每帧 detectForVideo, 转换结果广播
  // ────────────────────────────────────────────────────────────────

  private loop = (): void => {
    if (!this._running || !this.landmarker || !this.video) return;

    if (this.video.readyState >= 2 /* HAVE_CURRENT_DATA */) {
      try {
        const result = this.landmarker.detectForVideo(this.video, performance.now());

        // FPS 计数 — 每秒一次更新 currentFps
        this.fpsFrameCount++;
        const fpsNow = performance.now();
        if (fpsNow - this.fpsLastTime >= 1000) {
          this.currentFps =
            this.fpsLastTime === 0
              ? 0
              : Math.round((this.fpsFrameCount * 1000) / (fpsNow - this.fpsLastTime));
          this.fpsFrameCount = 0;
          this.fpsLastTime = fpsNow;
        }

        // 更新 snapshot 给 preview UI 用
        this._snapshot = {
          landmarks: result.faceLandmarks?.[0] ?? [],
          fps: this.currentFps,
          hasDetection: (result.faceLandmarks?.length ?? 0) > 0,
        };

        if (!this.didLogFirstDetect) {
          this.didLogFirstDetect = true;
          console.log("[face-tracker] ✓ 首次 detect 返回", {
            hasMatrices: !!result.facialTransformationMatrixes?.length,
            hasBlendshapes: !!result.faceBlendshapes?.length,
            blendshapeCount: result.faceBlendshapes?.[0]?.categories?.length ?? 0,
            landmarkCount: result.faceLandmarks?.[0]?.length ?? 0,
          });
        }
        const inputs = this.resultToInputs(result);
        if (inputs) {
          if (!this.didLogFirstBroadcast) {
            this.didLogFirstBroadcast = true;
            console.log("[face-tracker] ✓ 首次广播 inputs 给 listener", {
              listenerCount: this.listeners.size,
              inputs,
            });
          }
          this.listeners.forEach((fn) => {
            try { fn(inputs); } catch {}
          });
        }
      } catch (e) {
        // detect 偶发异常不应该 kill 循环 — 输出一次就行
        if (!this._error) {
          console.warn("[face-tracker] detect failed:", e);
        }
      }
    }

    this.rafId = requestAnimationFrame(this.loop);
  };

  /**
   * MediaPipe 结果 → VTS-命名的 inputs.
   *
   * Head pose 取自 facialTransformationMatrix (column-major 4x4).
   * Eye/mouth/smile 取自 blendshapes (52 个 ARKit-style 类别).
   *
   * 关键: 我们同时输出多个 alias 字段 (e.g. MouthOpen 和
   * VoiceVolumePlusMouthOpen 都给 jawOpen) — 因为不同 .vtube.json
   * 把嘴接到不同的 VTS input 名, 多输出一份让兼容面更广.
   */
  private resultToInputs(result: FaceLandmarkerResult): TrackingInputs | null {
    const matrices = result.facialTransformationMatrixes;
    const blendshapes = result.faceBlendshapes;
    if (!matrices?.length || !blendshapes?.length) return null;

    // ── Head pose ────────────────────────────────────────────────
    // facialTransformationMatrixes[0].data 是 16 个 float, MediaPipe 内部
    // 是 Eigen column-major 格式: m[col*4 + row].
    //   m02 = m[8]  (col 2, row 0)
    //   m12 = m[9]  (col 2, row 1)
    //   m22 = m[10] (col 2, row 2)
    //   m10 = m[1]  (col 0, row 1)
    //   m11 = m[5]  (col 1, row 1)
    //
    // YXZ Euler 解码 (R = Ry·Rx·Rz) — 用矩阵第 3 列(局部 Z 轴在旋转后
    // 的位置)提取 pitch + yaw, 第 1 列前两行提取 roll:
    //
    //   m02 = sin(yaw)·cos(pitch)
    //   m12 = -sin(pitch)
    //   m22 = cos(yaw)·cos(pitch)
    //   m10 = cos(pitch)·sin(roll)
    //   m11 = cos(pitch)·cos(roll)
    //
    //   → pitch = asin(-m12)
    //   → yaw   = atan2(m02, m22)
    //   → roll  = atan2(m10, m11)
    //
    // ⚠ 历史 bug: 之前用 m21/m20/m01 提取, 这些元素是
    //   m21 = sy·sr + cy·sp·cr  (YXZ 下不是干净的角度指示)
    //   小 pitch + 小 roll 时 m21 ≈ 0, 解出来的 pitch 永远 ≈ 0,
    //   头部完全不动, 模型只剩 idle breath 看起来像"随机摆动".
    const m = matrices[0].data;
    const m02 = m[8];
    const m12 = m[9];
    const m22 = m[10];
    const m10 = m[1];
    const m11 = m[5];

    const pitch = Math.asin(-Math.max(-1, Math.min(1, m12)));
    const yaw = Math.atan2(m02, m22);
    const roll = Math.atan2(m10, m11);
    const RAD2DEG = 180 / Math.PI;

    // ── Calibration baseline (多帧平均) ──────────────────────────
    // 用户点"校准"按钮 (calibrationVersion 自增) → 进入采样模式,
    // 累积 CALIB_FRAMES 帧数据, 求平均后更新 baseline. 多帧平均抵消
    // MediaPipe ~10% 的 frame-to-frame jitter, 也能 dilute 用户校准
    // 瞬间的 blink / 说话 / 微动的影响.
    if (studioConfig.calibrationVersion !== this.lastCalibVersion) {
      // 新校准请求 — 重置 buffer 进入采样模式
      this.lastCalibVersion = studioConfig.calibrationVersion;
      this.calibFramesNeeded = FaceTrackerImpl.CALIB_FRAMES;
      this.calibSumYaw = 0;
      this.calibSumPitch = 0;
      this.calibSumRoll = 0;
      this.calibSumBlendshapes = {};
      console.log(
        `[face-tracker] 开始校准 — 采样 ${FaceTrackerImpl.CALIB_FRAMES} 帧 (~0.5 秒)`
      );
    }
    if (this.calibFramesNeeded > 0) {
      // 累积当前帧数据
      this.calibSumYaw += yaw;
      this.calibSumPitch += pitch;
      this.calibSumRoll += roll;
      for (const c of blendshapes[0].categories) {
        if (c.categoryName) {
          this.calibSumBlendshapes[c.categoryName] =
            (this.calibSumBlendshapes[c.categoryName] ?? 0) + c.score;
        }
      }
      this.calibFramesNeeded--;
      if (this.calibFramesNeeded === 0) {
        // 采样完成 — 求平均, 写入 baseline
        const N = FaceTrackerImpl.CALIB_FRAMES;
        this.baseYaw = this.calibSumYaw / N;
        this.basePitch = this.calibSumPitch / N;
        this.baseRoll = this.calibSumRoll / N;
        this.baseBlendshapes = {};
        for (const k of Object.keys(this.calibSumBlendshapes)) {
          this.baseBlendshapes[k] = this.calibSumBlendshapes[k] / N;
        }
        console.log(
          `[face-tracker] ✓ 校准完成 (${N} 帧平均) yaw=${(this.baseYaw * RAD2DEG).toFixed(1)}° pitch=${(this.basePitch * RAD2DEG).toFixed(1)}° roll=${(this.baseRoll * RAD2DEG).toFixed(1)}° blendshapes=${Object.keys(this.baseBlendshapes).length}`,
          { sampleBaselines: { jawOpen: this.baseBlendshapes.jawOpen?.toFixed(3), eyeBlinkLeft: this.baseBlendshapes.eyeBlinkLeft?.toFixed(3), eyeBlinkRight: this.baseBlendshapes.eyeBlinkRight?.toFixed(3) } }
        );
      }
    }

    // 减去 baseline → 相对偏移
    const yawRel = yaw - this.baseYaw;
    const pitchRel = pitch - this.basePitch;
    const rollRel = roll - this.baseRoll;

    // ⚙ 校准 scale: MediaPipe 物理角度太大, 跟 vtube.json 校准不匹配,
    // 缩放后再喂. 默认 0.4, 通过 studio settings UI 可调.
    const HEAD_ANGLE_SCALE = studioConfig.faceAngleScale;

    // ── 周期性诊断 log ─────────────────────────────────────────
    // 用字符串模板直接打印数值, 避免 Chrome console 把 array 折叠成
    // "Array(3)". 每秒一条, 头部跟随出问题时直接从 console 看出数值.
    this.debugFrameCounter++;
    if (this.debugFrameCounter % 60 === 0) {
      const f = (v: number) => (v ?? 0).toFixed(2).padStart(6);
      const d = (v: number) => (v * RAD2DEG).toFixed(0).padStart(4);
      // Column-major 解读 (当前的假设): m[col*4+row]
      const colYaw = Math.atan2(m[8], m[10]);
      const colPitch = Math.asin(-Math.max(-1, Math.min(1, m[9])));
      const colRoll = Math.atan2(m[1], m[5]);
      // Row-major 解读 (替代假设): m[row*4+col]
      const rowYaw = Math.atan2(m[2], m[10]);
      const rowPitch = Math.asin(-Math.max(-1, Math.min(1, m[6])));
      const rowRoll = Math.atan2(m[4], m[5]);
      console.log(
        `[ft] m=[${f(m[0])}${f(m[1])}${f(m[2])}${f(m[3])} | ${f(m[4])}${f(m[5])}${f(m[6])}${f(m[7])} | ${f(m[8])}${f(m[9])}${f(m[10])}${f(m[11])} | ${f(m[12])}${f(m[13])}${f(m[14])}${f(m[15])}] ` +
          `COL[Y${d(colYaw)} P${d(colPitch)} R${d(colRoll)}] ` +
          `ROW[Y${d(rowYaw)} P${d(rowPitch)} R${d(rowRoll)}]`
      );
    }

    // 镜像模式 — 用户做什么动作, 屏幕上模型做镜像 (符合 selfie 直觉,
    // 跟 VTube Studio 默认行为一致). 用户头倒右 → 模型头倒右 (屏幕看是
    // 模型左, 因为模型面对用户).
    //
    // 历史: 之前对 yaw 取负 → 用户报告"反" → 改正号 → 用户又报告"全部反".
    // 现在 3 个 axis 全 flip, 用户的 "反" 反过来就是对的.
    // 用 baseline 相对值 (yawRel/pitchRel/rollRel) 而不是 raw, 让校准生效.
    const faceX = -yawRel * RAD2DEG * HEAD_ANGLE_SCALE;
    const faceY = -pitchRel * RAD2DEG * HEAD_ANGLE_SCALE;
    const faceZ = rollRel * RAD2DEG * HEAD_ANGLE_SCALE;

    // ── Blendshapes (ARKit 52 类别) ──────────────────────────────
    const bs: Record<string, number> = {};
    for (const c of blendshapes[0].categories) {
      if (c.categoryName) bs[c.categoryName] = c.score;
    }

    // baseline-relative helper — (raw - baseline), 校准过后中性 = 0
    const rel = (name: string) =>
      (bs[name] ?? 0) - (this.baseBlendshapes[name] ?? 0);
    // dead-zone helper — 小于阈值的运动归零, 减少 MediaPipe blendshape
    // 之间的 cross-talk (比如睁大眼睛会副作用地让 eyeLookUp 升高)
    const dz = (v: number, threshold = 0.05) =>
      Math.abs(v) < threshold ? 0 : v;

    // EyeOpen* — VTS 的 EyeOpenRight/Left 默认范围 [0, 0.5] (1.0 = 大睁眼).
    //
    // Single-linear baseline shift (不是 piecewise!):
    //   blinkRel = (raw - baseline) * scale
    //     正 = 比中性更闭, 负 = 比中性更睁
    //   output = eyeOpenDefault - blinkRel
    //
    //   中性 (rel=0): output = eyeOpenDefault (默认 0.8)
    //   闭眼 (rel>0): output 从 default 线性下降
    //   睁更大 (rel<0): output 从 default 线性上升
    //
    // eyeOpenDefault 是真正的"基准线" — 你眼睛默认状态对应的输出数值,
    // 不是 cap. 所有变化都从这个基准线开始, 不是从 1.0 衰减.
    // clamp [0, 1] 再 * 0.5 得 VTS 输出范围 [0, 0.5].
    const blinkLRel = rel("eyeBlinkLeft") * studioConfig.eyeOpenScale;
    const blinkRRel = rel("eyeBlinkRight") * studioConfig.eyeOpenScale;
    const def = studioConfig.eyeOpenDefault;
    const eyeOpenLeft = Math.max(0, Math.min(1, def - blinkLRel)) * 0.5;
    const eyeOpenRight = Math.max(0, Math.min(1, def - blinkRRel)) * 0.5;

    // 嘴 — 用 baseline 减 + clamp >= 0. 不减 baseline 时如果用户校准
    // 时嘴微张 (MediaPipe 给 0.05-0.1 的非零基线), 静态时模型嘴会一直
    // 微张, 跟"中性"对不上.
    const jawOpen = Math.max(0, rel("jawOpen") * studioConfig.mouthOpenScale);

    // 微笑 — 取左右平均, 也用 baseline 减
    const smile = (rel("mouthSmileLeft") + rel("mouthSmileRight")) / 2;

    // 视线 — 用 ARKit 的 eyeLookIn/Out 推近似 X, Y 用 Up/Down.
    // 关键修复 (用户报"睁大眼睛眼球移动"): MediaPipe 的 eye blink 跟
    // eye look blendshapes 有 cross-talk, 眼皮位置变化会副作用地影响
    // look 判定. 用 baseline-relative + dead zone 双重抵消:
    //   - rel(): 校准时的"中性凝视"对应零位置
    //   - dz(): 小于 ~5% 的运动直接归零, 过滤噪声
    const ebs = studioConfig.eyeBallScale;
    const eyeXLeft = dz(rel("eyeLookOutLeft") - rel("eyeLookInLeft")) * ebs;
    const eyeYLeft = dz(rel("eyeLookUpLeft") - rel("eyeLookDownLeft")) * ebs;
    const eyeXRight = dz(rel("eyeLookInRight") - rel("eyeLookOutRight")) * ebs;
    const eyeYRight = dz(rel("eyeLookUpRight") - rel("eyeLookDownRight")) * ebs;

    // 眉毛 — vtube.json 4 条 mapping (左右上下 + 形状) 都用单个 "Brows"
    // input. VTS 约定中性 = 0.5, 0 = 眉毛全部下压, 1 = 全部上挑.
    // 我们用 (browOuterUp 平均 - browDown 平均), 加 0.5 平移到 [0, 1] 区间,
    // 再用 baseline + browScale 调.
    const browUpAvg =
      (rel("browOuterUpLeft") + rel("browOuterUpRight")) / 2;
    const browDownAvg = (rel("browDownLeft") + rel("browDownRight")) / 2;
    const browDelta = (browUpAvg - browDownAvg) * studioConfig.browScale;
    // 0.5 是 VTS 中性, ±0.5 是边界. clamp [0, 1].
    const brows = Math.max(0, Math.min(1, 0.5 + browDelta));

    return {
      // ── Head pose ──
      FaceAngleX: faceX,
      FaceAngleY: faceY,
      FaceAngleZ: faceZ,
      // ── Eyes ──
      EyeOpenLeft: eyeOpenLeft,
      EyeOpenRight: eyeOpenRight,
      EyeLeftX: eyeXLeft,
      EyeLeftY: eyeYLeft,
      EyeRightX: eyeXRight,
      EyeRightY: eyeYRight,
      // ── Mouth — 多个 alias 兼容不同模型配置 ──
      MouthOpen: jawOpen,
      VoiceVolume: jawOpen,
      VoiceVolumePlusMouthOpen: jawOpen,
      MouthSmile: smile,
      VoiceFrequencyPlusMouthSmile: smile,
      MouthX: smile, // 部分模型用 MouthX 控制嘴角
      // ── Brows — vtube.json 4 条 mapping 都用单个 "Brows" input ──
      Brows: brows,
    };
  }
}

export const faceTracker = new FaceTrackerImpl();
