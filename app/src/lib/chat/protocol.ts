const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

export interface RoomChatMessage {
  type: "chat";
  user: string;
  text: string;
  bot?: boolean;
  botPersona?: string;
}

export interface RoomReactionMessage {
  type: "reaction";
  kind: string;
  user: string;
}

export type RoomDataMessage = RoomChatMessage | RoomReactionMessage;

export interface ChatTimelineMessage {
  id: string;
  user: string;
  text: string;
  time: number;
  bot?: boolean;
  botPersona?: string;
}

export function isBotChatMessage(
  input: Partial<RoomChatMessage>,
): input is RoomChatMessage & { bot: true } {
  return input.type === "chat" && input.bot === true;
}

export function encodeRoomDataMessage(message: RoomDataMessage): Uint8Array {
  return textEncoder.encode(JSON.stringify(message));
}

export function parseRoomDataMessage(
  payload: Uint8Array | string,
): RoomDataMessage | null {
  const raw = typeof payload === "string" ? payload : textDecoder.decode(payload);

  try {
    const parsed = JSON.parse(raw) as Partial<RoomDataMessage>;
    if (parsed.type === "chat" && typeof parsed.user === "string") {
      return {
        type: "chat",
        user: parsed.user,
        text: typeof parsed.text === "string" ? parsed.text : "",
        bot: parsed.bot === true,
        botPersona:
          typeof parsed.botPersona === "string" ? parsed.botPersona : undefined,
      };
    }

    if (
      parsed.type === "reaction" &&
      typeof parsed.user === "string" &&
      typeof parsed.kind === "string"
    ) {
      return {
        type: "reaction",
        kind: parsed.kind,
        user: parsed.user,
      };
    }
  } catch {}

  return null;
}
