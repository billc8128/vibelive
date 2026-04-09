import { afterEach, describe, expect, it } from "vitest";

import { buildServer } from "../server.js";
import { RoomManager } from "../runtime/room-manager.js";

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
});
