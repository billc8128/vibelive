import { inferRoomLanguage } from "./language.js";
import type { ScreenshotSummary } from "./screenshot-summarizer.js";

export interface ContextRoom {
  slug: string;
  title: string;
  stage: string;
  codingTool: string;
}

export interface ContextChatMessage {
  user: string;
  text: string;
  bot?: boolean;
}

export interface ReactionSummary {
  kind: string;
  count: number;
}

export interface MediaCapture {
  url: string;
  capturedAt: number;
}

export interface ContextPacket {
  room: ContextRoom;
  chatWindow: ContextChatMessage[];
  reactionWindow: ReactionSummary[];
  audioWindow: string[];
  latestScreenshot: MediaCapture | null;
  latestScreenshotSummary: ScreenshotSummary | null;
  latestVideoClip: MediaCapture | null;
  language: string;
}

export interface ContextPacketInput {
  room: ContextRoom;
  chatWindow: ContextChatMessage[];
  reactionWindow?: ReactionSummary[];
  audioWindow?: string[];
  latestScreenshot?: MediaCapture | null;
  latestScreenshotSummary?: ScreenshotSummary | null;
  latestVideoClip?: MediaCapture | null;
}

export function buildContextPacket(input: ContextPacketInput): ContextPacket {
  const reactionWindow = input.reactionWindow ?? [];
  const audioWindow = input.audioWindow ?? [];
  const latestScreenshot = input.latestScreenshot ?? null;
  const latestScreenshotSummary = input.latestScreenshotSummary ?? null;
  const latestVideoClip = input.latestVideoClip ?? null;

  return {
    room: input.room,
    chatWindow: input.chatWindow,
    reactionWindow,
    audioWindow,
    latestScreenshot,
    latestScreenshotSummary,
    latestVideoClip,
    language: inferRoomLanguage({
      transcriptWindow: audioWindow,
      chatWindow: input.chatWindow,
      roomTitle: input.room.title,
      screenshotLanguage: latestScreenshotSummary?.uiLanguage,
    }),
  };
}
