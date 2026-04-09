import { afterEach, describe, expect, it, vi } from "vitest";

import { buildServer } from "../server.js";
import { RoomManager } from "../runtime/room-manager.js";
import { InMemoryUsageRecorder } from "../runtime/usage-recorder.js";

describe("runtime routes", () => {
  afterEach(() => {
    delete process.env.ORCHESTRATOR_SECRET;
  });

  it("rejects requests with the wrong shared secret", async () => {
    process.env.ORCHESTRATOR_SECRET = "expected-secret";

    const server = buildServer();
    const res = await server.inject({
      method: "POST",
      url: "/runtime/start",
      headers: { "x-orchestrator-secret": "wrong" },
    });

    expect(res.statusCode).toBe(401);
  });

  it("starts a room runtime when authorized", async () => {
    process.env.ORCHESTRATOR_SECRET = "expected-secret";

    const server = buildServer();
    const res = await server.inject({
      method: "POST",
      url: "/runtime/start",
      headers: { "x-orchestrator-secret": "expected-secret" },
      payload: { roomSlug: "demo-room" },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      ok: true,
      roomSlug: "demo-room",
      runtimeCount: 1,
    });
  });

  it("ingests mirrored context events for an active room", async () => {
    process.env.ORCHESTRATOR_SECRET = "expected-secret";

    const ingested: unknown[] = [];
    const roomManager = new RoomManager();
    roomManager.register("demo-room", {
      stop() {},
      ingestContextEvent(event) {
        ingested.push(event);
      },
    });

    const server = buildServer(undefined, roomManager);
    const res = await server.inject({
      method: "POST",
      url: "/runtime/context",
      headers: { "x-orchestrator-secret": "expected-secret" },
      payload: {
        kind: "chat_message",
        roomSlug: "demo-room",
        user: "alice",
        text: "Can you split auth and chat first?",
      },
    });

    expect(res.statusCode).toBe(200);
    expect(ingested).toContainEqual(
      expect.objectContaining({
        kind: "chat_message",
        roomSlug: "demo-room",
        user: "alice",
      }),
    );
  });

  it("ingests mirrored video clip context events for an active room", async () => {
    process.env.ORCHESTRATOR_SECRET = "expected-secret";

    const ingested: unknown[] = [];
    const roomManager = new RoomManager();
    roomManager.register("demo-room", {
      stop() {},
      ingestContextEvent(event) {
        ingested.push(event);
      },
    });

    const server = buildServer(undefined, roomManager);
    const res = await server.inject({
      method: "POST",
      url: "/runtime/context",
      headers: { "x-orchestrator-secret": "expected-secret" },
      payload: {
        kind: "video_clip",
        roomSlug: "demo-room",
        url: "data:video/webm;base64,clip",
        capturedAt: 1_744_163_200_000,
      },
    });

    expect(res.statusCode).toBe(200);
    expect(ingested).toContainEqual(
      expect.objectContaining({
        kind: "video_clip",
        roomSlug: "demo-room",
        url: "data:video/webm;base64,clip",
      }),
    );
  });

  it("returns aggregated AI audience usage when authorized", async () => {
    vi.spyOn(console, "info").mockImplementation(() => undefined);
    process.env.ORCHESTRATOR_SECRET = "expected-secret";
    const usageRecorder = new InMemoryUsageRecorder(() => 1_744_163_200_000);
    usageRecorder.record({
      roomSlug: "demo-room",
      operation: "agent_decide",
      personaKey: "curious",
      modelProvider: "openrouter",
      modelName: "google/gemini-3-flash-preview",
      decision: "speak",
      hasScreenshot: true,
      hasVideo: true,
      usage: {
        prompt_tokens: 1000,
        completion_tokens: 50,
        total_tokens: 1050,
        cost: 0.00065,
      },
    });

    const server = buildServer(undefined, new RoomManager(), usageRecorder);
    const res = await server.inject({
      method: "GET",
      url: "/runtime/usage",
      headers: { "x-orchestrator-secret": "expected-secret" },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      totals: {
        requests: 1,
        totalCost: 0.00065,
        totalTokens: 1050,
        videoRequests: 1,
      },
      byOperation: [
        expect.objectContaining({
          key: "agent_decide",
          totalCost: 0.00065,
        }),
      ],
    });
  });
});
