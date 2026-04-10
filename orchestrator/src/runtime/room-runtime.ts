import type {
  RuntimeContextEvent,
  RuntimeSnapshot,
  StartRuntimePayload,
} from "../types.js";

import { buildContextPacket } from "./context-packet.js";
import { MessageGate } from "./message-gate.js";
import { AgentRunner } from "./agent-runner.js";
import { ChatInjector } from "./chat-injector.js";
import { LiveKitObserver } from "./livekit-observer.js";
import { PERSONAS } from "./personas.js";
import { MediaSnapshotter } from "./media-snapshotter.js";
import {
  createScreenshotSummarizer,
  type ScreenshotSummarizer,
} from "./screenshot-summarizer.js";
import { TranscriptWindow } from "./transcript-window.js";
import { readConfig, type OpenRouterModelConfig } from "../config.js";
import type { AiAudienceIntensity } from "../types.js";
import {
  usageRecorder,
  type OpenRouterUsage,
  type UsageRecorder,
  type UsageOperation,
} from "./usage-recorder.js";

interface RoomRuntimeDependencies {
  observer?: LiveKitObserver;
  chatInjector?: ChatInjector;
  agentRunner?: AgentRunner;
  gate?: MessageGate;
  mediaSnapshotter?: MediaSnapshotter;
  screenshotSummarizer?: ScreenshotSummarizer | null;
  transcriptWindow?: TranscriptWindow;
  usageRecorder?: UsageRecorder;
  now?: () => number;
  random?: () => number;
}

const TICK_DELAY_RANGES_MS: Record<AiAudienceIntensity, [number, number]> = {
  low: [45_000, 90_000],
  medium: [35_000, 75_000],
  high: [25_000, 60_000],
};

export function pickTickDelayMs(
  intensity: AiAudienceIntensity = "medium",
  randomValue: number,
) {
  const [min, max] = TICK_DELAY_RANGES_MS[intensity] ?? TICK_DELAY_RANGES_MS.medium;
  const clamped = Math.min(Math.max(randomValue, 0), 1);
  return Math.round(min + (max - min) * clamped);
}

export class RoomRuntime {
  readonly roomSlug: string;
  private readonly startedAt: number;
  private readonly observer: LiveKitObserver;
  private readonly chatInjector: ChatInjector;
  private readonly agentRunner: AgentRunner;
  private readonly gate: MessageGate;
  private readonly mediaSnapshotter: MediaSnapshotter;
  private readonly screenshotSummarizer: ScreenshotSummarizer | null;
  private readonly transcriptWindow: TranscriptWindow;
  private readonly usageRecorder: UsageRecorder;
  private readonly modelConfig: OpenRouterModelConfig | null;
  private readonly now: () => number;
  private readonly random: () => number;
  private personaCursor = 0;
  private tickTimer: ReturnType<typeof setTimeout> | null = null;
  private stopped = false;

  constructor(
    readonly payload: StartRuntimePayload,
    deps: RoomRuntimeDependencies = {},
  ) {
    this.roomSlug = payload.roomSlug;
    this.startedAt = Date.now();
    this.observer = deps.observer ?? new LiveKitObserver(payload.roomSlug);
    this.chatInjector = deps.chatInjector ?? new ChatInjector(payload.roomSlug);
    this.agentRunner = deps.agentRunner ?? new AgentRunner();
    this.gate = deps.gate ?? new MessageGate();
    this.mediaSnapshotter = deps.mediaSnapshotter ?? new MediaSnapshotter();
    this.modelConfig = readConfig().model;
    this.screenshotSummarizer =
      deps.screenshotSummarizer ?? createScreenshotSummarizer(this.modelConfig);
    this.transcriptWindow = deps.transcriptWindow ?? new TranscriptWindow();
    this.usageRecorder = deps.usageRecorder ?? usageRecorder;
    this.now = deps.now ?? Date.now;
    this.random = deps.random ?? Math.random;
  }

  async start() {
    this.stopped = false;
    await this.observer.start();
    if (!this.payload.clientDriven && !this.tickTimer) {
      this.scheduleNextTick();
    }
  }

  async stop() {
    this.stopped = true;
    if (this.tickTimer) {
      clearTimeout(this.tickTimer);
      this.tickTimer = null;
    }
    await this.observer.stop();
  }

  private scheduleNextTick() {
    const intensity = this.payload.aiAudience?.intensity ?? "medium";
    const delay = pickTickDelayMs(intensity, this.random());
    this.tickTimer = setTimeout(() => {
      this.tickTimer = null;
      void this.runScheduledTick();
    }, delay);
  }

  private async runScheduledTick() {
    await this.tick();
    if (!this.stopped) {
      this.scheduleNextTick();
    }
  }

  async tick() {
    const media = this.mediaSnapshotter.snapshot();
    const packet = buildContextPacket({
      room: {
        slug: this.payload.roomSlug,
        title: this.payload.roomTitle ?? this.payload.roomSlug,
        stage: this.payload.projectStage ?? "coding",
        codingTool: this.payload.codingTool ?? "other",
      },
      chatWindow: this.observer.getChatWindow(),
      reactionWindow: this.observer.getReactionWindow(),
      audioWindow: this.transcriptWindow.getRecent(),
      latestScreenshot: media.latestScreenshot,
      latestScreenshotSummary: media.latestScreenshotSummary,
      latestVideoClip: media.latestVideoClip,
    });

    const startIndex = this.personaCursor;
    const orderedPersonas = PERSONAS.slice(startIndex).concat(
      PERSONAS.slice(0, startIndex),
    );
    this.personaCursor = (startIndex + 1) % PERSONAS.length;

    let heldCount = 0;
    let gateRejectedCount = 0;
    for (const persona of orderedPersonas) {
      const decision = await this.agentRunner.decide(persona, packet);
      this.recordUsage("agent_decide", decision.usage, {
        personaKey: persona.key,
        decision: decision.type,
        hasScreenshot:
          !!packet.latestScreenshot || !!packet.latestScreenshotSummary,
        hasVideo: !!packet.latestVideoClip,
        attachedImage: !!packet.latestScreenshot,
        usedScreenshotSummary: !!packet.latestScreenshotSummary,
      });
      if (decision.type !== "speak") {
        heldCount += 1;
        continue;
      }

      if (!this.gate.accept(persona.key, decision.text, this.now())) {
        gateRejectedCount += 1;
        continue;
      }

      await this.chatInjector.publish({
        user: persona.displayName,
        text: decision.text,
        bot: true,
        botPersona: persona.key,
      });
      this.observer.observeChatMessage({
        user: persona.displayName,
        text: decision.text,
        bot: true,
      });
      break;
    }

    const humanChatCount = packet.chatWindow.filter((message) => !message.bot)
      .length;
    const botChatCount = packet.chatWindow.filter((message) => message.bot)
      .length;
    const hasContextToDebug =
      humanChatCount > 0 ||
      botChatCount > 0 ||
      !!packet.latestScreenshot ||
      !!packet.latestScreenshotSummary;

    if (
      heldCount + gateRejectedCount >= orderedPersonas.length &&
      hasContextToDebug
    ) {
      console.info("ai audience tick skipped", {
        roomSlug: this.roomSlug,
        reason: gateRejectedCount > 0 ? "gate_rejected" : "all_agents_held",
        humanChatCount,
        botChatCount,
        heldCount,
        gateRejectedCount,
        screenshotAttached: !!packet.latestScreenshot,
        screenshotSummaryAttached: !!packet.latestScreenshotSummary,
      });
    }
  }

  async ingestContextEvent(event: RuntimeContextEvent) {
    switch (event.kind) {
      case "chat_message":
        this.observer.observeChatMessage({
          user: event.user,
          text: event.text,
          bot: event.bot === true,
        });
        return;
      case "reaction":
        this.observer.observeReaction(event.reactionKind);
        return;
      case "screenshot":
        this.mediaSnapshotter.setLatestScreenshot({
          url: event.url,
          capturedAt: event.capturedAt,
        });
        if (this.screenshotSummarizer) {
          try {
            const summary = await this.screenshotSummarizer.summarize(event.url);
            this.mediaSnapshotter.setLatestScreenshotSummary(summary);
            this.recordUsage(
              "screenshot_summary",
              this.screenshotSummarizer.getLastUsage?.() ?? null,
              {
                decision: summary ? "summary" : "hold",
                hasScreenshot: true,
                hasVideo: false,
                attachedImage: true,
                usedScreenshotSummary: false,
              },
            );
          } catch (error) {
            console.warn("screenshot summary failed", {
              roomSlug: this.roomSlug,
              error: error instanceof Error ? error.message : String(error),
            });
            this.mediaSnapshotter.setLatestScreenshotSummary(null);
          }
        }
        return;
      case "video_clip":
        this.mediaSnapshotter.setLatestVideoClip({
          url: event.url,
          capturedAt: event.capturedAt,
        });
        return;
    }
  }

  status(): RuntimeSnapshot {
    return {
      roomSlug: this.roomSlug,
      startedAt: this.startedAt,
    };
  }

  getChatInjector() {
    return this.chatInjector;
  }

  private recordUsage(
    operation: UsageOperation,
    usage: OpenRouterUsage | null | undefined,
    metadata: {
      personaKey?: string;
      decision?: string;
      hasScreenshot: boolean;
      hasVideo: boolean;
      attachedImage: boolean;
      usedScreenshotSummary: boolean;
    },
  ) {
    if (!usage) {
      return;
    }

    void Promise.resolve(
      this.usageRecorder.record({
        roomSlug: this.roomSlug,
        channelId: this.payload.channelId,
        operation,
        personaKey: metadata.personaKey,
        modelProvider: this.modelConfig?.provider ?? "unknown",
        modelName: this.modelConfig?.name ?? "unknown",
        decision: metadata.decision,
        hasScreenshot: metadata.hasScreenshot,
        hasVideo: metadata.hasVideo,
        attachedImage: metadata.attachedImage,
        usedScreenshotSummary: metadata.usedScreenshotSummary,
        usage,
      }),
    ).catch((error) => {
      console.warn("ai audience usage record failed", {
        roomSlug: this.roomSlug,
        operation,
        error: error instanceof Error ? error.message : String(error),
      });
    });
  }
}
