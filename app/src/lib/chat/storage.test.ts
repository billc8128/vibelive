import { describe, expect, it } from "vitest";

import type { ChatTimelineMessage } from "./protocol";
import { restoreChatTimeline, serializeChatTimeline } from "./storage";

const baseMessages: ChatTimelineMessage[] = [
  {
    id: "1",
    user: "alice",
    text: "old session message",
    time: new Date("2026-04-08T13:00:00.000Z").getTime(),
  },
  {
    id: "2",
    user: "bob",
    text: "current session message",
    time: new Date("2026-04-08T13:10:00.000Z").getTime(),
  },
];

describe("chat storage", () => {
  it("drops persisted comments from a previous stream session", () => {
    const raw = serializeChatTimeline({
      messages: baseMessages,
      sessionStartedAt: "2026-04-08T13:00:00.000Z",
      now: new Date("2026-04-08T13:12:00.000Z").getTime(),
    });

    expect(
      restoreChatTimeline({
        raw,
        sessionStartedAt: "2026-04-08T13:09:00.000Z",
        now: new Date("2026-04-08T13:12:00.000Z").getTime(),
      }),
    ).toEqual([]);
  });

  it("keeps persisted comments for the same active stream session", () => {
    const raw = serializeChatTimeline({
      messages: baseMessages,
      sessionStartedAt: "2026-04-08T13:09:00.000Z",
      now: new Date("2026-04-08T13:12:00.000Z").getTime(),
    });

    expect(
      restoreChatTimeline({
        raw,
        sessionStartedAt: "2026-04-08T13:09:00.000Z",
        now: new Date("2026-04-08T13:12:00.000Z").getTime(),
      }),
    ).toEqual([baseMessages[1]]);
  });

  it("filters legacy stored arrays by the current stream start time", () => {
    expect(
      restoreChatTimeline({
        raw: JSON.stringify(baseMessages),
        sessionStartedAt: "2026-04-08T13:09:00.000Z",
        now: new Date("2026-04-08T13:12:00.000Z").getTime(),
      }),
    ).toEqual([baseMessages[1]]);
  });
});
