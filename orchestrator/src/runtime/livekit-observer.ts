export class LiveKitObserver {
  private started = false;

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
}
