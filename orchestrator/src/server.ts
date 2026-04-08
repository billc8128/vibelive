import Fastify from "fastify";

import { readConfig, type OrchestratorConfig } from "./config.js";
import { RoomManager } from "./runtime/room-manager.js";
import { registerRuntimeRoutes } from "./routes/runtime.js";

export function buildServer(
  config: OrchestratorConfig = readConfig(),
  roomManager = new RoomManager(),
) {
  const app = Fastify();

  registerRuntimeRoutes(app, config, roomManager);

  return app;
}
