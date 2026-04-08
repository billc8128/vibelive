export class TranscriptWindow {
  private readonly entries: string[] = [];

  constructor(private readonly limit = 12) {}

  append(line: string) {
    this.entries.push(line);
    if (this.entries.length > this.limit) {
      this.entries.splice(0, this.entries.length - this.limit);
    }
  }

  getRecent() {
    return [...this.entries];
  }
}
