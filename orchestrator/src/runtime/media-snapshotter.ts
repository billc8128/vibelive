import type { MediaCapture } from "./context-packet.js";
import type { ScreenshotSummary } from "./screenshot-summarizer.js";

export class MediaSnapshotter {
  private latestScreenshot: MediaCapture | null = null;
  private latestScreenshotSummary: ScreenshotSummary | null = null;
  private latestVideoClip: MediaCapture | null = null;

  setLatestScreenshot(capture: MediaCapture | null) {
    this.latestScreenshot = capture;
  }

  setLatestScreenshotSummary(summary: ScreenshotSummary | null) {
    this.latestScreenshotSummary = summary;
  }

  setLatestVideoClip(capture: MediaCapture | null) {
    this.latestVideoClip = capture;
  }

  snapshot() {
    return {
      latestScreenshot: this.latestScreenshot,
      latestScreenshotSummary: this.latestScreenshotSummary,
      latestVideoClip: this.latestVideoClip,
    };
  }
}
