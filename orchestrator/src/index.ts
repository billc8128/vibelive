import { buildServer } from "./server.js";

const server = buildServer();

await server.listen({
  port: Number(process.env.PORT || 3100),
  host: "0.0.0.0",
});
