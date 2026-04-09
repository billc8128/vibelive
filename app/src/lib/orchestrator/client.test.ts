import { afterEach, describe, expect, it, vi } from "vitest";

import {
  buildSignedOrchestratorHeaders,
  sendAiAudienceContextEvent,
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
});
