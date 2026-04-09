// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  capturePreviewScreenshot,
  capturePreviewVideoClip,
} from "./screenshot";

describe("capturePreviewScreenshot", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("captures a downscaled jpeg data URL from the preview element", () => {
    const drawImage = vi.fn();
    const getContext = vi.fn().mockReturnValue({ drawImage });
    const toDataURL = vi
      .fn()
      .mockReturnValue("data:image/jpeg;base64,preview-frame");
    const canvas = {
      width: 0,
      height: 0,
      getContext,
      toDataURL,
    } as unknown as HTMLCanvasElement;

    const originalCreateElement = document.createElement.bind(document);
    vi.spyOn(document, "createElement").mockImplementation((tagName) => {
      if (tagName === "canvas") {
        return canvas;
      }

      return originalCreateElement(tagName);
    });

    const video = document.createElement("video");
    Object.defineProperty(video, "videoWidth", { value: 1920 });
    Object.defineProperty(video, "videoHeight", { value: 1080 });

    const screenshot = capturePreviewScreenshot(video, {
      maxWidth: 640,
      quality: 0.7,
    });

    expect(screenshot).toBe("data:image/jpeg;base64,preview-frame");
    expect(canvas.width).toBe(640);
    expect(canvas.height).toBe(360);
    expect(drawImage).toHaveBeenCalledWith(video, 0, 0, 640, 360);
    expect(toDataURL).toHaveBeenCalledWith("image/jpeg", 0.7);
  });

  it("returns null when the preview element has no frame yet", () => {
    const video = document.createElement("video");
    Object.defineProperty(video, "videoWidth", { value: 0 });
    Object.defineProperty(video, "videoHeight", { value: 0 });

    expect(capturePreviewScreenshot(video)).toBeNull();
  });

  it("records a short webm data URL from the preview element", async () => {
    vi.useFakeTimers();

    class FakeMediaRecorder {
      static isTypeSupported = vi.fn().mockReturnValue(true);

      state: RecordingState = "inactive";
      mimeType = "video/webm";
      ondataavailable: ((event: BlobEvent) => void) | null = null;
      onstop: (() => void) | null = null;

      start() {
        this.state = "recording";
      }

      stop() {
        this.state = "inactive";
        this.ondataavailable?.({
          data: new Blob(["clip"], { type: "video/webm" }),
        } as BlobEvent);
        this.onstop?.();
      }
    }

    class FakeFileReader {
      result: string | null = null;
      onloadend: (() => void) | null = null;
      onerror: (() => void) | null = null;

      readAsDataURL() {
        this.result = "data:video/webm;base64,Y2xpcA==";
        this.onloadend?.();
      }
    }

    vi.stubGlobal("MediaRecorder", FakeMediaRecorder);
    vi.stubGlobal("FileReader", FakeFileReader);
    const video = document.createElement("video");
    Object.defineProperty(video, "captureStream", {
      value: () => ({
        getVideoTracks: () => [{ kind: "video" }],
      }),
    });

    const promise = capturePreviewVideoClip(video, {
      durationMs: 10,
      mimeType: "video/webm",
    });

    await vi.advanceTimersByTimeAsync(10);
    const clip = await promise;

    expect(clip).toMatch(/^data:video\/webm;base64,/);
    expect(FakeMediaRecorder.isTypeSupported).toHaveBeenCalledWith("video/webm");
  });
});
