import type { ChatTimelineMessage } from "@/lib/chat/protocol";

import { BotBadge } from "./BotBadge";

export function ChatMessageRow({
  message,
  timestampLabel,
}: {
  message: ChatTimelineMessage;
  timestampLabel: string;
}) {
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
