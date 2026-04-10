import type { Metadata } from "next";
import { connection } from "next/server";

import {
  getAiAudienceUsageSummary,
  type AiAudienceUsageBucket,
  type AiAudienceUsageEvent,
  type AiAudienceUsageSummary,
} from "@/lib/orchestrator/client";
import { describeAiAudienceContext } from "@/lib/orchestrator/usage-display";

export const metadata: Metadata = {
  title: "Admin | VibeLive",
};

const EMPTY_USAGE_SUMMARY: AiAudienceUsageSummary = {
  totals: {
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
  },
  byOperation: [],
  byModel: [],
  byPersona: [],
  byRoom: [],
  recentEvents: [],
};

const OPERATION_LABELS: Record<string, string> = {
  agent_decide: "观众发言决策",
  screenshot_summary: "截图语义摘要",
};

const DECISION_LABELS: Record<string, string> = {
  speak: "发言",
  hold: "观望",
  skip: "跳过",
  summary: "摘要",
};

async function loadUsageSummary() {
  try {
    const summary = await getAiAudienceUsageSummary();
    if (!summary) {
      return {
        summary: EMPTY_USAGE_SUMMARY,
        error: "未配置 AI_AUDIENCE_ORCHESTRATOR_URL，当前没有连接到 orchestrator。",
      };
    }

    return { summary, error: null };
  } catch (error) {
    return {
      summary: EMPTY_USAGE_SUMMARY,
      error:
        error instanceof Error
          ? error.message
          : "读取 AI audience usage 失败。",
    };
  }
}

function formatCost(value: number) {
  if (value <= 0) return "$0.000000";
  if (value < 0.000001) return "< $0.000001";
  if (value >= 1) return `$${value.toFixed(2)}`;
  return `$${value.toFixed(6)}`;
}

function formatNumber(value: number) {
  return new Intl.NumberFormat("en-US").format(Math.round(value));
}

function formatTime(value: number) {
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(new Date(value));
}

function operationLabel(operation: string) {
  return OPERATION_LABELS[operation] ?? operation;
}

function decisionLabel(decision?: string) {
  if (!decision) return "n/a";
  return DECISION_LABELS[decision] ?? decision;
}

function MetricCard({
  label,
  value,
  detail,
  accent = "cyan",
}: {
  label: string;
  value: string;
  detail: string;
  accent?: "cyan" | "green" | "pink" | "yellow";
}) {
  const accentClass = {
    cyan: "text-accent-cyan glow-cyan",
    green: "text-accent-green glow-green",
    pink: "text-accent-pink glow-pink",
    yellow: "text-accent-yellow",
  }[accent];

  return (
    <div className="pixel-border bg-bg-card/80 p-4">
      <p className="font-[family-name:var(--font-pixel)] text-[8px] uppercase tracking-wider text-text-secondary">
        {label}
      </p>
      <p className={`mt-4 text-2xl font-semibold ${accentClass}`}>{value}</p>
      <p className="mt-3 text-xs leading-5 text-text-secondary">{detail}</p>
    </div>
  );
}

function BucketTable({
  title,
  rows,
  emptyLabel,
}: {
  title: string;
  rows: AiAudienceUsageBucket[];
  emptyLabel: string;
}) {
  return (
    <section className="hud-panel p-4">
      <div className="mb-4 flex items-center gap-3">
        <h2 className="font-[family-name:var(--font-pixel)] text-[10px] text-accent-green">
          {title}
        </h2>
        <div className="h-px flex-1 bg-gradient-to-r from-accent-green/40 to-transparent" />
      </div>

      {rows.length === 0 ? (
        <p className="py-8 text-sm text-text-secondary">{emptyLabel}</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[520px] text-left text-sm">
            <thead className="font-[family-name:var(--font-pixel)] text-[8px] uppercase text-text-secondary">
              <tr className="border-b border-border-pixel">
                <th className="pb-3 pr-4 font-normal">key</th>
                <th className="pb-3 pr-4 font-normal">calls</th>
                <th className="pb-3 pr-4 font-normal">cost</th>
                <th className="pb-3 pr-4 font-normal">input</th>
                <th className="pb-3 pr-4 font-normal">output</th>
                <th className="pb-3 font-normal">total</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.key} className="border-b border-border-pixel/50">
                  <td className="py-3 pr-4 font-medium text-text-primary">
                    {operationLabel(row.key)}
                  </td>
                  <td className="py-3 pr-4 text-text-secondary">
                    {formatNumber(row.requests)}
                  </td>
                  <td className="py-3 pr-4 text-accent-yellow">
                    {formatCost(row.totalCost)}
                  </td>
                  <td className="py-3 pr-4 text-text-secondary">
                    {formatNumber(row.promptTokens)}
                  </td>
                  <td className="py-3 pr-4 text-text-secondary">
                    {formatNumber(row.completionTokens)}
                  </td>
                  <td className="py-3 text-text-secondary">
                    {formatNumber(row.totalTokens)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function RecentEvents({ events }: { events: AiAudienceUsageEvent[] }) {
  return (
    <section className="pixel-border bg-bg-card/70 p-4">
      <div className="mb-4 flex items-center gap-3">
        <h2 className="font-[family-name:var(--font-pixel)] text-[10px] text-accent-cyan">
          最近调用
        </h2>
        <div className="h-px flex-1 bg-gradient-to-r from-accent-cyan/40 to-transparent" />
      </div>

      {events.length === 0 ? (
        <p className="py-10 text-sm text-text-secondary">
          还没有收到 OpenRouter usage 数据。开一场带 AI audience 的直播后这里会开始累计。
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[900px] text-left text-sm">
            <thead className="font-[family-name:var(--font-pixel)] text-[8px] uppercase text-text-secondary">
              <tr className="border-b border-border-pixel">
                <th className="pb-3 pr-4 font-normal">time</th>
                <th className="pb-3 pr-4 font-normal">room</th>
                <th className="pb-3 pr-4 font-normal">persona</th>
                <th className="pb-3 pr-4 font-normal">operation</th>
                <th className="pb-3 pr-4 font-normal">decision</th>
                <th className="pb-3 pr-4 font-normal">cost</th>
                <th className="pb-3 pr-4 font-normal">tokens</th>
                <th className="pb-3 font-normal">context</th>
              </tr>
            </thead>
            <tbody>
              {events.map((event) => (
                <tr key={event.id} className="border-b border-border-pixel/50">
                  <td className="py-3 pr-4 text-text-secondary">
                    {formatTime(event.createdAt)}
                  </td>
                  <td className="py-3 pr-4 text-text-primary">
                    {event.roomSlug}
                  </td>
                  <td className="py-3 pr-4 text-accent-cyan">
                    {event.personaKey ?? "system"}
                  </td>
                  <td className="py-3 pr-4 text-text-secondary">
                    {operationLabel(event.operation)}
                  </td>
                  <td className="py-3 pr-4 text-text-secondary">
                    {decisionLabel(event.decision)}
                  </td>
                  <td className="py-3 pr-4 text-accent-yellow">
                    {formatCost(event.usage.cost ?? 0)}
                  </td>
                  <td className="py-3 pr-4 text-text-secondary">
                    {formatNumber(event.usage.total_tokens ?? 0)}
                  </td>
                  <td className="py-3 text-text-secondary">
                    {describeAiAudienceContext(event)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

export default async function AdminPage() {
  await connection();
  const { summary, error } = await loadUsageSummary();

  return (
    <div className="ambient-gradient min-h-screen">
      <div className="mx-auto max-w-[1400px] px-4 py-8">
        <header className="mb-8 flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <p className="font-[family-name:var(--font-pixel)] text-[9px] uppercase tracking-[0.4em] text-accent-pink glow-pink">
              Admin Console
            </p>
            <h1 className="mt-4 text-3xl font-semibold tracking-tight text-text-primary md:text-5xl">
              AI Audience Cost Monitor
            </h1>
            <p className="mt-3 max-w-3xl text-sm leading-6 text-text-secondary">
              基于 orchestrator 记录的 OpenRouter usage 汇总。生产环境写入
              Railway Postgres；数据库不可用时会降级展示当前进程内的临时数据，
              权限控制后续再补。
            </p>
          </div>
          <a
            href="/admin"
            className="pixel-btn w-fit border-accent-cyan text-accent-cyan"
          >
            refresh
          </a>
        </header>

        {error ? (
          <div className="mb-6 pixel-border border-accent-pink bg-accent-pink/10 p-4 text-sm text-text-primary">
            {error}
          </div>
        ) : null}

        <section className="mb-6 grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
          <MetricCard
            label="total cost"
            value={formatCost(summary.totals.totalCost)}
            detail={`${formatNumber(summary.totals.requests)} calls recorded`}
            accent="yellow"
          />
          <MetricCard
            label="total tokens"
            value={formatNumber(summary.totals.totalTokens)}
            detail={`${formatNumber(summary.totals.promptTokens)} input / ${formatNumber(summary.totals.completionTokens)} output`}
          />
          <MetricCard
            label="summary-backed"
            value={formatNumber(summary.totals.screenshotSummaryBackedRequests)}
            detail={`${formatNumber(summary.totals.imageAttachments)} direct image inputs / ${formatNumber(summary.totals.videoRequests)} video-attached calls / ${formatNumber(summary.totals.screenshotRequests)} screenshot-context calls`}
            accent="green"
          />
          <MetricCard
            label="cache + reasoning"
            value={formatNumber(
              summary.totals.cachedTokens + summary.totals.cacheWriteTokens,
            )}
            detail={`${formatNumber(summary.totals.reasoningTokens)} reasoning / ${formatNumber(summary.totals.audioTokens)} audio / ${formatNumber(summary.totals.videoTokens)} video tokens`}
            accent="pink"
          />
        </section>

        <section className="mb-6 grid grid-cols-1 gap-4 xl:grid-cols-2">
          <BucketTable
            title="按调用类型"
            rows={summary.byOperation}
            emptyLabel="暂无调用类型数据。"
          />
          <BucketTable
            title="按模型"
            rows={summary.byModel}
            emptyLabel="暂无模型数据。"
          />
          <BucketTable
            title="按 AI 观众"
            rows={summary.byPersona}
            emptyLabel="暂无 persona 数据。"
          />
          <BucketTable
            title="按直播间"
            rows={summary.byRoom}
            emptyLabel="暂无直播间数据。"
          />
        </section>

        <RecentEvents events={summary.recentEvents} />
      </div>
    </div>
  );
}
