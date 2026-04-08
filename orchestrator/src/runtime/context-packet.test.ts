import { describe, expect, it } from "vitest";

import { buildContextPacket } from "./context-packet.js";

describe("buildContextPacket", () => {
  it("assembles room metadata, recent assets, and inferred language", () => {
    expect(
      buildContextPacket({
        room: {
          slug: "demo-room",
          title: "中文标题",
          stage: "coding",
          codingTool: "cursor",
        },
        chatWindow: [{ user: "Ava", text: "looks good" }],
        audioWindow: ["Let's ship this first"],
        latestScreenshot: {
          url: "https://example.com/screen.png",
          capturedAt: 1000,
        },
        latestVideoClip: {
          url: "https://example.com/clip.mp4",
          capturedAt: 1500,
        },
      }),
    ).toMatchObject({
      room: {
        slug: "demo-room",
        title: "中文标题",
      },
      latestScreenshot: {
        url: "https://example.com/screen.png",
      },
      latestVideoClip: {
        url: "https://example.com/clip.mp4",
      },
      language: "en",
    });
  });
});
