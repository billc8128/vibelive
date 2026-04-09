import type { ChatTimelineMessage } from "./protocol";

interface PersistedChatTimeline {
  sessionStartedAt: string | null;
  messages: ChatTimelineMessage[];
}

interface RestoreChatTimelineOptions {
  raw: string | null;
  sessionStartedAt: string | null;
  now?: number;
  ttlMs?: number;
}

interface SerializeChatTimelineOptions {
  messages: ChatTimelineMessage[];
  sessionStartedAt: string | null;
  now?: number;
  ttlMs?: number;
}

function isChatTimelineMessageArray(
  input: unknown,
): input is ChatTimelineMessage[] {
  return Array.isArray(input);
}

function normalizeMessages(
  messages: ChatTimelineMessage[],
  now: number,
  ttlMs: number,
  sessionStartedAt: string | null,
) {
  const cutoff = now - ttlMs;
  const sessionStartMs = sessionStartedAt
    ? new Date(sessionStartedAt).getTime()
    : 0;

  return messages.filter(
    (message) => message.time > cutoff && message.time >= sessionStartMs,
  );
}

export function restoreChatTimeline({
  raw,
  sessionStartedAt,
  now = Date.now(),
  ttlMs = 10 * 60 * 1000,
}: RestoreChatTimelineOptions): ChatTimelineMessage[] {
  if (!raw) {
    return [];
  }

  try {
    const parsed = JSON.parse(raw) as unknown;
    if (isChatTimelineMessageArray(parsed)) {
      return normalizeMessages(parsed, now, ttlMs, sessionStartedAt);
    }

    const persisted = parsed as PersistedChatTimeline;
    if (!Array.isArray(persisted?.messages)) {
      return [];
    }

    if (
      sessionStartedAt &&
      persisted.sessionStartedAt &&
      persisted.sessionStartedAt !== sessionStartedAt
    ) {
      return [];
    }

    return normalizeMessages(
      persisted.messages,
      now,
      ttlMs,
      sessionStartedAt,
    );
  } catch {
    return [];
  }
}

export function serializeChatTimeline({
  messages,
  sessionStartedAt,
  now = Date.now(),
  ttlMs = 10 * 60 * 1000,
}: SerializeChatTimelineOptions) {
  return JSON.stringify({
    sessionStartedAt,
    messages: normalizeMessages(messages, now, ttlMs, sessionStartedAt),
  } satisfies PersistedChatTimeline);
}
