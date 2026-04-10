import type { AiAudienceSettings } from "@/lib/ai-audience/settings";

export interface StartAiAudienceRuntimePayload {
  roomSlug: string;
  channelId: string;
  roomTitle: string;
  projectStage: string;
  codingTool: string;
  clientDriven?: boolean;
  aiAudience: AiAudienceSettings;
}

export interface StopAiAudienceRuntimePayload {
  roomSlug: string;
}

export interface TickAiAudienceRuntimePayload {
  roomSlug: string;
}

export interface AiAudienceUsageTotals {
  requests: number;
  totalCost: number;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  cachedTokens: number;
  cacheWriteTokens: number;
  audioTokens: number;
  videoTokens: number;
  reasoningTokens: number;
  videoRequests: number;
  screenshotRequests: number;
  imageAttachments: number;
  screenshotSummaryBackedRequests: number;
}

export interface AiAudienceUsageBucket {
  key: string;
  requests: number;
  totalCost: number;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

export interface AiAudienceUsageEvent {
  id: string;
  createdAt: number;
  roomSlug: string;
  channelId?: string;
  operation: "agent_decide" | "screenshot_summary";
  personaKey?: string;
  modelProvider: string;
  modelName: string;
  decision?: string;
  hasScreenshot: boolean;
  hasVideo: boolean;
  attachedImage: boolean;
  usedScreenshotSummary: boolean;
  usage: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
    cost?: number;
    prompt_tokens_details?: {
      cached_tokens?: number;
      cache_write_tokens?: number;
      audio_tokens?: number;
      video_tokens?: number;
    };
    completion_tokens_details?: {
      reasoning_tokens?: number;
    };
  };
}

export interface AiAudienceUsageSummary {
  totals: AiAudienceUsageTotals;
  byOperation: AiAudienceUsageBucket[];
  byModel: AiAudienceUsageBucket[];
  byPersona: AiAudienceUsageBucket[];
  byRoom: AiAudienceUsageBucket[];
  recentEvents: AiAudienceUsageEvent[];
}

export type AiAudienceContextEventPayload =
  | {
      roomSlug: string;
      kind: "chat_message";
      user: string;
      text: string;
      bot?: boolean;
    }
  | {
      roomSlug: string;
      kind: "reaction";
      user: string;
      reactionKind: string;
    }
  | {
      roomSlug: string;
      kind: "screenshot";
      url: string;
      capturedAt: number;
    }
  | {
      roomSlug: string;
      kind: "video_clip";
      url: string;
      capturedAt: number;
    };

export function buildSignedOrchestratorHeaders(secret: string) {
  return {
    "content-type": "application/json",
    "x-orchestrator-secret": secret,
  };
}

function buildRuntimeUrl(path: string): string | null {
  const baseUrl = process.env.AI_AUDIENCE_ORCHESTRATOR_URL;
  if (!baseUrl) return null;

  return `${baseUrl.replace(/\/$/, "")}${path}`;
}

async function orchestratorRequest(
  path: string,
  payload:
    | StartAiAudienceRuntimePayload
    | StopAiAudienceRuntimePayload
    | TickAiAudienceRuntimePayload
    | AiAudienceContextEventPayload,
) {
  const url = buildRuntimeUrl(path);
  if (!url) return null;

  return fetch(url, {
    method: "POST",
    headers: buildSignedOrchestratorHeaders(
      process.env.AI_AUDIENCE_ORCHESTRATOR_SECRET ?? "",
    ),
    body: JSON.stringify(payload),
  });
}

async function orchestratorGet(path: string) {
  const url = buildRuntimeUrl(path);
  if (!url) return null;

  return fetch(url, {
    method: "GET",
    headers: buildSignedOrchestratorHeaders(
      process.env.AI_AUDIENCE_ORCHESTRATOR_SECRET ?? "",
    ),
    cache: "no-store",
  });
}

export async function startAiAudienceRuntime(
  payload: StartAiAudienceRuntimePayload,
) {
  return orchestratorRequest("/runtime/start", payload);
}

export async function stopAiAudienceRuntime(
  payload: StopAiAudienceRuntimePayload,
) {
  return orchestratorRequest("/runtime/stop", payload);
}

export async function sendAiAudienceContextEvent(
  payload: AiAudienceContextEventPayload,
) {
  return orchestratorRequest("/runtime/context", payload);
}

export async function tickAiAudienceRuntime(
  payload: TickAiAudienceRuntimePayload,
) {
  return orchestratorRequest("/runtime/tick", payload);
}

export async function getAiAudienceUsageSummary() {
  const response = await orchestratorGet("/runtime/usage");
  if (!response) return null;
  if (!response.ok) {
    throw new Error(`AI audience usage request failed: ${response.status}`);
  }

  return (await response.json()) as AiAudienceUsageSummary;
}
