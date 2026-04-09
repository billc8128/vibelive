import type { TransformBox } from "../sources";
import type { SourceRenderer } from "./types";

// ────────────────────────────────────────────────────────────────
// Camera source renderer.
//
// 通过 getUserMedia 获取 webcam stream, 挂到一个 detached HTMLVideoElement
// 上, 每帧 drawImage 到合成 canvas. 这是浏览器把 MediaStream 接入 canvas
// 的标准做法 — 没有更快的路径, 因为 canvas 2D 只接受 HTMLImageElement /
// HTMLVideoElement / HTMLCanvasElement / ImageBitmap 作为 drawImage 源.
//
// 关于性能:
//   - 浏览器内部会把 video 帧以硬件加速方式交给 canvas, drawImage 本身
//     非常快 (几个 ms), 所以在 1080p 60fps 下完全跑得起来.
//   - 如果将来要 OffscreenCanvas + WebCodecs, 就换实现, 接口不变.
// ────────────────────────────────────────────────────────────────

export class CameraRenderer implements SourceRenderer {
  private video: HTMLVideoElement | null = null;
  private stream: MediaStream | null = null;
  private _ready = false;
  private deviceId?: string;

  constructor(opts: { deviceId?: string } = {}) {
    this.deviceId = opts.deviceId;
  }

  get ready() {
    return this._ready;
  }

  async init(): Promise<void> {
    if (typeof navigator === "undefined" || !navigator.mediaDevices) {
      throw new Error("navigator.mediaDevices 不可用 (非浏览器环境?)");
    }

    const constraints: MediaStreamConstraints = {
      video: this.deviceId
        ? { deviceId: { exact: this.deviceId } }
        : { width: { ideal: 1280 }, height: { ideal: 720 } },
      audio: false, // 音频走 LiveKit mic track, 不经过 compositor
    };

    this.stream = await navigator.mediaDevices.getUserMedia(constraints);

    // detached <video>, 不挂到 DOM, 仅用作 drawImage 源
    const video = document.createElement("video");
    video.autoplay = true;
    video.muted = true;
    video.playsInline = true;
    video.srcObject = this.stream;

    // 等待第一帧元数据可用, 否则 drawImage 会画出黑屏
    await new Promise<void>((resolve, reject) => {
      const onReady = () => {
        video.removeEventListener("loadedmetadata", onReady);
        video.removeEventListener("error", onError);
        resolve();
      };
      const onError = () => {
        video.removeEventListener("loadedmetadata", onReady);
        video.removeEventListener("error", onError);
        reject(new Error("camera video element failed to load"));
      };
      video.addEventListener("loadedmetadata", onReady);
      video.addEventListener("error", onError);
    });

    await video.play().catch(() => {
      // play() 在某些浏览器 autoplay policy 下返回 rejected promise, 但
      // 因为 muted+playsInline, 实际已经开始播, 可以忽略
    });

    this.video = video;
    this._ready = true;
  }

  draw(ctx: CanvasRenderingContext2D, box: TransformBox): void {
    if (!this._ready || !this.video) return;
    if (this.video.videoWidth === 0 || this.video.videoHeight === 0) return;

    // "cover" 模式: 保持视频比例填满 box, 多余部分裁掉
    const videoAspect = this.video.videoWidth / this.video.videoHeight;
    const boxAspect = box.width / box.height;
    let sx = 0, sy = 0, sw = this.video.videoWidth, sh = this.video.videoHeight;
    if (videoAspect > boxAspect) {
      // video 比 box 更宽 → 裁左右
      sw = this.video.videoHeight * boxAspect;
      sx = (this.video.videoWidth - sw) / 2;
    } else {
      // video 比 box 更高 → 裁上下
      sh = this.video.videoWidth / boxAspect;
      sy = (this.video.videoHeight - sh) / 2;
    }

    ctx.drawImage(this.video, sx, sy, sw, sh, box.x, box.y, box.width, box.height);
  }

  dispose(): void {
    if (this.stream) {
      this.stream.getTracks().forEach((t) => t.stop());
      this.stream = null;
    }
    if (this.video) {
      this.video.srcObject = null;
      this.video = null;
    }
    this._ready = false;
  }
}
