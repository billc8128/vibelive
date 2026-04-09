import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";

import type { OrchestratorConfig } from "../config.js";
import type {
  RuntimeContextEvent,
  StartRuntimePayload,
  StopRuntimePayload,
} from "../types.js";
import { RoomManager } from "../runtime/room-manager.js";
import { RoomRuntime } from "../runtime/room-runtime.js";

function authorizeRequest(
  request: FastifyRequest,
  reply: FastifyReply,
  config: OrchestratorConfig,
): boolean {
  if (request.headers["x-orchestrator-secret"] !== config.orchestratorSecret) {
    void reply.code(401).send({ error: "unauthorized" });
    return false;
  }

  return true;
}

export function registerRuntimeRoutes(
  app: FastifyInstance,
  config: OrchestratorConfig,
  roomManager = new RoomManager(),
) {
  app.post("/runtime/start", async (request, reply) => {
    if (!authorizeRequest(request, reply, config)) return reply;

    const payload = request.body as StartRuntimePayload | undefined;
    if (!payload?.roomSlug?.trim()) {
      return reply.code(400).send({ error: "roomSlug is required" });
    }

    const runtime = new RoomRuntime({
      ...payload,
      roomSlug: payload.roomSlug.trim(),
    });
    await runtime.start();
    roomManager.register(payload.roomSlug.trim(), runtime);

    return {
      ok: true,
      action: "start",
      roomSlug: payload.roomSlug.trim(),
      runtimeCount: roomManager.count(),
    };
  });

  app.post("/runtime/stop", async (request, reply) => {
    if (!authorizeRequest(request, reply, config)) return reply;

    const payload = request.body as StopRuntimePayload | undefined;
    if (!payload?.roomSlug?.trim()) {
      return reply.code(400).send({ error: "roomSlug is required" });
    }

    const stopped = await roomManager.stop(payload.roomSlug.trim());
    return {
      ok: true,
      action: "stop",
      roomSlug: payload.roomSlug.trim(),
      stopped,
      runtimeCount: roomManager.count(),
    };
  });

  app.post("/runtime/context", async (request, reply) => {
    if (!authorizeRequest(request, reply, config)) return reply;

    const payload = request.body as RuntimeContextEvent | undefined;
    if (!payload?.roomSlug?.trim() || !payload.kind) {
      return reply.code(400).send({ error: "invalid context event" });
    }

    const runtime = roomManager.get(payload.roomSlug.trim());
    if (!runtime?.ingestContextEvent) {
      return reply.code(404).send({ error: "runtime not found" });
    }

    await runtime.ingestContextEvent({
      ...payload,
      roomSlug: payload.roomSlug.trim(),
    });

    return {
      ok: true,
      action: "context",
      roomSlug: payload.roomSlug.trim(),
      kind: payload.kind,
    };
  });
}
