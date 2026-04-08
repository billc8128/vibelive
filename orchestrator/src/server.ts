import Fastify from "fastify";

import { readConfig, type OrchestratorConfig } from "./config.js";
import { registerRuntimeRoutes } from "./routes/runtime.js";

export function buildServer(config: OrchestratorConfig = readConfig()) {
  const app = Fastify();

  registerRuntimeRoutes(app, config);

  return app;
}
