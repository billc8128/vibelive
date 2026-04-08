export interface OrchestratorConfig {
  port: number;
  orchestratorSecret: string;
}

export function readConfig(): OrchestratorConfig {
  return {
    port: Number(process.env.PORT || 3100),
    orchestratorSecret: process.env.ORCHESTRATOR_SECRET ?? "",
  };
}
