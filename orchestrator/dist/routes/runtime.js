function authorizeRequest(request, reply, config) {
    if (request.headers["x-orchestrator-secret"] !== config.orchestratorSecret) {
        void reply.code(401).send({ error: "unauthorized" });
        return false;
    }
    return true;
}
export function registerRuntimeRoutes(app, config) {
    app.post("/runtime/start", async (request, reply) => {
        if (!authorizeRequest(request, reply, config))
            return reply;
        return { ok: true, action: "start" };
    });
    app.post("/runtime/stop", async (request, reply) => {
        if (!authorizeRequest(request, reply, config))
            return reply;
        return { ok: true, action: "stop" };
    });
}
