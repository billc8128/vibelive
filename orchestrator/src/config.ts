import "dotenv/config";

export interface OpenRouterModelConfig {
  provider: "openrouter";
  name: string;
  apiKey: string;
  apiUrl: string;
}

export interface OrchestratorConfig {
  port: number;
  orchestratorSecret: string;
  model: OpenRouterModelConfig | null;
  databaseUrl: string | null;
}

function readModelConfig(): OpenRouterModelConfig | null {
  const provider = process.env.AI_AUDIENCE_MODEL_PROVIDER?.trim().toLowerCase();
  const name = process.env.AI_AUDIENCE_MODEL_NAME?.trim();
  const apiKey = process.env.AI_AUDIENCE_MODEL_API_KEY?.trim();

  if (provider !== "openrouter" || !name || !apiKey) {
    return null;
  }

  return {
    provider: "openrouter",
    name,
    apiKey,
    apiUrl: "https://openrouter.ai/api/v1/chat/completions",
  };
}

export function readConfig(): OrchestratorConfig {
  return {
    port: Number(process.env.PORT || 3100),
    orchestratorSecret: process.env.ORCHESTRATOR_SECRET ?? "",
    model: readModelConfig(),
    databaseUrl: process.env.DATABASE_URL?.trim() || null,
  };
}
