import type { AiAudienceIntensity } from "./settings";
import type { AiAudienceContextEvent } from "./context";

const TICK_DELAY_RANGES_MS: Record<AiAudienceIntensity, [number, number]> = {
  low: [45_000, 90_000],
  medium: [35_000, 75_000],
  high: [25_000, 60_000],
};

export function pickAiAudienceTickDelayMs(
  intensity: AiAudienceIntensity = "medium",
  randomValue: number,
) {
  const [min, max] = TICK_DELAY_RANGES_MS[intensity] ?? TICK_DELAY_RANGES_MS.medium;
  const clamped = Math.min(Math.max(randomValue, 0), 1);
  return Math.round(min + (max - min) * clamped);
}

export async function captureAiAudienceMediaAndTick(input: {
  roomSlug: string;
  videoElement: HTMLVideoElement;
  captureScreenshot: (video: HTMLVideoElement) => string | null;
  captureVideoClip: (video: HTMLVideoElement) => Promise<string | null>;
  mirrorContextEvent: (event: AiAudienceContextEvent) => Promise<unknown>;
  triggerTick: (roomSlug: string) => Promise<unknown>;
  now?: () => number;
}) {
  const now = input.now ?? Date.now;
  const screenshot = input.captureScreenshot(input.videoElement);
  if (screenshot) {
    await input.mirrorContextEvent({
      roomSlug: input.roomSlug,
      kind: "screenshot",
      url: screenshot,
      capturedAt: now(),
    });
  }

  const clip = await input.captureVideoClip(input.videoElement);
  if (clip) {
    await input.mirrorContextEvent({
      roomSlug: input.roomSlug,
      kind: "video_clip",
      url: clip,
      capturedAt: now(),
    });
  }

  await input.triggerTick(input.roomSlug);
}
