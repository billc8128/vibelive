import type { ContextChatMessage, ReactionSummary } from "./context-packet.js";

export class LiveKitObserver {
  private started = false;
  private readonly chatWindow: ContextChatMessage[] = [];
  private readonly reactionCounts = new Map<string, number>();

  constructor(readonly roomSlug: string) {}

  async start() {
    this.started = true;
  }

  async stop() {
    this.started = false;
  }

  isStarted() {
    return this.started;
  }

  observeChatMessage(message: ContextChatMessage) {
    this.chatWindow.push(message);
    if (this.chatWindow.length > 20) {
      this.chatWindow.splice(0, this.chatWindow.length - 20);
    }
  }

  observeReaction(kind: string) {
    const current = this.reactionCounts.get(kind) ?? 0;
    this.reactionCounts.set(kind, current + 1);
  }

  getChatWindow() {
    return [...this.chatWindow];
  }

  getReactionWindow(): ReactionSummary[] {
    return [...this.reactionCounts.entries()].map(([kind, count]) => ({
      kind,
      count,
    }));
  }
}
