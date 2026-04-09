const DUPLICATE_COOLDOWN_MS = 90_000;
const ROOM_COOLDOWN_MS = 30_000;

function normalizeText(text: string) {
  return text.trim().toLowerCase();
}

export class MessageGate {
  private readonly lastTexts = new Map<string, number>();
  private lastAcceptedAt = 0;

  accept(_persona: string, text: string, now: number) {
    if (this.lastAcceptedAt && now - this.lastAcceptedAt < ROOM_COOLDOWN_MS) {
      return false;
    }

    const normalizedText = normalizeText(text);
    const seenAt = this.lastTexts.get(normalizedText);
    if (seenAt && now - seenAt < DUPLICATE_COOLDOWN_MS) {
      return false;
    }

    this.lastTexts.set(normalizedText, now);
    this.lastAcceptedAt = now;
    return true;
  }
}
