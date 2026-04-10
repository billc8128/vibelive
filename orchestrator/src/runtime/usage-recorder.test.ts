import { describe, expect, it, vi } from "vitest";

import {
  InMemoryUsageRecorder,
  PostgresUsageRecorder,
} from "./usage-recorder.js";

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
      attachedImage: false,
      usedScreenshotSummary: true,
      usage: {
        prompt_tokens: 1200,
        completion_tokens: 50,
        total_tokens: 1250,
        cost: 0.00075,
        prompt_tokens_details: {
          video_tokens: 120,
        },
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
      attachedImage: true,
      usedScreenshotSummary: false,
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
      imageAttachments: 1,
      screenshotSummaryBackedRequests: 1,
      videoTokens: 120,
    });
    expect(summary.recentEvents[0]).toMatchObject({
      operation: "screenshot_summary",
      attachedImage: true,
      usedScreenshotSummary: false,
    });
    expect(summary.recentEvents[1]).toMatchObject({
      operation: "agent_decide",
      attachedImage: false,
      usedScreenshotSummary: true,
      usage: {
        prompt_tokens_details: {
          video_tokens: 120,
        },
      },
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

describe("PostgresUsageRecorder", () => {
  it("creates the usage table, persists usage events, and aggregates persisted rows", async () => {
    vi.spyOn(console, "info").mockImplementation(() => undefined);
    const queryMock = vi
      .fn()
      .mockResolvedValueOnce({ rows: [], rowCount: null })
      .mockResolvedValueOnce({ rows: [], rowCount: 1 })
      .mockResolvedValueOnce({
        rows: [
          {
            id: "11111111-1111-4111-8111-111111111111",
            created_at: "2026-04-09T07:00:00.000Z",
            room_slug: "demo-room",
            channel_id: "channel-1",
            operation: "agent_decide",
            persona_key: "curious",
            model_provider: "openrouter",
            model_name: "google/gemini-3-flash-preview",
            decision: "speak",
            has_screenshot: true,
            has_video: true,
            attached_image: false,
            used_screenshot_summary: true,
            prompt_tokens: 1000,
            completion_tokens: 80,
            total_tokens: 1080,
            cached_tokens: 50,
            cache_write_tokens: 0,
            audio_tokens: 0,
            video_tokens: 90,
            reasoning_tokens: 12,
            cost: "0.00074",
            usage: {
              prompt_tokens: 1000,
              completion_tokens: 80,
              total_tokens: 1080,
              cost: 0.00074,
              prompt_tokens_details: {
                video_tokens: 90,
              },
            },
          },
        ],
        rowCount: 1,
      });

    const recorder = new PostgresUsageRecorder({
      pool: { query: queryMock },
      now: () => 1_765_000_000_000,
    });

    await recorder.record({
      roomSlug: "demo-room",
      channelId: "channel-1",
      operation: "agent_decide",
      personaKey: "curious",
      modelProvider: "openrouter",
      modelName: "google/gemini-3-flash-preview",
      decision: "speak",
      hasScreenshot: true,
      hasVideo: true,
      attachedImage: false,
      usedScreenshotSummary: true,
      usage: {
        prompt_tokens: 1000,
        completion_tokens: 80,
        total_tokens: 1080,
        cost: 0.00074,
        prompt_tokens_details: {
          cached_tokens: 50,
          video_tokens: 90,
        },
        completion_tokens_details: {
          reasoning_tokens: 12,
        },
      },
    });

    expect(queryMock).toHaveBeenNthCalledWith(
      1,
      expect.stringContaining("create table if not exists ai_audience_usage_events"),
    );
    expect(queryMock).toHaveBeenNthCalledWith(
      2,
      expect.stringContaining("insert into ai_audience_usage_events"),
      expect.arrayContaining([
        "demo-room",
        "channel-1",
        "agent_decide",
        "curious",
        "google/gemini-3-flash-preview",
        0.00074,
      ]),
    );

    const summary = await recorder.summary();

    expect(queryMock).toHaveBeenNthCalledWith(
      3,
      expect.stringContaining("from ai_audience_usage_events"),
      [5000],
    );
    expect(summary.totals).toMatchObject({
      requests: 1,
      totalCost: 0.00074,
      totalTokens: 1080,
      cachedTokens: 50,
      reasoningTokens: 12,
      videoRequests: 1,
      screenshotSummaryBackedRequests: 1,
      videoTokens: 90,
    });
    expect(summary.byPersona).toEqual([
      expect.objectContaining({
        key: "curious",
        totalCost: 0.00074,
      }),
    ]);
    expect(summary.recentEvents[0]).toMatchObject({
      attachedImage: false,
      usedScreenshotSummary: true,
      usage: {
        prompt_tokens_details: {
          video_tokens: 90,
        },
      },
    });
  });
});
