import type { RoomRuntimeHandle } from "../types.js";

export class RoomManager {
  private runtimes = new Map<string, RoomRuntimeHandle>();

  register(roomSlug: string, runtime: RoomRuntimeHandle) {
    const existing = this.runtimes.get(roomSlug);
    if (existing && existing !== runtime) {
      void existing.stop();
    }

    this.runtimes.set(roomSlug, runtime);
    return runtime;
  }

  get(roomSlug: string) {
    return this.runtimes.get(roomSlug);
  }

  has(roomSlug: string) {
    return this.runtimes.has(roomSlug);
  }

  count() {
    return this.runtimes.size;
  }

  async stop(roomSlug: string) {
    const runtime = this.runtimes.get(roomSlug);
    if (!runtime) return false;

    this.runtimes.delete(roomSlug);
    await runtime.stop();
    return true;
  }
}
