export type AiAudienceContextEvent =
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

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

export function isAiAudienceContextEvent(
  input: unknown,
): input is AiAudienceContextEvent {
  if (!input || typeof input !== "object") {
    return false;
  }

  const value = input as Record<string, unknown>;
  if (!isNonEmptyString(value.roomSlug) || !isNonEmptyString(value.kind)) {
    return false;
  }

  switch (value.kind) {
    case "chat_message":
      return isNonEmptyString(value.user) && typeof value.text === "string";
    case "reaction":
      return (
        isNonEmptyString(value.user) && isNonEmptyString(value.reactionKind)
      );
    case "screenshot":
      return (
        isNonEmptyString(value.url) && typeof value.capturedAt === "number"
      );
    default:
      return false;
  }
}

export async function mirrorAiAudienceContextEvent(
  payload: AiAudienceContextEvent,
  fetchImpl: typeof fetch = fetch,
) {
  return fetchImpl("/api/ai-audience/context", {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify(payload),
  });
}
