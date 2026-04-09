import { describe, expect, it, vi } from "vitest";

import {
  InMemoryUsageRecorder,
  SupabaseUsageRecorder,
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

describe("SupabaseUsageRecorder", () => {
  it("persists usage events through Supabase REST and aggregates persisted rows", async () => {
    vi.spyOn(console, "info").mockImplementation(() => undefined);
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response(null, { status: 201 }))
      .mockResolvedValueOnce(
        Response.json([
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
            prompt_tokens: 1000,
            completion_tokens: 80,
            total_tokens: 1080,
            cached_tokens: 50,
            cache_write_tokens: 0,
            audio_tokens: 0,
            reasoning_tokens: 12,
            cost: "0.00074",
            usage: {
              prompt_tokens: 1000,
              completion_tokens: 80,
              total_tokens: 1080,
              cost: 0.00074,
            },
          },
        ]),
      );

    const recorder = new SupabaseUsageRecorder({
      supabaseUrl: "https://project.supabase.co",
      serviceRoleKey: "service-role",
      fetchImpl: fetchMock as typeof fetch,
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
      usage: {
        prompt_tokens: 1000,
        completion_tokens: 80,
        total_tokens: 1080,
        cost: 0.00074,
        prompt_tokens_details: {
          cached_tokens: 50,
        },
        completion_tokens_details: {
          reasoning_tokens: 12,
        },
      },
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "https://project.supabase.co/rest/v1/ai_audience_usage_events",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          apikey: "service-role",
          authorization: "Bearer service-role",
          prefer: "return=minimal",
        }),
        body: expect.stringContaining('"room_slug":"demo-room"'),
      }),
    );

    const summary = await recorder.summary();

    expect(fetchMock).toHaveBeenLastCalledWith(
      "https://project.supabase.co/rest/v1/ai_audience_usage_events?select=*&order=created_at.desc&limit=5000",
      expect.objectContaining({
        method: "GET",
        headers: expect.objectContaining({
          apikey: "service-role",
          authorization: "Bearer service-role",
        }),
      }),
    );
    expect(summary.totals).toMatchObject({
      requests: 1,
      totalCost: 0.00074,
      totalTokens: 1080,
      cachedTokens: 50,
      reasoningTokens: 12,
      videoRequests: 1,
    });
    expect(summary.byPersona).toEqual([
      expect.objectContaining({
        key: "curious",
        totalCost: 0.00074,
      }),
    ]);
  });
});
