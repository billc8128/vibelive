import { describe, expect, it, vi } from "vitest";

import {
  captureAiAudienceMediaAndTick,
  pickAiAudienceTickDelayMs,
} from "./runtime-loop";

describe("pickAiAudienceTickDelayMs", () => {
  it("matches the client-driven tick jitter ranges", () => {
    expect(pickAiAudienceTickDelayMs("low", 0)).toBe(45_000);
    expect(pickAiAudienceTickDelayMs("low", 1)).toBe(90_000);
    expect(pickAiAudienceTickDelayMs("medium", 0)).toBe(35_000);
    expect(pickAiAudienceTickDelayMs("medium", 1)).toBe(75_000);
    expect(pickAiAudienceTickDelayMs("high", 0)).toBe(25_000);
    expect(pickAiAudienceTickDelayMs("high", 1)).toBe(60_000);
  });
});

describe("captureAiAudienceMediaAndTick", () => {
  it("captures screenshot and video before triggering the orchestrator tick", async () => {
    const steps: string[] = [];

    await captureAiAudienceMediaAndTick({
      roomSlug: "demo-room",
      videoElement: {} as HTMLVideoElement,
      captureScreenshot: () => {
        steps.push("capture-screenshot");
        return "data:image/jpeg;base64,shot";
      },
      mirrorContextEvent: async (event) => {
        steps.push(`mirror-${event.kind}`);
      },
      captureVideoClip: async () => {
        steps.push("capture-video");
        return "data:video/webm;base64,clip";
      },
      triggerTick: async () => {
        steps.push("tick");
      },
      now: () => 123,
    });

    expect(steps).toEqual([
      "capture-screenshot",
      "mirror-screenshot",
      "capture-video",
      "mirror-video_clip",
      "tick",
    ]);
  });

  it("still triggers the tick when video capture fails", async () => {
    const steps: string[] = [];

    await captureAiAudienceMediaAndTick({
      roomSlug: "demo-room",
      videoElement: {} as HTMLVideoElement,
      captureScreenshot: () => "data:image/jpeg;base64,shot",
      mirrorContextEvent: async (event) => {
        steps.push(`mirror-${event.kind}`);
      },
      captureVideoClip: async () => null,
      triggerTick: async () => {
        steps.push("tick");
      },
      now: () => 123,
    });

    expect(steps).toEqual(["mirror-screenshot", "tick"]);
  });
});
