import type { RuntimeSnapshot, StartRuntimePayload } from "../types.js";

import { buildContextPacket } from "./context-packet.js";
import { MessageGate } from "./message-gate.js";
import { AgentRunner } from "./agent-runner.js";
import { ChatInjector } from "./chat-injector.js";
import { LiveKitObserver } from "./livekit-observer.js";
import { PERSONAS } from "./personas.js";
import { MediaSnapshotter } from "./media-snapshotter.js";
import { TranscriptWindow } from "./transcript-window.js";

interface RoomRuntimeDependencies {
  observer?: LiveKitObserver;
  chatInjector?: ChatInjector;
  agentRunner?: AgentRunner;
  gate?: MessageGate;
  mediaSnapshotter?: MediaSnapshotter;
  transcriptWindow?: TranscriptWindow;
  now?: () => number;
  tickIntervalMs?: number;
}

export class RoomRuntime {
  readonly roomSlug: string;
  private readonly startedAt: number;
  private readonly observer: LiveKitObserver;
  private readonly chatInjector: ChatInjector;
  private readonly agentRunner: AgentRunner;
  private readonly gate: MessageGate;
  private readonly mediaSnapshotter: MediaSnapshotter;
  private readonly transcriptWindow: TranscriptWindow;
  private readonly now: () => number;
  private readonly tickIntervalMs: number;
  private tickTimer: ReturnType<typeof setInterval> | null = null;

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
    this.transcriptWindow = deps.transcriptWindow ?? new TranscriptWindow();
    this.now = deps.now ?? Date.now;
    this.tickIntervalMs = deps.tickIntervalMs ?? 15_000;
  }

  async start() {
    await this.observer.start();
    if (!this.tickTimer) {
      this.tickTimer = setInterval(() => {
        void this.tick();
      }, this.tickIntervalMs);
    }
  }

  async stop() {
    if (this.tickTimer) {
      clearInterval(this.tickTimer);
      this.tickTimer = null;
    }
    await this.observer.stop();
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
      latestVideoClip: media.latestVideoClip,
    });

    for (const persona of PERSONAS) {
      const decision = await this.agentRunner.decide(persona, packet);
      if (decision.type !== "speak") continue;
      if (!this.gate.accept(persona.key, decision.text, this.now())) continue;

      await this.chatInjector.publish({
        user: persona.displayName,
        text: decision.text,
        bot: true,
        botPersona: persona.key,
      });
      break;
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
}
