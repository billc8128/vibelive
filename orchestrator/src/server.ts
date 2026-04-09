import Fastify from "fastify";

import { readConfig, type OrchestratorConfig } from "./config.js";
import { RoomManager } from "./runtime/room-manager.js";
import { registerRuntimeRoutes } from "./routes/runtime.js";
import { usageRecorder, type InMemoryUsageRecorder } from "./runtime/usage-recorder.js";

export function buildServer(
  config: OrchestratorConfig = readConfig(),
  roomManager = new RoomManager(),
  recorder: InMemoryUsageRecorder = usageRecorder,
) {
  const app = Fastify();

  registerRuntimeRoutes(app, config, roomManager, recorder);

  return app;
}
