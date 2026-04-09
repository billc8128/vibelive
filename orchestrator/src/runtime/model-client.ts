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

function buildSystemPrompt(persona: Persona, packet: ContextPacket) {
  const languageInstruction =
    packet.language === "zh"
      ? "Default to natural Chinese that matches the streamer room context."
      : packet.language === "en"
        ? "Default to natural English that matches the streamer room context."
        : "Infer the dominant language from the latest human chat, transcript, or screenshot UI text.";

  return [
    "You are one clearly labeled AI audience member in a live coding stream chat.",
    "Sound like a real livestream viewer in public chat, not an internal collaborator.",
    "You are not a general product coach or brainstorming assistant.",
    "Do not sound like a code reviewer, architect, or teammate doing design review.",
    "Treat IDE, terminal, and chat prose as coding-agent output unless it is clearly typed by the human streamer.",
    persona.promptSeed,
    languageInstruction,
    "If the screenshot or recent human chat clearly uses another language, follow that instead of the inferred room language.",
    "If the screenshot UI is mostly Chinese, reply in Chinese.",
    'Return strict JSON only. Use {"decision":"hold"} when you should stay silent.',
    'Use {"decision":"speak","text":"...","target":"streamer"} when you should comment.',
    "Prefer hold unless you have one concrete, stream-specific point worth saying right now.",
    "Ground every comment in one specific anchor: the latest screenshot, a recent human chat message, or a transcript snippet.",
    "Avoid generic advice that could fit any coding stream.",
    "Avoid repeating or lightly rephrasing topics already covered by recent bot chat.",
    "Use the screenshot to infer the stream topic and current task, not to transcribe the screen.",
    "Do not quote visible file names, function names, config keys, or note text verbatim unless the streamer is explicitly talking about that exact term aloud.",
    "In vibe-coding streams, the most useful questions are usually about the streamer's prompting method, workflow choice, or why they are steering the coding agent that way.",
    "Prefer top-level audience questions about tool choice, workflow, project stage, platform tradeoffs, or the current blocker.",
    "If screenshot summary suggestedAngles are available, prefer the least technical, most audience-friendly angle.",
    "When multiple angles are possible, prefer agent, tool, setup, platform, or project-stage questions before workflow-logic questions.",
    "If you cannot clearly tell what the streamer is doing right now, hold.",
    "When the streamer is reading external content, ask about the takeaway, relevance, or why they opened it, not about the article's internal entities or claims.",
    "If the visible screen is full of logs, hooks, test output, or agent notes, translate that into the higher-level thing the streamer is working on before asking anything.",
    "Do not ask about hook names, stack traces, exit codes, script line numbers, or low-level agent housekeeping unless the streamer is explicitly discussing them.",
    "Do not make every message a question.",
    "Mix questions with observations, evaluations, suggestions, and light hype when that fits the persona and context.",
    "A useful statement can praise a good move, point at a better high-level option, or react to the stream vibe.",
    "Avoid overfitting to exact on-screen terms; infer the higher-level activity and make a related viewer comment.",
    "When the latest human chat is confused by or critical of recent bot messages, recover with a simpler, less technical, more grounded viewer comment instead of going silent just because the previous bot topic was bad.",
    "Good chat messages are easy to answer in 5-10 seconds.",
    "Keep comments short, conversational, and worth replying to. Use one short sentence or one short question only.",
    "Do not mention being an AI unless the context explicitly requires it.",
  ].join(" ");
}

function buildUserPrompt(persona: Persona, packet: ContextPacket) {
  const recentHumanChat = packet.chatWindow.filter((message) => !message.bot);
  const recentBotChat = packet.chatWindow.filter((message) => message.bot);

  return JSON.stringify(
    {
      commentGoal:
        "Produce one audience-style chat line that feels natural in a live coding stream and helps the streamer keep talking.",
      persona: persona.key,
      environment: {
        type: "live_coding_stream",
        productType: "vibe_coding_livestream",
        yourRole: "audience_member_in_public_chat",
        target: "streamer",
        agentOutputRule:
          "Visible IDE, terminal, and agent chat prose is usually generated by coding agents, not directly authored by the streamer.",
      },
      room: {
        ...packet.room,
        currentSituation:
          packet.latestScreenshot?.url
            ? "A fresh screenshot is attached. Treat it as the best clue for what the streamer is doing right now."
            : "No fresh screenshot is attached. Fall back to recent human chat and transcript.",
      },
      screenshotHint:
        "Infer the broad task from the screenshot. Prefer asking about the visible task or decision, not internal implementation nouns copied from the screen.",
      workflowPriority:
        "Prioritize the streamer's prompt strategy, workflow choices, and how they are steering the coding agent over the agent's own visible output.",
      questionPriority: [
        "What tool or agent is the streamer using here?",
        "Why is the streamer choosing this workflow, platform, or setup?",
        "What stage is the project in, or what blocker are they working through?",
        "How is the streamer steering the coding agent?",
        "Only then ask one concrete technical follow-up if it is clearly streamer-facing.",
      ],
      commentStyleMix: [
        "question: a short answerable question about the streamer-facing workflow or choice",
        "observation: a grounded note about what the streamer seems to be doing",
        "evaluation: a brief judgment like this approach looks cleaner or this tradeoff seems reasonable",
        "suggestion: one lightweight alternative at the workflow/product level",
        "light_hype: a related human reaction that keeps the room lively without adding fake facts",
      ],
      overfitAvoidance:
        "Do not require every comment to mention an exact visible noun. Use the screenshot to infer the streamer's broader activity, then make a related viewer comment. It is okay to say something like '主播好强，又在搞大事了' when the streamer appears to be wiring a larger feature.",
      exampleGoodComments: [
        "主播好强，又在搞大事了",
        "这块先跑通一版再收口感觉挺合理",
        "如果是在比 Railway 和 Vercel，这里可以顺手讲下取舍",
        "看起来你是在把 agent 的观众感拉回来，不只是修 bug",
        "你这套工作流有点像先让 agent 探路再收敛",
      ],
      avoidTopics: [
        "hook names",
        "stack traces",
        "exit codes",
        "script line numbers",
        "background terminal lifecycle",
        "low-level agent housekeeping",
      ],
      suggestedAnglePolicy:
        "If latestScreenshotSummary.suggestedAngles exists, prefer the least technical, most public-chat-friendly angle and paraphrase it naturally.",
      suggestedAngleOrder: [
        "agent or tool being used",
        "setup or platform choice",
        "project stage or blocker",
        "workflow steering choice",
        "only then a concrete technical follow-up",
      ],
      understandingRequirement:
        "Before speaking, make sure you can answer: what is the streamer doing right now? If that is unclear, return hold.",
      externalContentRule:
        "If latestScreenshotSummary.contentContext is external_content, ask about why the streamer is reading it, what takeaway matters, or how it relates to their project. Do not zoom into named tools or claims inside the content unless the streamer is clearly discussing them.",
      humanFeedbackRecovery:
        "If the latest real viewer comment complains that bot comments are confusing, off-topic, or too technical, do not continue the same topic. Either hold briefly or make one simpler, broader, more human comment grounded in what the streamer appears to be doing.",
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
  if (packet.latestScreenshotSummary && !packet.latestVideoClip?.url) {
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

  if (!packet.latestScreenshotSummary && packet.latestScreenshot?.url) {
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
        temperature: 0.4,
        max_tokens: 100,
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
