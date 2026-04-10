import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import type { QueryResultRow } from "pg";

export interface OpenRouterUsage {
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
  attachedImage: boolean;
  usedScreenshotSummary: boolean;
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
    videoTokens: number;
    reasoningTokens: number;
    videoRequests: number;
    screenshotRequests: number;
    imageAttachments: number;
    screenshotSummaryBackedRequests: number;
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

interface PostgresUsageRow extends QueryResultRow {
  id?: string;
  created_at?: string | Date;
  room_slug?: string;
  channel_id?: string | null;
  operation?: UsageOperation;
  persona_key?: string | null;
  model_provider?: string;
  model_name?: string;
  decision?: string | null;
  has_screenshot?: boolean;
  has_video?: boolean;
  attached_image?: boolean;
  used_screenshot_summary?: boolean;
  prompt_tokens?: number | string | null;
  completion_tokens?: number | string | null;
  total_tokens?: number | string | null;
  cached_tokens?: number | string | null;
  cache_write_tokens?: number | string | null;
  audio_tokens?: number | string | null;
  video_tokens?: number | string | null;
  reasoning_tokens?: number | string | null;
  cost?: number | string | null;
  usage?: OpenRouterUsage | null;
}

interface PostgresPoolLike {
  query<T extends QueryResultRow = QueryResultRow>(
    sql: string,
    values?: unknown[],
  ): Promise<{ rows: T[]; rowCount: number | null }>;
}

function shouldUseSsl(databaseUrl: string | undefined) {
  if (!databaseUrl) return false;
  return !/(localhost|127\.0\.0\.1|railway\.internal)/i.test(databaseUrl);
}

const CREATE_USAGE_TABLE_SQL = `
create table if not exists ai_audience_usage_events (
  id uuid primary key,
  created_at timestamptz not null default now(),
  room_slug text not null,
  channel_id text,
  operation text not null check (operation in ('agent_decide', 'screenshot_summary')),
  persona_key text,
  model_provider text not null,
  model_name text not null,
  decision text,
  has_screenshot boolean not null default false,
  has_video boolean not null default false,
  attached_image boolean not null default false,
  used_screenshot_summary boolean not null default false,
  prompt_tokens integer not null default 0,
  completion_tokens integer not null default 0,
  total_tokens integer not null default 0,
  cached_tokens integer not null default 0,
  cache_write_tokens integer not null default 0,
  audio_tokens integer not null default 0,
  video_tokens integer not null default 0,
  reasoning_tokens integer not null default 0,
  cost numeric(20, 10) not null default 0,
  usage jsonb not null default '{}'::jsonb
);

alter table ai_audience_usage_events
  add column if not exists attached_image boolean not null default false;

alter table ai_audience_usage_events
  add column if not exists used_screenshot_summary boolean not null default false;

alter table ai_audience_usage_events
  add column if not exists video_tokens integer not null default 0;

create index if not exists ai_audience_usage_created_idx
  on ai_audience_usage_events(created_at desc);

create index if not exists ai_audience_usage_room_created_idx
  on ai_audience_usage_events(room_slug, created_at desc);

create index if not exists ai_audience_usage_model_idx
  on ai_audience_usage_events(model_name);

create index if not exists ai_audience_usage_persona_idx
  on ai_audience_usage_events(persona_key)
  where persona_key is not null;
`;

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
    videoTokens: 0,
    reasoningTokens: 0,
    videoRequests: 0,
    screenshotRequests: 0,
    imageAttachments: 0,
    screenshotSummaryBackedRequests: 0,
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
    totals.videoTokens += numeric(
      event.usage.prompt_tokens_details?.video_tokens,
    );
    totals.reasoningTokens += numeric(
      event.usage.completion_tokens_details?.reasoning_tokens,
    );
    if (event.hasVideo) totals.videoRequests += 1;
    if (event.hasScreenshot) totals.screenshotRequests += 1;
    if (event.attachedImage) totals.imageAttachments += 1;
    if (event.usedScreenshotSummary) totals.screenshotSummaryBackedRequests += 1;

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

function fromPostgresRow(row: PostgresUsageRow): AiUsageEvent {
  const createdAt =
    row.created_at instanceof Date
      ? row.created_at.getTime()
      : row.created_at
        ? Date.parse(row.created_at)
        : 0;

  return {
    id: row.id ?? randomUUID(),
    createdAt,
    roomSlug: row.room_slug ?? "unknown",
    channelId: row.channel_id ?? undefined,
    operation: row.operation ?? "agent_decide",
    personaKey: row.persona_key ?? undefined,
    modelProvider: row.model_provider ?? "unknown",
    modelName: row.model_name ?? "unknown",
    decision: row.decision ?? undefined,
    hasScreenshot: row.has_screenshot ?? false,
    hasVideo: row.has_video ?? false,
    attachedImage: row.attached_image ?? false,
    usedScreenshotSummary: row.used_screenshot_summary ?? false,
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
        video_tokens: numeric(row.video_tokens),
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
      attachedImage: event.attachedImage,
      usedScreenshotSummary: event.usedScreenshotSummary,
      videoTokens: event.usage.prompt_tokens_details?.video_tokens,
    });
  }

  summary() {
    return summarizeEvents(this.events);
  }
}

export class PostgresUsageRecorder implements UsageRecorder {
  private readonly fallback: InMemoryUsageRecorder;
  private readonly pool: PostgresPoolLike;
  private ensureSchemaPromise: Promise<void> | null = null;

  constructor(
    private readonly config: {
      databaseUrl?: string;
      pool?: PostgresPoolLike;
      now?: () => number;
      maxEvents?: number;
    },
  ) {
    if (!config.pool && !config.databaseUrl) {
      throw new Error("PostgresUsageRecorder requires a databaseUrl or pool");
    }

    this.pool =
      config.pool ??
      new Pool({
        connectionString: config.databaseUrl,
        ssl: shouldUseSsl(config.databaseUrl)
          ? { rejectUnauthorized: false }
          : undefined,
      });
    this.fallback = new InMemoryUsageRecorder(config.now, config.maxEvents);
  }

  async record(input: AiUsageEventInput) {
    const event = this.fallback.record(input);

    try {
      await this.ensureSchema();
      await this.pool.query(
        `
insert into ai_audience_usage_events (
  id,
  created_at,
  room_slug,
  channel_id,
  operation,
  persona_key,
  model_provider,
  model_name,
  decision,
  has_screenshot,
  has_video,
  attached_image,
  used_screenshot_summary,
  prompt_tokens,
  completion_tokens,
  total_tokens,
  cached_tokens,
  cache_write_tokens,
  audio_tokens,
  video_tokens,
  reasoning_tokens,
  cost,
  usage
) values (
  $1, $2, $3, $4, $5, $6, $7, $8, $9, $10,
  $11, $12, $13, $14, $15, $16, $17, $18, $19, $20,
  $21, $22, $23
)
`,
        [
          event.id,
          new Date(event.createdAt).toISOString(),
          event.roomSlug,
          event.channelId ?? null,
          event.operation,
          event.personaKey ?? null,
          event.modelProvider,
          event.modelName,
          event.decision ?? null,
          event.hasScreenshot,
          event.hasVideo,
          event.attachedImage,
          event.usedScreenshotSummary,
          numeric(event.usage.prompt_tokens),
          numeric(event.usage.completion_tokens),
          numeric(event.usage.total_tokens),
          numeric(event.usage.prompt_tokens_details?.cached_tokens),
          numeric(event.usage.prompt_tokens_details?.cache_write_tokens),
          numeric(event.usage.prompt_tokens_details?.audio_tokens),
          numeric(event.usage.prompt_tokens_details?.video_tokens),
          numeric(event.usage.completion_tokens_details?.reasoning_tokens),
          numeric(event.usage.cost),
          event.usage,
        ],
      );
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
      await this.ensureSchema();
      const result = await this.pool.query<PostgresUsageRow>(
        `
select *
from ai_audience_usage_events
order by created_at desc
limit $1
`,
        [this.config.maxEvents ?? 5_000],
      );

      const events = result.rows.map(fromPostgresRow).reverse();
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

  private async ensureSchema() {
    this.ensureSchemaPromise ??= this.pool
      .query(CREATE_USAGE_TABLE_SQL)
      .then(() => undefined)
      .catch((error) => {
        this.ensureSchemaPromise = null;
        throw error;
      });

    await this.ensureSchemaPromise;
  }
}

export function createUsageRecorder(config?: {
  databaseUrl?: string | null;
}) {
  if (config?.databaseUrl) {
    return new PostgresUsageRecorder({
      databaseUrl: config.databaseUrl,
    });
  }

  return new InMemoryUsageRecorder();
}

export const usageRecorder = new InMemoryUsageRecorder();
