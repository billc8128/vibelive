import type { AiAudienceSettings } from "@/lib/ai-audience/settings";

export interface StartAiAudienceRuntimePayload {
  roomSlug: string;
  channelId: string;
  roomTitle: string;
  projectStage: string;
  codingTool: string;
  aiAudience: AiAudienceSettings;
}

export interface StopAiAudienceRuntimePayload {
  roomSlug: string;
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
