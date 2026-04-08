import type { BotChatMessage } from "../types.js";

export class ChatInjector {
  readonly published: BotChatMessage[] = [];

  constructor(readonly roomSlug: string) {}

  async publish(message: BotChatMessage) {
    this.published.push(message);
  }
}
