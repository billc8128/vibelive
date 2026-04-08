import type { ContextPacket } from "./context-packet.js";
import type { Persona } from "./personas.js";

export type AgentDecision =
  | { type: "hold" }
  | {
      type: "speak";
      text: string;
      target?: "streamer" | "viewer";
      reason?: string;
    };

export interface ModelClient {
  decide(persona: Persona, packet: ContextPacket): Promise<AgentDecision>;
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
        : `Would you split this stage into a smaller pass first?`;
    case "product":
      return "If you only ship one user win today, what would it be?";
    case "beginner":
      return "If you were explaining this to a beginner, where would you start?";
    case "hype":
      return "This direction feels promising, are you aiming for a usable slice first?";
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
        : "这里会先切一个更小的 pass 再继续吗？";
    case "product":
      return "如果今天只能交付一个用户价值点，你会先做哪个？";
    case "beginner":
      return "如果现在给新手讲这段，你会先从哪层开始解释？";
    case "hype":
      return "这个方向有点意思，你是准备先做出一个可用切片吗？";
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

export class NullModelClient implements ModelClient {
  async decide(): Promise<AgentDecision> {
    return { type: "hold" };
  }
}
