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

export interface BotChatMessage {
  user: string;
  text: string;
  bot?: boolean;
  botPersona?: string;
}

export interface RoomRuntimeHandle {
  stop(): Promise<void> | void;
}
