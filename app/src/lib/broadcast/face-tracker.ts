"use client";

import {
  FaceLandmarker,
  FilesetResolver,
  type FaceLandmarkerResult,
} from "@mediapipe/tasks-vision";
import type { TrackingInputs } from "./vtube-config";

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

  get running(): boolean {
    return this._running;
  }

  get error(): Error | null {
    return this._error;
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
        if (!this.didLogFirstDetect) {
          this.didLogFirstDetect = true;
          console.log("[face-tracker] ✓ 首次 detect 返回", {
            hasMatrices: !!result.facialTransformationMatrixes?.length,
            hasBlendshapes: !!result.faceBlendshapes?.length,
            blendshapeCount: result.faceBlendshapes?.[0]?.categories?.length ?? 0,
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

    // VTube Studio 习惯: 摄像头镜像 → 用户右转头, 模型也右转头.
    // MediaPipe 给的是非镜像坐标, yaw 方向跟 VTS 相反 → 取负.
    const faceX = -yaw * RAD2DEG;
    const faceY = pitch * RAD2DEG;
    const faceZ = -roll * RAD2DEG;

    // ── Blendshapes (ARKit 52 类别) ──────────────────────────────
    const bs: Record<string, number> = {};
    for (const c of blendshapes[0].categories) {
      if (c.categoryName) bs[c.categoryName] = c.score;
    }

    // EyeOpen* — VTS 的 EyeOpenRight/Left 默认范围 [0, 0.5] (1.0 = 大睁眼).
    // saba1B 的 .vtube.json 用 InputRangeUpper=0.5 → 输出 1 (全开).
    // 所以我们输出 (1 - blink) * 0.5: blink=0 (大睁) → 0.5, blink=1 (闭) → 0.
    const eyeOpenLeft = (1 - (bs.eyeBlinkLeft ?? 0)) * 0.5;
    const eyeOpenRight = (1 - (bs.eyeBlinkRight ?? 0)) * 0.5;

    // jawOpen → MouthOpen: 直接 0..1, 跟 VTS 一致
    const jawOpen = bs.jawOpen ?? 0;

    // 微笑 — 取左右平均
    const smile = ((bs.mouthSmileLeft ?? 0) + (bs.mouthSmileRight ?? 0)) / 2;

    // 视线 — 用 ARKit 的 eyeLookIn/Out 推近似 X. Y 用 Up/Down.
    // saba1B 的视线 mapping 范围是 [-1, 1].
    const eyeXLeft =
      (bs.eyeLookOutLeft ?? 0) - (bs.eyeLookInLeft ?? 0); // 左眼向左为 +
    const eyeYLeft =
      (bs.eyeLookUpLeft ?? 0) - (bs.eyeLookDownLeft ?? 0);
    const eyeXRight =
      (bs.eyeLookInRight ?? 0) - (bs.eyeLookOutRight ?? 0); // 右眼向左为 +
    const eyeYRight =
      (bs.eyeLookUpRight ?? 0) - (bs.eyeLookDownRight ?? 0);

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
    };
  }
}

export const faceTracker = new FaceTrackerImpl();
