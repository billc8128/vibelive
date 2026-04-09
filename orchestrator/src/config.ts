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
  supabase: {
    url: string;
    serviceRoleKey: string;
  } | null;
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
  const supabaseUrl =
    process.env.SUPABASE_URL?.trim() ??
    process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();

  return {
    port: Number(process.env.PORT || 3100),
    orchestratorSecret: process.env.ORCHESTRATOR_SECRET ?? "",
    model: readModelConfig(),
    supabase:
      supabaseUrl && supabaseServiceRoleKey
        ? {
            url: supabaseUrl,
            serviceRoleKey: supabaseServiceRoleKey,
          }
        : null,
  };
}
