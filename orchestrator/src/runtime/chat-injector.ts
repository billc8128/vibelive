import { DataPacket_Kind, RoomServiceClient } from "livekit-server-sdk";

import type { BotChatMessage } from "../types.js";

const textEncoder = new TextEncoder();

interface DataPublisher {
  sendData(roomSlug: string, data: Uint8Array): Promise<void>;
}

function createLiveKitPublisherFromEnv(): DataPublisher | null {
  const livekitUrl = process.env.NEXT_PUBLIC_LIVEKIT_URL;
  const apiKey = process.env.LIVEKIT_API_KEY;
  const apiSecret = process.env.LIVEKIT_API_SECRET;
  if (!livekitUrl || !apiKey || !apiSecret) {
    return null;
  }

  const client = new RoomServiceClient(livekitUrl, apiKey, apiSecret);
  return {
    async sendData(roomSlug: string, data: Uint8Array) {
      await client.sendData(roomSlug, data, DataPacket_Kind.RELIABLE, {});
    },
  };
}

export class ChatInjector {
  readonly published: BotChatMessage[] = [];

  constructor(
    readonly roomSlug: string,
    private readonly publisher: DataPublisher | null = createLiveKitPublisherFromEnv(),
  ) {}

  async publish(message: BotChatMessage) {
    this.published.push(message);

    if (!this.publisher) return;

    try {
      await this.publisher.sendData(
        this.roomSlug,
        textEncoder.encode(
          JSON.stringify({
            type: "chat",
            user: message.user,
            text: message.text,
            bot: message.bot === true,
            botPersona: message.botPersona,
          }),
        ),
      );
    } catch (error) {
      console.warn("chat injection failed", {
        roomSlug: this.roomSlug,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
}
