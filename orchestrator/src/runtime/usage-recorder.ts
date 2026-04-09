import { randomUUID } from "node:crypto";

export interface OpenRouterUsage {
  prompt_tokens?: number;
  completion_tokens?: number;
  total_tokens?: number;
  cost?: number;
  prompt_tokens_details?: {
    cached_tokens?: number;
    cache_write_tokens?: number;
    audio_tokens?: number;
  };
  completion_tokens_details?: {
    reasoning_tokens?: number;
  };
  cost_details?: Record<string, unknown>;
}

export type UsageOperation = "agent_decide" | "screenshot_summary";

export interface AiUsageEventInput {
  roomSlug: string;
  channelId?: string;
  operation: UsageOperation;
  personaKey?: string;
  modelProvider: string;
  modelName: string;
  decision?: string;
  hasScreenshot: boolean;
  hasVideo: boolean;
  usage: OpenRouterUsage;
}

export interface AiUsageEvent extends AiUsageEventInput {
  id: string;
  createdAt: number;
}

interface UsageBucket {
  key: string;
  requests: number;
  totalCost: number;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

function numeric(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function addToBucket(bucket: UsageBucket, event: AiUsageEvent) {
  bucket.requests += 1;
  bucket.totalCost += numeric(event.usage.cost);
  bucket.promptTokens += numeric(event.usage.prompt_tokens);
  bucket.completionTokens += numeric(event.usage.completion_tokens);
  bucket.totalTokens += numeric(event.usage.total_tokens);
}

function pushBucket(
  buckets: Map<string, UsageBucket>,
  key: string | undefined,
  event: AiUsageEvent,
) {
  if (!key) return;

  const bucket =
    buckets.get(key) ??
    ({
      key,
      requests: 0,
      totalCost: 0,
      promptTokens: 0,
      completionTokens: 0,
      totalTokens: 0,
    } satisfies UsageBucket);
  addToBucket(bucket, event);
  buckets.set(key, bucket);
}

function sortedBuckets(buckets: Map<string, UsageBucket>) {
  return [...buckets.values()].sort((a, b) => b.totalCost - a.totalCost);
}

export class InMemoryUsageRecorder {
  private readonly events: AiUsageEvent[] = [];

  constructor(
    private readonly now: () => number = Date.now,
    private readonly maxEvents = 5_000,
  ) {}

  record(input: AiUsageEventInput) {
    const event: AiUsageEvent = {
      ...input,
      id: randomUUID(),
      createdAt: this.now(),
    };

    this.events.push(event);
    if (this.events.length > this.maxEvents) {
      this.events.splice(0, this.events.length - this.maxEvents);
    }

    console.info("ai audience usage", {
      roomSlug: event.roomSlug,
      operation: event.operation,
      personaKey: event.personaKey,
      modelName: event.modelName,
      decision: event.decision,
      cost: event.usage.cost,
      promptTokens: event.usage.prompt_tokens,
      completionTokens: event.usage.completion_tokens,
      totalTokens: event.usage.total_tokens,
      hasScreenshot: event.hasScreenshot,
      hasVideo: event.hasVideo,
    });
  }

  summary() {
    const totals = {
      requests: 0,
      totalCost: 0,
      promptTokens: 0,
      completionTokens: 0,
      totalTokens: 0,
      cachedTokens: 0,
      cacheWriteTokens: 0,
      audioTokens: 0,
      reasoningTokens: 0,
      videoRequests: 0,
      screenshotRequests: 0,
    };
    const byOperation = new Map<string, UsageBucket>();
    const byModel = new Map<string, UsageBucket>();
    const byPersona = new Map<string, UsageBucket>();
    const byRoom = new Map<string, UsageBucket>();

    for (const event of this.events) {
      totals.requests += 1;
      totals.totalCost += numeric(event.usage.cost);
      totals.promptTokens += numeric(event.usage.prompt_tokens);
      totals.completionTokens += numeric(event.usage.completion_tokens);
      totals.totalTokens += numeric(event.usage.total_tokens);
      totals.cachedTokens += numeric(
        event.usage.prompt_tokens_details?.cached_tokens,
      );
      totals.cacheWriteTokens += numeric(
        event.usage.prompt_tokens_details?.cache_write_tokens,
      );
      totals.audioTokens += numeric(
        event.usage.prompt_tokens_details?.audio_tokens,
      );
      totals.reasoningTokens += numeric(
        event.usage.completion_tokens_details?.reasoning_tokens,
      );
      if (event.hasVideo) totals.videoRequests += 1;
      if (event.hasScreenshot) totals.screenshotRequests += 1;

      pushBucket(byOperation, event.operation, event);
      pushBucket(byModel, event.modelName, event);
      pushBucket(byPersona, event.personaKey, event);
      pushBucket(byRoom, event.roomSlug, event);
    }

    return {
      totals,
      byOperation: sortedBuckets(byOperation),
      byModel: sortedBuckets(byModel),
      byPersona: sortedBuckets(byPersona),
      byRoom: sortedBuckets(byRoom),
      recentEvents: this.events.slice(-50).reverse(),
    };
  }
}

export const usageRecorder = new InMemoryUsageRecorder();
