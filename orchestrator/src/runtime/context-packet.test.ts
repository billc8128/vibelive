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

  it("prefers screenshot summary language when transcript and chat are absent", () => {
    expect(
      buildContextPacket({
        room: {
          slug: "demo-room",
          title: "",
          stage: "coding",
          codingTool: "cursor",
        },
        chatWindow: [],
        latestScreenshot: {
          url: "https://example.com/screen.png",
          capturedAt: 1000,
        },
        latestScreenshotSummary: {
          uiLanguage: "zh",
          primarySurface: "editor",
          dominantSource: "agent_output",
          humanPromptSummary: "主播正在要求 agent 调整规则",
          agentOutputSummary: "agent 正在解释 room runtime 调整",
          currentTaskSummary: "主播在迭代 AI audience 行为",
          suggestedAngles: ["为什么这么改 prompt"],
        },
      }),
    ).toMatchObject({
      language: "zh",
      latestScreenshotSummary: {
        uiLanguage: "zh",
      },
    });
  });
});
