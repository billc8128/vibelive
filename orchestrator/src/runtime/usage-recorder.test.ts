import { describe, expect, it, vi } from "vitest";

import { InMemoryUsageRecorder } from "./usage-recorder.js";

describe("InMemoryUsageRecorder", () => {
  it("aggregates cost and token usage by operation, model, persona, and room", () => {
    vi.spyOn(console, "info").mockImplementation(() => undefined);
    const recorder = new InMemoryUsageRecorder(() => 1_744_163_200_000);

    recorder.record({
      roomSlug: "demo-room",
      channelId: "channel-1",
      operation: "agent_decide",
      personaKey: "curious",
      modelProvider: "openrouter",
      modelName: "google/gemini-3-flash-preview",
      decision: "speak",
      hasScreenshot: true,
      hasVideo: true,
      usage: {
        prompt_tokens: 1200,
        completion_tokens: 50,
        total_tokens: 1250,
        cost: 0.00075,
      },
    });
    recorder.record({
      roomSlug: "demo-room",
      operation: "screenshot_summary",
      modelProvider: "openrouter",
      modelName: "google/gemini-3-flash-preview",
      decision: "summary",
      hasScreenshot: true,
      hasVideo: false,
      usage: {
        prompt_tokens: 800,
        completion_tokens: 100,
        total_tokens: 900,
        cost: 0.0007,
        prompt_tokens_details: {
          cached_tokens: 10,
          audio_tokens: 0,
        },
        completion_tokens_details: {
          reasoning_tokens: 3,
        },
      },
    });

    const summary = recorder.summary();

    expect(summary.totals).toMatchObject({
      requests: 2,
      totalCost: 0.00145,
      promptTokens: 2000,
      completionTokens: 150,
      totalTokens: 2150,
      cachedTokens: 10,
      audioTokens: 0,
      reasoningTokens: 3,
      videoRequests: 1,
      screenshotRequests: 2,
    });
    expect(summary.byOperation).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          key: "agent_decide",
          requests: 1,
          totalCost: 0.00075,
        }),
        expect.objectContaining({
          key: "screenshot_summary",
          requests: 1,
          totalCost: 0.0007,
        }),
      ]),
    );
    expect(summary.byPersona).toEqual([
      expect.objectContaining({
        key: "curious",
        requests: 1,
        totalCost: 0.00075,
      }),
    ]);
    expect(summary.recentEvents).toHaveLength(2);
  });
});
