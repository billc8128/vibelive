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

export interface UsageBucket {
  key: string;
  requests: number;
  totalCost: number;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

export interface AiUsageSummary {
  totals: {
    requests: number;
    totalCost: number;
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
    cachedTokens: number;
    cacheWriteTokens: number;
    audioTokens: number;
    reasoningTokens: number;
    videoRequests: number;
    screenshotRequests: number;
  };
  byOperation: UsageBucket[];
  byModel: UsageBucket[];
  byPersona: UsageBucket[];
  byRoom: UsageBucket[];
  recentEvents: AiUsageEvent[];
}

export interface UsageRecorder {
  record(input: AiUsageEventInput): AiUsageEvent | Promise<AiUsageEvent>;
  summary(): AiUsageSummary | Promise<AiUsageSummary>;
}

interface SupabaseUsageRow {
  id?: string;
  created_at?: string;
  room_slug?: string;
  channel_id?: string | null;
  operation?: UsageOperation;
  persona_key?: string | null;
  model_provider?: string;
  model_name?: string;
  decision?: string | null;
  has_screenshot?: boolean;
  has_video?: boolean;
  prompt_tokens?: number | string | null;
  completion_tokens?: number | string | null;
  total_tokens?: number | string | null;
  cached_tokens?: number | string | null;
  cache_write_tokens?: number | string | null;
  audio_tokens?: number | string | null;
  reasoning_tokens?: number | string | null;
  cost?: number | string | null;
  usage?: OpenRouterUsage | null;
}

function numeric(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }

  return 0;
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

function createUsageEvent(
  input: AiUsageEventInput,
  now: () => number,
): AiUsageEvent {
  return {
    ...input,
    id: randomUUID(),
    createdAt: now(),
  };
}

function summarizeEvents(events: AiUsageEvent[]): AiUsageSummary {
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

  for (const event of events) {
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
    recentEvents: events.slice(-50).reverse(),
  };
}

function toSupabaseRow(event: AiUsageEvent): SupabaseUsageRow {
  return {
    id: event.id,
    created_at: new Date(event.createdAt).toISOString(),
    room_slug: event.roomSlug,
    channel_id: event.channelId ?? null,
    operation: event.operation,
    persona_key: event.personaKey ?? null,
    model_provider: event.modelProvider,
    model_name: event.modelName,
    decision: event.decision ?? null,
    has_screenshot: event.hasScreenshot,
    has_video: event.hasVideo,
    prompt_tokens: numeric(event.usage.prompt_tokens),
    completion_tokens: numeric(event.usage.completion_tokens),
    total_tokens: numeric(event.usage.total_tokens),
    cached_tokens: numeric(event.usage.prompt_tokens_details?.cached_tokens),
    cache_write_tokens: numeric(
      event.usage.prompt_tokens_details?.cache_write_tokens,
    ),
    audio_tokens: numeric(event.usage.prompt_tokens_details?.audio_tokens),
    reasoning_tokens: numeric(
      event.usage.completion_tokens_details?.reasoning_tokens,
    ),
    cost: numeric(event.usage.cost),
    usage: event.usage,
  };
}

function fromSupabaseRow(row: SupabaseUsageRow): AiUsageEvent {
  return {
    id: row.id ?? randomUUID(),
    createdAt: row.created_at ? Date.parse(row.created_at) : 0,
    roomSlug: row.room_slug ?? "unknown",
    channelId: row.channel_id ?? undefined,
    operation: row.operation ?? "agent_decide",
    personaKey: row.persona_key ?? undefined,
    modelProvider: row.model_provider ?? "unknown",
    modelName: row.model_name ?? "unknown",
    decision: row.decision ?? undefined,
    hasScreenshot: row.has_screenshot ?? false,
    hasVideo: row.has_video ?? false,
    usage: {
      ...(row.usage ?? {}),
      prompt_tokens: numeric(row.prompt_tokens),
      completion_tokens: numeric(row.completion_tokens),
      total_tokens: numeric(row.total_tokens),
      cost: numeric(row.cost),
      prompt_tokens_details: {
        ...(row.usage?.prompt_tokens_details ?? {}),
        cached_tokens: numeric(row.cached_tokens),
        cache_write_tokens: numeric(row.cache_write_tokens),
        audio_tokens: numeric(row.audio_tokens),
      },
      completion_tokens_details: {
        ...(row.usage?.completion_tokens_details ?? {}),
        reasoning_tokens: numeric(row.reasoning_tokens),
      },
    },
  };
}

export class InMemoryUsageRecorder implements UsageRecorder {
  private readonly events: AiUsageEvent[] = [];

  constructor(
    private readonly now: () => number = Date.now,
    private readonly maxEvents = 5_000,
  ) {}

  record(input: AiUsageEventInput) {
    const event = createUsageEvent(input, this.now);
    this.recordEvent(event);
    return event;
  }

  recordEvent(event: AiUsageEvent) {
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
    return summarizeEvents(this.events);
  }
}

export class SupabaseUsageRecorder implements UsageRecorder {
  private readonly fallback: InMemoryUsageRecorder;
  private readonly baseUrl: string;

  constructor(
    private readonly config: {
      supabaseUrl: string;
      serviceRoleKey: string;
      fetchImpl?: typeof fetch;
      now?: () => number;
      maxEvents?: number;
    },
  ) {
    this.baseUrl = `${config.supabaseUrl.replace(/\/$/, "")}/rest/v1/ai_audience_usage_events`;
    this.fallback = new InMemoryUsageRecorder(config.now, config.maxEvents);
  }

  async record(input: AiUsageEventInput) {
    const event = this.fallback.record(input);

    try {
      const response = await this.fetchImpl(this.baseUrl, {
        method: "POST",
        headers: this.headers({
          "content-type": "application/json",
          prefer: "return=minimal",
        }),
        body: JSON.stringify(toSupabaseRow(event)),
      });

      if (!response.ok) {
        throw new Error(
          `Supabase usage insert failed: ${response.status} ${await response.text()}`,
        );
      }
    } catch (error) {
      console.warn("ai audience usage persistence failed", {
        roomSlug: event.roomSlug,
        operation: event.operation,
        error: error instanceof Error ? error.message : String(error),
      });
    }

    return event;
  }

  async summary() {
    const fallbackSummary = this.fallback.summary();

    try {
      const response = await this.fetchImpl(
        `${this.baseUrl}?select=*&order=created_at.desc&limit=${this.config.maxEvents ?? 5_000}`,
        {
          method: "GET",
          headers: this.headers(),
        },
      );

      if (!response.ok) {
        throw new Error(
          `Supabase usage summary failed: ${response.status} ${await response.text()}`,
        );
      }

      const rows = (await response.json()) as SupabaseUsageRow[];
      const events = rows.map(fromSupabaseRow).reverse();
      const persistedSummary = summarizeEvents(events);
      if (
        persistedSummary.totals.requests === 0 &&
        fallbackSummary.totals.requests > 0
      ) {
        return fallbackSummary;
      }

      return persistedSummary;
    } catch (error) {
      console.warn("ai audience usage summary fallback", {
        error: error instanceof Error ? error.message : String(error),
      });
      return fallbackSummary;
    }
  }

  private get fetchImpl() {
    return this.config.fetchImpl ?? fetch;
  }

  private headers(extra?: Record<string, string>) {
    return {
      apikey: this.config.serviceRoleKey,
      authorization: `Bearer ${this.config.serviceRoleKey}`,
      ...extra,
    };
  }
}

export function createUsageRecorder(config?: {
  supabase?: {
    url: string;
    serviceRoleKey: string;
  } | null;
}) {
  if (config?.supabase) {
    return new SupabaseUsageRecorder({
      supabaseUrl: config.supabase.url,
      serviceRoleKey: config.supabase.serviceRoleKey,
    });
  }

  return new InMemoryUsageRecorder();
}

export const usageRecorder = new InMemoryUsageRecorder();
