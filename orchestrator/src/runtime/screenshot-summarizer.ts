import type { OpenRouterModelConfig } from "../config.js";

export interface ScreenshotSummary {
  uiLanguage: "zh" | "en" | "mixed" | "unknown";
  primarySurface: "terminal" | "editor" | "browser" | "mixed" | "unknown";
  dominantSource:
    | "human_prompt"
    | "agent_output"
    | "mixed"
    | "unknown";
  humanPromptSummary: string;
  agentOutputSummary: string;
  currentTaskSummary: string;
  suggestedAngles: string[];
}

export interface ScreenshotSummarizer {
  summarize(imageUrl: string): Promise<ScreenshotSummary | null>;
}

function stripJsonFences(raw: string) {
  return raw
    .trim()
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/\s*```$/, "")
    .trim();
}

function extractFirstJsonObject(raw: string) {
  const source = stripJsonFences(raw);
  const start = source.indexOf("{");
  if (start === -1) {
    return source;
  }

  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let index = start; index < source.length; index += 1) {
    const char = source[index];

    if (inString) {
      if (escaped) {
        escaped = false;
        continue;
      }

      if (char === "\\") {
        escaped = true;
        continue;
      }

      if (char === '"') {
        inString = false;
      }

      continue;
    }

    if (char === '"') {
      inString = true;
      continue;
    }

    if (char === "{") {
      depth += 1;
      continue;
    }

    if (char === "}") {
      depth -= 1;
      if (depth === 0) {
        return source.slice(start, index + 1);
      }
    }
  }

  return source;
}

function extractMessageContent(payload: unknown): string {
  const content = (payload as {
    choices?: Array<{
      message?: {
        content?: string | Array<{ type?: string; text?: string }>;
      };
    }>;
  })?.choices?.[0]?.message?.content;

  if (typeof content === "string") {
    return content;
  }

  if (Array.isArray(content)) {
    return content
      .map((part) => (typeof part?.text === "string" ? part.text : ""))
      .join("")
      .trim();
  }

  throw new Error("Missing screenshot summary content");
}

function summarizeRawContent(raw: string) {
  const normalized = raw.replace(/\s+/g, " ").trim();
  if (normalized.length <= 240) {
    return normalized;
  }

  return `${normalized.slice(0, 240)}...`;
}

function normalizeSummary(
  input: Partial<ScreenshotSummary> | null | undefined,
): ScreenshotSummary {
  return {
    uiLanguage:
      input?.uiLanguage === "zh" ||
      input?.uiLanguage === "en" ||
      input?.uiLanguage === "mixed"
        ? input.uiLanguage
        : "unknown",
    primarySurface:
      input?.primarySurface === "terminal" ||
      input?.primarySurface === "editor" ||
      input?.primarySurface === "browser" ||
      input?.primarySurface === "mixed"
        ? input.primarySurface
        : "unknown",
    dominantSource:
      input?.dominantSource === "human_prompt" ||
      input?.dominantSource === "agent_output" ||
      input?.dominantSource === "mixed"
        ? input.dominantSource
        : "unknown",
    humanPromptSummary:
      typeof input?.humanPromptSummary === "string"
        ? input.humanPromptSummary.trim()
        : "",
    agentOutputSummary:
      typeof input?.agentOutputSummary === "string"
        ? input.agentOutputSummary.trim()
        : "",
    currentTaskSummary:
      typeof input?.currentTaskSummary === "string"
        ? input.currentTaskSummary.trim()
        : "",
    suggestedAngles: Array.isArray(input?.suggestedAngles)
      ? input.suggestedAngles
          .filter((value): value is string => typeof value === "string")
          .map((value) => value.trim())
          .filter(Boolean)
          .slice(0, 3)
      : [],
  };
}

export class OpenRouterScreenshotSummarizer implements ScreenshotSummarizer {
  private readonly apiUrl: string;

  constructor(
    private readonly config: Pick<
      OpenRouterModelConfig,
      "name" | "apiKey"
    > & {
      apiUrl?: string;
    },
    private readonly fetchImpl: typeof fetch = fetch,
  ) {
    this.apiUrl =
      config.apiUrl ?? "https://openrouter.ai/api/v1/chat/completions";
  }

  async summarize(imageUrl: string): Promise<ScreenshotSummary | null> {
    const response = await this.fetchImpl(this.apiUrl, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.config.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: this.config.name,
        temperature: 0.1,
        max_tokens: 220,
        messages: [
          {
            role: "system",
            content: [
              "Summarize one screenshot from a vibe coding livestream.",
              "Separate what the human streamer is asking from what the coding agent is outputting.",
              "Prefer concise semantic summaries over quoting screen text verbatim.",
              "Translate low-level hooks, logs, and bug text into higher-level viewer takeaways.",
              "uiLanguage must be one of zh, en, mixed, unknown.",
              "primarySurface must be one of terminal, editor, browser, mixed, unknown.",
              "dominantSource must be one of human_prompt, agent_output, mixed, unknown.",
              "Keep summary fields short and plain. Do not include quoted UI labels, filenames, or markdown.",
              "Return one compact JSON object with no markdown fences and no explanatory prose.",
            ].join(" "),
          },
          {
            role: "user",
            content: [
              {
                type: "text",
                text: JSON.stringify({
                  task:
                    "Extract structured screenshot context for a live coding chat assistant.",
                  fields: [
                    "uiLanguage",
                    "primarySurface",
                    "dominantSource",
                    "humanPromptSummary",
                    "agentOutputSummary",
                    "currentTaskSummary",
                    "suggestedAngles",
                  ],
                  fieldRules: {
                    uiLanguage: "Use zh, en, mixed, or unknown only.",
                    primarySurface:
                      "Use terminal, editor, browser, mixed, or unknown only.",
                    dominantSource:
                      "Use human_prompt when the streamer input is dominant, agent_output when the AI output is dominant, mixed when both matter, otherwise unknown.",
                    humanPromptSummary:
                      "Paraphrase the human ask in one short sentence. Empty string if unclear.",
                    agentOutputSummary:
                      "Paraphrase the coding-agent output in one short sentence. Empty string if unclear.",
                    currentTaskSummary:
                      "Describe what the streamer is trying to do right now in one short sentence at a viewer-friendly level.",
                    suggestedAngles:
                      "Suggested angles should sound like public-chat questions about tools, workflow, project stage, platform choice, or current blocker. Avoid hook names, error strings, line numbers, and low-level implementation details.",
                  },
                }),
              },
              {
                type: "image_url",
                image_url: {
                  url: imageUrl,
                },
              },
            ],
          },
        ],
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      const suffix = errorText.trim() ? ` ${errorText.trim()}` : "";
      throw new Error(
        `Screenshot summary request failed: ${response.status}${suffix}`,
      );
    }

    const payload = (await response.json()) as unknown;
    const raw = extractMessageContent(payload);

    try {
      return normalizeSummary(
        JSON.parse(extractFirstJsonObject(raw)) as Partial<ScreenshotSummary>,
      );
    } catch (error) {
      throw new Error(
        `Invalid screenshot summary JSON: ${summarizeRawContent(raw)}`,
        {
          cause: error,
        },
      );
    }
  }
}

export function createScreenshotSummarizer(
  config: OpenRouterModelConfig | null,
  fetchImpl: typeof fetch = fetch,
): ScreenshotSummarizer | null {
  if (config?.provider === "openrouter") {
    return new OpenRouterScreenshotSummarizer(config, fetchImpl);
  }

  return null;
}
