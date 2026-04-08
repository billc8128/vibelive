const DUPLICATE_COOLDOWN_MS = 15_000;

function normalizeText(text: string) {
  return text.trim().toLowerCase();
}

export class MessageGate {
  private readonly lastTexts = new Map<string, number>();

  accept(_persona: string, text: string, now: number) {
    const normalizedText = normalizeText(text);
    const seenAt = this.lastTexts.get(normalizedText);
    if (seenAt && now - seenAt < DUPLICATE_COOLDOWN_MS) {
      return false;
    }

    this.lastTexts.set(normalizedText, now);
    return true;
  }
}
