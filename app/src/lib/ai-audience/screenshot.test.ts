// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";

import { capturePreviewScreenshot } from "./screenshot";

describe("capturePreviewScreenshot", () => {
  afterEach(() => {
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
});
