import type { TransformBox } from "../sources";
import type { SourceRenderer } from "./types";

// ────────────────────────────────────────────────────────────────
// Screen share renderer.
//
// 跟 CameraRenderer 几乎一样, 区别只在 init 用 getDisplayMedia 而非
// getUserMedia, 以及处理用户主动 "停止共享" 时浏览器抛的 ended 事件.
//
// (没把两个 renderer 抽公共父类, 因为后续 Live2D / WebGL renderer 接入
//  会让任何"video-based" 抽象迅速过时. 两个 ~80 行的姐妹类比一个 200 行
//  的多态层好维护.)
// ────────────────────────────────────────────────────────────────

export class ScreenRenderer implements SourceRenderer {
  private video: HTMLVideoElement | null = null;
  private stream: MediaStream | null = null;
  private _ready = false;
  private _ended = false;

  get ready() {
    return this._ready && !this._ended;
  }

  async init(): Promise<void> {
    if (typeof navigator === "undefined" || !navigator.mediaDevices) {
      throw new Error("navigator.mediaDevices 不可用");
    }

    this.stream = await navigator.mediaDevices.getDisplayMedia({
      video: { frameRate: 30 },
      audio: false,
    });

    // 用户在浏览器原生面板点 "停止共享" 时, track 会触发 ended.
    // 这种情况下我们标记 _ended, 让 compositor 跳过这一帧, 同时
    // 调用方可以监听 onEnded 回调把这个 source 从 scene 移除.
    const videoTrack = this.stream.getVideoTracks()[0];
    if (videoTrack) {
      videoTrack.addEventListener("ended", () => {
        this._ended = true;
        this.onEnded?.();
      });
    }

    const video = document.createElement("video");
    video.autoplay = true;
    video.muted = true;
    video.playsInline = true;
    video.srcObject = this.stream;

    await new Promise<void>((resolve, reject) => {
      const onReady = () => {
        video.removeEventListener("loadedmetadata", onReady);
        video.removeEventListener("error", onError);
        resolve();
      };
      const onError = () => {
        video.removeEventListener("loadedmetadata", onReady);
        video.removeEventListener("error", onError);
        reject(new Error("screen share video failed to load"));
      };
      video.addEventListener("loadedmetadata", onReady);
      video.addEventListener("error", onError);
    });

    await video.play().catch(() => {});

    this.video = video;
    this._ready = true;
  }

  /** 调用方设置, 用户停止共享时触发. */
  onEnded?: () => void;

  draw(ctx: CanvasRenderingContext2D, box: TransformBox): void {
    if (!this.ready || !this.video) return;
    if (this.video.videoWidth === 0 || this.video.videoHeight === 0) return;

    // "contain" 模式: 屏幕共享要完整可见, 不裁切. 多余空间留黑边.
    const videoAspect = this.video.videoWidth / this.video.videoHeight;
    const boxAspect = box.width / box.height;
    let dw = box.width, dh = box.height, dx = box.x, dy = box.y;
    if (videoAspect > boxAspect) {
      dh = box.width / videoAspect;
      dy = box.y + (box.height - dh) / 2;
    } else {
      dw = box.height * videoAspect;
      dx = box.x + (box.width - dw) / 2;
    }
    ctx.drawImage(this.video, dx, dy, dw, dh);
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
