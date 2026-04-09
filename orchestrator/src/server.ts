import Fastify from "fastify";

import { readConfig, type OrchestratorConfig } from "./config.js";
import { RoomManager } from "./runtime/room-manager.js";
import { registerRuntimeRoutes } from "./routes/runtime.js";
import {
  createUsageRecorder,
  type UsageRecorder,
} from "./runtime/usage-recorder.js";

export function buildServer(
  config: OrchestratorConfig = readConfig(),
  roomManager = new RoomManager(),
  recorder: UsageRecorder = createUsageRecorder(config),
) {
  const app = Fastify();

  registerRuntimeRoutes(app, config, roomManager, recorder);

  return app;
}
