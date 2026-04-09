interface LanguageInput {
  transcriptWindow: string[];
  chatWindow: Array<{ text: string }> | string[];
  roomTitle: string;
  screenshotLanguage?: string | null;
}

const LATIN_RE = /[A-Za-z]/;
const CJK_RE = /[\u3400-\u9fff]/;

function scoreLanguage(texts: string[]) {
  return texts.reduce(
    (acc, text) => {
      if (LATIN_RE.test(text)) acc.en += 1;
      if (CJK_RE.test(text)) acc.zh += 1;
      return acc;
    },
    { en: 0, zh: 0 },
  );
}

function pickLanguage(texts: string[]): string | null {
  const score = scoreLanguage(texts);
  if (!score.en && !score.zh) return null;
  return score.en >= score.zh ? "en" : "zh";
}

export function inferRoomLanguage(input: LanguageInput): string {
  const transcriptLanguage = pickLanguage(input.transcriptWindow);
  if (transcriptLanguage) return transcriptLanguage;

  if (input.screenshotLanguage === "zh" || input.screenshotLanguage === "en") {
    return input.screenshotLanguage;
  }

  const chatTexts = input.chatWindow.map((entry) =>
    typeof entry === "string" ? entry : entry.text,
  );
  const chatLanguage = pickLanguage(chatTexts);
  if (chatLanguage) return chatLanguage;

  return pickLanguage([input.roomTitle]) ?? "auto";
}
