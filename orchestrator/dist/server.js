import Fastify from "fastify";
import { readConfig } from "./config.js";
import { registerRuntimeRoutes } from "./routes/runtime.js";
export function buildServer(config = readConfig()) {
    const app = Fastify();
    registerRuntimeRoutes(app, config);
    return app;
}
