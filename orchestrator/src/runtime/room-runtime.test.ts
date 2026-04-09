import { afterEach, describe, expect, it, vi } from "vitest";

import { ChatInjector } from "./chat-injector.js";
import { AgentRunner } from "./agent-runner.js";
import { pickTickDelayMs, RoomRuntime } from "./room-runtime.js";
import { NullModelClient, type ModelClient } from "./model-client.js";
import type { ContextPacket } from "./context-packet.js";
import type { Persona } from "./personas.js";
import type { ScreenshotSummary } from "./screenshot-summarizer.js";

describe("RoomRuntime", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("uses jittered tick delays based on audience intensity", () => {
    expect(pickTickDelayMs("low", 0)).toBe(45_000);
    expect(pickTickDelayMs("low", 1)).toBe(90_000);
    expect(pickTickDelayMs("medium", 0)).toBe(35_000);
    expect(pickTickDelayMs("medium", 1)).toBe(75_000);
    expect(pickTickDelayMs("high", 0)).toBe(25_000);
    expect(pickTickDelayMs("high", 1)).toBe(60_000);
  });

  it("skips message publish when no screenshot is available but continues running", async () => {
    const runtime = new RoomRuntime({
      roomSlug: "demo-room",
      roomTitle: "Demo Room",
      projectStage: "coding",
      codingTool: "cursor",
    }, {
      agentRunner: new AgentRunner(new NullModelClient()),
      chatInjector: new ChatInjector("demo-room", null),
    });

    await expect(runtime.tick()).resolves.toBeUndefined();
  });

  it("publishes bot messages when an agent decides to speak", async () => {
    class SpeakOnceModelClient implements ModelClient {
      async decide(persona: Persona, _packet: ContextPacket) {
        if (persona.key !== "curious") return { type: "hold" } as const;

        return {
          type: "speak" as const,
          text: "Why not ship a narrower MVP first?",
        };
      }
    }

    const chatInjector = new ChatInjector("demo-room", null);
    const runtime = new RoomRuntime(
      {
        roomSlug: "demo-room",
        roomTitle: "Demo Room",
        projectStage: "coding",
        codingTool: "cursor",
      },
      {
        agentRunner: new AgentRunner(new SpeakOnceModelClient()),
        chatInjector,
      },
    );

    await runtime.tick();

    expect(chatInjector.published).toContainEqual(
      expect.objectContaining({
        user: "Nova",
        text: "Why not ship a narrower MVP first?",
        bot: true,
        botPersona: "curious",
      }),
    );
  });

  it("rotates speaking personas across ticks instead of always starting from the first persona", async () => {
    class EveryoneSpeaksModelClient implements ModelClient {
      async decide(persona: Persona) {
        return {
          type: "speak" as const,
          text: `question-from-${persona.key}`,
        };
      }
    }

    let nowValue = 0;
    const chatInjector = new ChatInjector("demo-room", null);
    const runtime = new RoomRuntime(
      {
        roomSlug: "demo-room",
        roomTitle: "Demo Room",
        projectStage: "coding",
        codingTool: "cursor",
      },
      {
        agentRunner: new AgentRunner(new EveryoneSpeaksModelClient()),
        chatInjector,
        now: () => {
          nowValue += 31_000;
          return nowValue;
        },
      },
    );

    await runtime.tick();
    await runtime.tick();

    expect(chatInjector.published[0]).toMatchObject({
      user: "Nova",
      botPersona: "curious",
      text: "question-from-curious",
    });
    expect(chatInjector.published[1]).toMatchObject({
      user: "Patch",
      botPersona: "builder",
      text: "question-from-builder",
    });
  });

  it("feeds mirrored chat messages and screenshots into the next model packet", async () => {
    vi.spyOn(console, "info").mockImplementation(() => undefined);
    let seenPacket: ContextPacket | null = null;
    const screenshotSummary: ScreenshotSummary = {
      uiLanguage: "zh",
      primarySurface: "terminal",
      dominantSource: "agent_output",
      contentContext: "streamer_workspace",
      activityConfidence: "high",
      streamerActivity: "主播在调试 AI audience",
      humanPromptSummary: "主播要求 agent 调整规则",
      agentOutputSummary: "agent 正在解释 runtime 行为",
      currentTaskSummary: "主播在调试 AI audience",
      suggestedAngles: ["为什么先动 prompt"],
    };

    class CapturePacketModelClient implements ModelClient {
      async decide(_persona: Persona, packet: ContextPacket) {
        seenPacket = packet;
        return { type: "hold" } as const;
      }
    }

    const runtime = new RoomRuntime(
      {
        roomSlug: "demo-room",
        roomTitle: "Demo Room",
        projectStage: "coding",
        codingTool: "cursor",
      },
      {
        agentRunner: new AgentRunner(new CapturePacketModelClient()),
        chatInjector: new ChatInjector("demo-room", null),
        screenshotSummarizer: {
          summarize: async () => screenshotSummary,
        },
      },
    );

    runtime.ingestContextEvent({
      kind: "chat_message",
      roomSlug: "demo-room",
      user: "alice",
      text: "Can you split auth and chat first?",
    });
    await runtime.ingestContextEvent({
      kind: "screenshot",
      roomSlug: "demo-room",
      url: "data:image/jpeg;base64,abc123",
      capturedAt: 123456,
    });

    await runtime.tick();

    expect(seenPacket).not.toBeNull();
    expect(seenPacket!.chatWindow).toContainEqual({
      user: "alice",
      text: "Can you split auth and chat first?",
      bot: false,
    });
    expect(seenPacket!.latestScreenshot).toEqual({
      url: "data:image/jpeg;base64,abc123",
      capturedAt: 123456,
    });
    expect(seenPacket!.latestScreenshotSummary).toEqual(screenshotSummary);
  });

  it("logs when every persona holds instead of publishing", async () => {
    const infoSpy = vi.spyOn(console, "info").mockImplementation(() => undefined);
    const runtime = new RoomRuntime(
      {
        roomSlug: "demo-room",
        roomTitle: "Demo Room",
        projectStage: "coding",
        codingTool: "cursor",
      },
      {
        agentRunner: new AgentRunner(new NullModelClient()),
        chatInjector: new ChatInjector("demo-room", null),
      },
    );

    await runtime.ingestContextEvent({
      kind: "chat_message",
      roomSlug: "demo-room",
      user: "alice",
      text: "你们说的都是什么东西",
      bot: false,
    });
    await runtime.tick();

    expect(infoSpy).toHaveBeenCalledWith(
      "ai audience tick skipped",
      expect.objectContaining({
        roomSlug: "demo-room",
        reason: "all_agents_held",
        humanChatCount: 1,
        botChatCount: 0,
      }),
    );
  });
});
