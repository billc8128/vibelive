import { afterEach, describe, expect, it, vi } from "vitest";

import {
  buildSignedOrchestratorHeaders,
  getAiAudienceUsageSummary,
  sendAiAudienceContextEvent,
  tickAiAudienceRuntime,
} from "./client";

describe("buildSignedOrchestratorHeaders", () => {
  it("includes the shared secret header", () => {
    expect(buildSignedOrchestratorHeaders("test")["x-orchestrator-secret"]).toBe(
      "test",
    );
  });
});

describe("sendAiAudienceContextEvent", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("posts mirrored chat events to the orchestrator context endpoint", async () => {
    vi.stubEnv("AI_AUDIENCE_ORCHESTRATOR_URL", "https://orchestrator.example");
    vi.stubEnv("AI_AUDIENCE_ORCHESTRATOR_SECRET", "shared-secret");
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response(null, { status: 202 }));

    await sendAiAudienceContextEvent({
      roomSlug: "demo-room",
      kind: "chat_message",
      user: "viewer-1",
      text: "Can you split auth first?",
      bot: false,
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "https://orchestrator.example/runtime/context",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          "x-orchestrator-secret": "shared-secret",
          "content-type": "application/json",
        }),
        body: JSON.stringify({
          roomSlug: "demo-room",
          kind: "chat_message",
          user: "viewer-1",
          text: "Can you split auth first?",
          bot: false,
        }),
      }),
    );
  });

  it("posts mirrored video clip events to the orchestrator context endpoint", async () => {
    vi.stubEnv("AI_AUDIENCE_ORCHESTRATOR_URL", "https://orchestrator.example");
    vi.stubEnv("AI_AUDIENCE_ORCHESTRATOR_SECRET", "shared-secret");
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response(null, { status: 202 }));

    await sendAiAudienceContextEvent({
      roomSlug: "demo-room",
      kind: "video_clip",
      url: "data:video/webm;base64,clip",
      capturedAt: 1_744_163_200_000,
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "https://orchestrator.example/runtime/context",
      expect.objectContaining({
        body: JSON.stringify({
          roomSlug: "demo-room",
          kind: "video_clip",
          url: "data:video/webm;base64,clip",
          capturedAt: 1_744_163_200_000,
        }),
      }),
    );
  });
});

describe("tickAiAudienceRuntime", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("posts a runtime tick request to the orchestrator", async () => {
    vi.stubEnv("AI_AUDIENCE_ORCHESTRATOR_URL", "https://orchestrator.example");
    vi.stubEnv("AI_AUDIENCE_ORCHESTRATOR_SECRET", "shared-secret");
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response(null, { status: 202 }));

    await tickAiAudienceRuntime({
      roomSlug: "demo-room",
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "https://orchestrator.example/runtime/tick",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          "x-orchestrator-secret": "shared-secret",
          "content-type": "application/json",
        }),
        body: JSON.stringify({
          roomSlug: "demo-room",
        }),
      }),
    );
  });
});

describe("getAiAudienceUsageSummary", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("fetches aggregated usage from the orchestrator usage endpoint", async () => {
    vi.stubEnv("AI_AUDIENCE_ORCHESTRATOR_URL", "https://orchestrator.example");
    vi.stubEnv("AI_AUDIENCE_ORCHESTRATOR_SECRET", "shared-secret");
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      Response.json({
        totals: { requests: 1, totalCost: 0.00065 },
        byOperation: [],
        byModel: [],
        byPersona: [],
        byRoom: [],
        recentEvents: [],
      }),
    );

    const summary = await getAiAudienceUsageSummary();

    expect(fetchMock).toHaveBeenCalledWith(
      "https://orchestrator.example/runtime/usage",
      expect.objectContaining({
        method: "GET",
        headers: expect.objectContaining({
          "x-orchestrator-secret": "shared-secret",
        }),
        cache: "no-store",
      }),
    );
    expect(summary?.totals.totalCost).toBe(0.00065);
  });
});
