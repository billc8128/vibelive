import type { MediaCapture } from "./context-packet.js";

export class MediaSnapshotter {
  private latestScreenshot: MediaCapture | null = null;
  private latestVideoClip: MediaCapture | null = null;

  setLatestScreenshot(capture: MediaCapture | null) {
    this.latestScreenshot = capture;
  }

  setLatestVideoClip(capture: MediaCapture | null) {
    this.latestVideoClip = capture;
  }

  snapshot() {
    return {
      latestScreenshot: this.latestScreenshot,
      latestVideoClip: this.latestVideoClip,
    };
  }
}
