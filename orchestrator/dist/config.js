export function readConfig() {
    return {
        port: Number(process.env.PORT || 3100),
        orchestratorSecret: process.env.ORCHESTRATOR_SECRET ?? "",
    };
}
