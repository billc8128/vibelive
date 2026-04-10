import type { OpenRouterModelConfig } from "../config.js";
import type { ContextPacket } from "./context-packet.js";
import type { Persona } from "./personas.js";
import type { OpenRouterUsage } from "./usage-recorder.js";

export type AgentDecision =
  | { type: "hold"; usage?: OpenRouterUsage }
  | {
      type: "speak";
      text: string;
      target?: "streamer" | "viewer";
      reason?: string;
      usage?: OpenRouterUsage;
    };

export interface ModelClient {
  decide(persona: Persona, packet: ContextPacket): Promise<AgentDecision>;
}

function sampleLinesForLanguage(persona: Persona, language: string) {
  if (language === "zh") return persona.sampleLines.zh;
  if (language === "en") return persona.sampleLines.en;
  return [...persona.sampleLines.zh.slice(0, 1), ...persona.sampleLines.en.slice(0, 1)];
}

function buildSystemPrompt(persona: Persona, packet: ContextPacket) {
  const languageInstruction =
    packet.language === "zh"
      ? "Default to natural Chinese that matches the streamer room context."
      : packet.language === "en"
        ? "Default to natural English that matches the streamer room context."
        : "Infer the dominant language from the latest human chat, transcript, or screenshot UI text.";
  const sampleLines = sampleLinesForLanguage(persona, packet.language)
    .map((line) => `"${line}"`)
    .join(" | ");

  return [
    `You are ${persona.displayName}, ${persona.identity}.`,
    "You are watching a live vibe-coding stream and speaking in the public chat.",
    "Sound like a real livestream viewer, not an internal collaborator, product coach, or teammate.",
    `Voice traits: ${persona.voiceTraits.join("; ")}.`,
    `Avoid patterns: ${persona.avoidPatterns.join("; ")}.`,
    `Example lines: ${sampleLines}.`,
    "Treat visible IDE and terminal prose as coding-agent output unless the human is clearly typing it.",
    languageInstruction,
    "If the screenshot or recent human chat clearly uses another language, follow that instead of the inferred room language.",
    "If the screenshot UI is mostly Chinese, reply in Chinese.",
    "Prefer one concrete, streamer-facing observation, reaction, suggestion, or answerable question worth replying to.",
    "Use the screenshot, recent human chat, transcript, and screenshot summary to infer the streamer's current task at a higher level instead of copying nouns from the screen.",
    "If the streamer is reading external content, react to the takeaway, relevance, or why they opened it.",
    "Do not continue a bot-to-bot conversation.",
    "Do not pretend you personally know the streamer.",
    "Keep the comment short and conversational. Use one short sentence or one short question only.",
    "If you cannot tell what the streamer is doing, return hold.",
    "Do not mention being an AI unless the context explicitly requires it.",
    'Return strict JSON only. {"decision":"hold"} or {"decision":"speak","text":"...","target":"streamer"}',
  ].join(" ");
}

function buildUserPrompt(persona: Persona, packet: ContextPacket) {
  const recentHumanChat = packet.chatWindow.filter((message) => !message.bot);
  const recentBotChat = packet.chatWindow.filter((message) => message.bot);

  return JSON.stringify(
    {
      commentGoal:
        "Produce one audience-style chat line that feels natural in a live coding stream and helps the streamer keep talking.",
      persona: {
        key: persona.key,
        displayName: persona.displayName,
      },
      environment: {
        type: "live_coding_stream",
        productType: "vibe_coding_livestream",
        yourRole: "audience_member_in_public_chat",
        target: "streamer",
      },
      room: {
        ...packet.room,
        currentSituation:
          packet.latestScreenshot?.url
            ? "A fresh screenshot is attached. Treat it as the best clue for what the streamer is doing right now."
            : "No fresh screenshot is attached. Fall back to recent human chat and transcript.",
      },
      language: packet.language,
      recentHumanChat: recentHumanChat.slice(-10),
      recentBotChat: recentBotChat.slice(-6),
      recentAudio: packet.audioWindow.slice(-6),
      recentReactions: packet.reactionWindow.slice(-6),
      latestScreenshot: packet.latestScreenshot
        ? {
            capturedAt: packet.latestScreenshot.capturedAt,
            attached: true,
          }
        : null,
      latestScreenshotSummary: packet.latestScreenshotSummary,
      latestVideoClip: packet.latestVideoClip
        ? {
            capturedAt: packet.latestVideoClip.capturedAt,
            attached: true,
          }
        : null,
    },
    null,
    2,
  );
}

function buildUserMessageContent(persona: Persona, packet: ContextPacket) {
  const prompt = buildUserPrompt(persona, packet);
  if (!packet.latestScreenshot?.url && !packet.latestVideoClip?.url) {
    return prompt;
  }

  const content: Array<
    | { type: "text"; text: string }
    | { type: "image_url"; image_url: { url: string } }
    | { type: "video_url"; videoUrl: { url: string } }
  > = [
    {
      type: "text",
      text: prompt,
    },
  ];

  if (packet.latestScreenshot?.url) {
    content.push({
      type: "image_url",
      image_url: {
        url: packet.latestScreenshot.url,
      },
    });
  }

  if (packet.latestVideoClip?.url) {
    content.push({
      type: "video_url",
      videoUrl: {
        url: packet.latestVideoClip.url,
      },
    });
  }

  return content.length > 1 ? content : prompt;
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

  throw new Error("Missing model content");
}

function extractUsage(payload: unknown): OpenRouterUsage | undefined {
  const usage = (payload as { usage?: OpenRouterUsage })?.usage;
  if (!usage || typeof usage !== "object") {
    return undefined;
  }

  return usage;
}

function summarizeRawContent(raw: string) {
  const normalized = raw.replace(/\s+/g, " ").trim();
  if (normalized.length <= 240) {
    return normalized;
  }

  return `${normalized.slice(0, 240)}...`;
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

function parseDecision(raw: string): AgentDecision {
  const parsed = JSON.parse(extractFirstJsonObject(raw)) as {
    decision?: string;
    text?: string;
    target?: string;
  };

  if (parsed.decision === "hold") {
    return { type: "hold" };
  }

  if (parsed.decision === "speak" && typeof parsed.text === "string") {
    const text = parsed.text.trim();
    if (!text) {
      throw new Error("Empty speak text");
    }

    return {
      type: "speak",
      text,
      target: parsed.target === "viewer" ? "viewer" : "streamer",
      reason: "openrouter",
    };
  }

  throw new Error("Invalid model decision");
}

function toEnglishPrompt(persona: Persona, packet: ContextPacket) {
  const latestAudio = packet.audioWindow.at(-1);
  const latestChat = packet.chatWindow.at(-1)?.text;
  const roomFocus = packet.room.title || packet.room.stage;

  switch (persona.key) {
    case "curious":
      return latestAudio
        ? `What's the part you're still feeling out in "${latestAudio.slice(0, 48)}"?`
        : `What's the first thing you want to prove in ${roomFocus}?`;
    case "builder":
      return latestChat
        ? `Would you simplify "${latestChat.slice(0, 36)}" before building deeper?`
        : "This looks like a good spot to ship a smaller slice first.";
    case "product":
      return "This feels more like tightening the user experience than just fixing code.";
    case "beginner":
      return "If you were explaining this to a beginner, where would you start?";
    case "hype":
      return "Looks like you're wiring up a bigger thing now.";
  }
}

function toChinesePrompt(persona: Persona, packet: ContextPacket) {
  const latestAudio = packet.audioWindow.at(-1);
  const latestChat = packet.chatWindow.at(-1)?.text;
  const roomFocus = packet.room.title || packet.room.stage;

  switch (persona.key) {
    case "curious":
      return latestAudio
        ? `刚刚提到“${latestAudio.slice(0, 16)}”，你现在最没把握的是哪块？`
        : `你在 ${roomFocus} 这一步最想先验证什么？`;
    case "builder":
      return latestChat
        ? `“${latestChat.slice(0, 14)}”这块你会先砍小一点再做吗？`
        : "这块先跑通一个小切片感觉挺合理。";
    case "product":
      return "这更像是在收敛用户体验，不只是修技术细节。";
    case "beginner":
      return "如果现在给新手讲这段，你会先从哪层开始解释？";
    case "hype":
      return "主播好强，又在搞大事了。";
  }
}

export class HeuristicModelClient implements ModelClient {
  private readonly seenSignals = new Set<string>();

  async decide(persona: Persona, packet: ContextPacket): Promise<AgentDecision> {
    const signal =
      packet.audioWindow.at(-1) ||
      packet.chatWindow.at(-1)?.text ||
      `${packet.room.title}:${packet.room.stage}`;
    const seenKey = `${persona.key}:${signal}`;
    if (this.seenSignals.has(seenKey)) {
      return { type: "hold" };
    }

    const text =
      packet.language === "zh"
        ? toChinesePrompt(persona, packet)
        : toEnglishPrompt(persona, packet);
    if (!text) {
      return { type: "hold" };
    }

    this.seenSignals.add(seenKey);
    return {
      type: "speak",
      text,
      target: "streamer",
      reason: "heuristic-fallback",
    };
  }
}

export class OpenRouterModelClient implements ModelClient {
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

  async decide(persona: Persona, packet: ContextPacket): Promise<AgentDecision> {
    const response = await this.fetchImpl(this.apiUrl, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.config.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: this.config.name,
        temperature: 0.8,
        max_tokens: 150,
        messages: [
          {
            role: "system",
            content: buildSystemPrompt(persona, packet),
          },
          {
            role: "user",
            content: buildUserMessageContent(persona, packet),
          },
        ],
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      const suffix = errorText.trim() ? ` ${errorText.trim()}` : "";
      throw new Error(`OpenRouter request failed: ${response.status}${suffix}`);
    }

    const payload = (await response.json()) as unknown;
    const raw = extractMessageContent(payload);
    const usage = extractUsage(payload);

    try {
      const decision = parseDecision(raw);
      if (!usage) {
        return decision;
      }

      return {
        ...decision,
        usage,
      };
    } catch (error) {
      throw new Error(`Invalid model decision JSON: ${summarizeRawContent(raw)}`, {
        cause: error,
      });
    }
  }
}

export function createModelClient(
  config: OpenRouterModelConfig | null,
  fetchImpl: typeof fetch = fetch,
): ModelClient {
  if (config?.provider === "openrouter") {
    return new OpenRouterModelClient(config, fetchImpl);
  }

  return new HeuristicModelClient();
}

export class NullModelClient implements ModelClient {
  async decide(): Promise<AgentDecision> {
    return { type: "hold" };
  }
}
