import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";

import type { OrchestratorConfig } from "../config.js";

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
) {
  app.post("/runtime/start", async (request, reply) => {
    if (!authorizeRequest(request, reply, config)) return reply;

    return { ok: true, action: "start" };
  });

  app.post("/runtime/stop", async (request, reply) => {
    if (!authorizeRequest(request, reply, config)) return reply;

    return { ok: true, action: "stop" };
  });
}
