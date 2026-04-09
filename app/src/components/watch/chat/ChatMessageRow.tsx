import type { ChatTimelineMessage } from "@/lib/chat/protocol";
import { stickerUrl, STICKER_BY_ID } from "@/lib/stickers";

import { BotBadge } from "./BotBadge";

export function ChatMessageRow({
  message,
  timestampLabel,
}: {
  message: ChatTimelineMessage;
  timestampLabel: string;
}) {
  // Sticker message — render as a standalone large image, no text bubble.
  // Discord pattern: stickers don't fit on the same line as a username,
  // they get their own row with the sender's name above the image.
  if (message.stickerId && STICKER_BY_ID[message.stickerId]) {
    const sticker = STICKER_BY_ID[message.stickerId];
    return (
      <div className="text-xs">
        <div className="flex items-center gap-1.5 mb-1">
          <span className="text-text-secondary/40 text-[10px]">{timestampLabel}</span>
          <span className="text-accent-cyan font-medium">{message.user}</span>
          {message.bot && <BotBadge />}
        </div>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={stickerUrl(message.stickerId)}
          alt={sticker.label}
          className="w-[120px] h-[120px] block"
          draggable={false}
        />
      </div>
    );
  }

  return (
    <div className="text-xs">
      <span className="text-text-secondary/40 mr-1.5 text-[10px]">
        {timestampLabel}
      </span>
      <span className="text-accent-cyan font-medium">{message.user}</span>
      {message.bot && <BotBadge />}
      <span className="text-text-secondary mx-1">:</span>
      <span className="text-text-primary">{message.text}</span>
    </div>
  );
}
