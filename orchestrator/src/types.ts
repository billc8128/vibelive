export type AiAudienceIntensity = "low" | "medium" | "high";

export interface AiAudienceRuntimeSettings {
  enabled: boolean;
  count: number;
  intensity: AiAudienceIntensity;
}

export interface StartRuntimePayload {
  roomSlug: string;
  channelId?: string;
  roomTitle?: string;
  projectStage?: string;
  codingTool?: string;
  aiAudience?: AiAudienceRuntimeSettings;
}

export interface StopRuntimePayload {
  roomSlug: string;
}

export interface RuntimeSnapshot {
  roomSlug: string;
  startedAt: number;
}

export interface ChatContextEvent {
  kind: "chat_message";
  roomSlug: string;
  user: string;
  text: string;
  bot?: boolean;
}

export interface ReactionContextEvent {
  kind: "reaction";
  roomSlug: string;
  reactionKind: string;
  user: string;
}

export interface ScreenshotContextEvent {
  kind: "screenshot";
  roomSlug: string;
  url: string;
  capturedAt: number;
}

export interface VideoClipContextEvent {
  kind: "video_clip";
  roomSlug: string;
  url: string;
  capturedAt: number;
}

export type RuntimeContextEvent =
  | ChatContextEvent
  | ReactionContextEvent
  | ScreenshotContextEvent
  | VideoClipContextEvent;

export interface BotChatMessage {
  user: string;
  text: string;
  bot?: boolean;
  botPersona?: string;
}

export interface RoomRuntimeHandle {
  stop(): Promise<void> | void;
  ingestContextEvent?(event: RuntimeContextEvent): Promise<void> | void;
}
