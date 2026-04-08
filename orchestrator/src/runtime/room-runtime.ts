import type { RuntimeSnapshot, StartRuntimePayload } from "../types.js";

import { ChatInjector } from "./chat-injector.js";
import { LiveKitObserver } from "./livekit-observer.js";

export class RoomRuntime {
  readonly roomSlug: string;
  private readonly startedAt: number;

  constructor(
    readonly payload: StartRuntimePayload,
    private readonly observer = new LiveKitObserver(payload.roomSlug),
    private readonly chatInjector = new ChatInjector(payload.roomSlug),
  ) {
    this.roomSlug = payload.roomSlug;
    this.startedAt = Date.now();
  }

  async start() {
    await this.observer.start();
  }

  async stop() {
    await this.observer.stop();
  }

  async tick() {
    return;
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
