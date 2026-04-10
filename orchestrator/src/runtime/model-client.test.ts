import { describe, expect, it, vi } from "vitest";

import { buildContextPacket } from "./context-packet.js";
import { OpenRouterModelClient } from "./model-client.js";
import { PERSONAS } from "./personas.js";

describe("OpenRouterModelClient", () => {
  it("sends a chat completions request and parses a speak decision", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          usage: {
            prompt_tokens: 1200,
            completion_tokens: 60,
            total_tokens: 1260,
            cost: 0.00078,
          },
          choices: [
            {
              message: {
                content:
                  '{"decision":"speak","text":"Would you split this into a smaller pass first?","target":"streamer"}',
              },
            },
          ],
        }),
        {
          status: 200,
          headers: { "content-type": "application/json" },
        },
      ),
    );

    const client = new OpenRouterModelClient(
      {
        name: "anthropic/claude-sonnet-4.6",
        apiKey: "test-key",
      },
      fetchMock as typeof fetch,
    );

    const packet = buildContextPacket({
      room: {
        slug: "demo-room",
        title: "Build an AI code stream",
        stage: "coding",
        codingTool: "cursor",
      },
      chatWindow: [{ user: "viewer", text: "Could this be smaller?" }],
      audioWindow: ["I think this stage may be too wide."],
    });

    const decision = await client.decide(PERSONAS[1], packet);

    expect(decision).toEqual({
      type: "speak",
      text: "Would you split this into a smaller pass first?",
      target: "streamer",
      reason: "openrouter",
      usage: {
        prompt_tokens: 1200,
        completion_tokens: 60,
        total_tokens: 1260,
        cost: 0.00078,
      },
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith(
      "https://openrouter.ai/api/v1/chat/completions",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          Authorization: "Bearer test-key",
          "Content-Type": "application/json",
        }),
      }),
    );

    const [, requestInit] = fetchMock.mock.calls[0] as [
      string,
      RequestInit | undefined,
    ];
    const body = JSON.parse(String(requestInit?.body)) as {
      model: string;
      temperature: number;
      max_tokens: number;
      reasoning?: { effort: string };
      response_format?: { type: string };
      messages: Array<{ role: string; content: unknown }>;
    };

    expect(body.model).toBe("anthropic/claude-sonnet-4.6");
    expect(body.temperature).toBe(0.8);
    expect(body.max_tokens).toBe(150);
    expect(body.reasoning).toEqual({ effort: "medium" });
    expect(body).not.toHaveProperty("response_format");
    expect(body.messages[0]?.content).toContain(
      "You are Patch",
    );
    expect(body.messages[0]?.content).toContain(
      "You are watching a live vibe-coding stream and speaking in the public chat.",
    );
    expect(body.messages[0]?.content).toContain(
      "Voice traits:",
    );
    expect(body.messages[0]?.content).toContain(
      "Example lines:",
    );
    expect(body.messages[0]?.content).toContain(
      "If the screenshot UI is mostly Chinese, reply in Chinese.",
    );
    expect(body.messages[0]?.content).toContain(
      'Return strict JSON only. {"decision":"hold"} or {"decision":"speak","text":"...","target":"streamer"}',
    );
    expect(body.messages[0]?.content).toContain(
      "Treat visible IDE and terminal prose as coding-agent output unless the human is clearly typing it.",
    );
    expect(body.messages[0]?.content).toContain(
      "Do not continue a bot-to-bot conversation.",
    );
    expect(body.messages[0]?.content).toContain(
      "If you cannot tell what the streamer is doing, return hold.",
    );
    expect(body.messages[0]?.content).not.toContain("Do not quote visible file names");
    expect(body.messages[0]?.content).not.toContain("Do not ask about hook names");
  });

  it("keeps the screenshot summary in text context and also attaches the raw image", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content: '{"decision":"hold"}',
              },
            },
          ],
        }),
        {
          status: 200,
          headers: { "content-type": "application/json" },
        },
      ),
    );

    const client = new OpenRouterModelClient(
      {
        name: "anthropic/claude-sonnet-4.6",
        apiKey: "test-key",
      },
      fetchMock as typeof fetch,
    );

    const packet = buildContextPacket({
      room: {
        slug: "demo-room",
        title: "Build an AI code stream",
        stage: "coding",
        codingTool: "cursor",
      },
      chatWindow: [{ user: "viewer", text: "Could this be smaller?" }],
      latestScreenshot: {
        url: "data:image/jpeg;base64,abc123",
        capturedAt: 1_744_163_200_000,
      },
      latestScreenshotSummary: {
        uiLanguage: "zh",
        primarySurface: "terminal",
        dominantSource: "agent_output",
        contentContext: "streamer_workspace",
        activityConfidence: "high",
        streamerActivity: "主播在调试 AI audience 的语言问题",
        humanPromptSummary: "主播在要求 agent 调整 prompt",
        agentOutputSummary: "agent 在解释 runtime 改动",
        currentTaskSummary: "主播在调试 AI audience 的语言问题",
        suggestedAngles: ["为什么先动 prompt 不动 gate"],
      },
    });

    await client.decide(PERSONAS[0], packet);

    const [, requestInit] = fetchMock.mock.calls[0] as [
      string,
      RequestInit | undefined,
    ];
    const body = JSON.parse(String(requestInit?.body)) as {
      messages: Array<{ role: string; content: unknown }>;
    };
    const content = body.messages[1]?.content as Array<Record<string, unknown>>;
    const textPart = content.find((part) => part.type === "text") as
      | { type: "text"; text: string }
      | undefined;

    expect(content).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: "text" }),
        expect.objectContaining({
          type: "image_url",
          image_url: { url: "data:image/jpeg;base64,abc123" },
        }),
      ]),
    );
    expect(textPart?.text).toContain('"recentHumanChat"');
    expect(textPart?.text).toContain('"recentBotChat"');
    expect(textPart?.text).toContain('"commentGoal"');
    expect(textPart?.text).toContain('"displayName": "Nova"');
    expect(textPart?.text).toContain('"target": "streamer"');
    expect(textPart?.text).toContain('"latestScreenshotSummary"');
    expect(textPart?.text).not.toContain('"questionPriority"');
    expect(textPart?.text).not.toContain('"suggestedAngleOrder"');
    expect(textPart?.text).not.toContain('"commentStyleMix"');
    expect(textPart?.text).not.toContain('"overfitAvoidance"');
    expect(textPart?.text).not.toContain('"humanFeedbackRecovery"');
  });

  it("attaches a video clip as model input when video context is available", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content: '{"decision":"hold"}',
              },
            },
          ],
        }),
        {
          status: 200,
          headers: { "content-type": "application/json" },
        },
      ),
    );

    const client = new OpenRouterModelClient(
      {
        name: "google/gemini-3-flash-preview",
        apiKey: "test-key",
      },
      fetchMock as typeof fetch,
    );

    const packet = buildContextPacket({
      room: {
        slug: "demo-room",
        title: "Build an AI code stream",
        stage: "coding",
        codingTool: "cursor",
      },
      chatWindow: [],
      latestScreenshotSummary: {
        uiLanguage: "zh",
        primarySurface: "terminal",
        dominantSource: "agent_output",
        contentContext: "streamer_workspace",
        activityConfidence: "high",
        streamerActivity: "主播在调试 AI audience 的语言问题",
        humanPromptSummary: "主播在要求 agent 调整 prompt",
        agentOutputSummary: "agent 在解释 runtime 改动",
        currentTaskSummary: "主播在调试 AI audience 的语言问题",
        suggestedAngles: ["为什么先动 prompt 不动 gate"],
      },
      latestVideoClip: {
        url: "data:video/webm;base64,clip",
        capturedAt: 1_744_163_200_000,
      },
    });

    await client.decide(PERSONAS[0], packet);

    const [, requestInit] = fetchMock.mock.calls[0] as [
      string,
      RequestInit | undefined,
    ];
    const body = JSON.parse(String(requestInit?.body)) as {
      model: string;
      messages: Array<{ role: string; content: unknown }>;
    };
    const content = body.messages[1]?.content as Array<Record<string, unknown>>;
    const textPart = content.find((part) => part.type === "text") as
      | { type: "text"; text: string }
      | undefined;
    const promptPayload = JSON.parse(textPart?.text ?? "{}") as {
      latestVideoClip?: unknown;
    };

    expect(body.model).toBe("google/gemini-3-flash-preview");
    expect(content).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: "text" }),
        expect.objectContaining({
          type: "video_url",
          videoUrl: { url: "data:video/webm;base64,clip" },
        }),
      ]),
    );
    expect(promptPayload.latestVideoClip).toEqual({
      capturedAt: 1_744_163_200_000,
      attached: true,
    });
    expect(textPart?.text).not.toContain("data:video/webm;base64,clip");
  });

  it("parses the first JSON object even when the model adds extra prose", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content:
                  '{"decision":"speak","text":"你现在是在先收口 prompt 还是先收口 context？","target":"streamer"}\n\nThis question stays grounded in the visible stream topic.',
              },
            },
          ],
        }),
        {
          status: 200,
          headers: { "content-type": "application/json" },
        },
      ),
    );

    const client = new OpenRouterModelClient(
      {
        name: "anthropic/claude-sonnet-4.6",
        apiKey: "test-key",
      },
      fetchMock as typeof fetch,
    );

    const packet = buildContextPacket({
      room: {
        slug: "demo-room",
        title: "Build an AI code stream",
        stage: "coding",
        codingTool: "cursor",
      },
      chatWindow: [{ user: "viewer", text: "这个方向会不会太复杂？" }],
    });

    await expect(client.decide(PERSONAS[0], packet)).resolves.toEqual({
      type: "speak",
      text: "你现在是在先收口 prompt 还是先收口 context？",
      target: "streamer",
      reason: "openrouter",
    });
  });

  it("includes the upstream error body when the model request fails", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          error: {
            message: "response_format is not supported for this model",
          },
        }),
        {
          status: 400,
          headers: { "content-type": "application/json" },
        },
      ),
    );

    const client = new OpenRouterModelClient(
      {
        name: "anthropic/claude-sonnet-4.6",
        apiKey: "test-key",
      },
      fetchMock as typeof fetch,
    );

    const packet = buildContextPacket({
      room: {
        slug: "demo-room",
        title: "Build an AI code stream",
        stage: "coding",
        codingTool: "cursor",
      },
      chatWindow: [{ user: "viewer", text: "Could this be smaller?" }],
    });

    await expect(client.decide(PERSONAS[0], packet)).rejects.toThrow(
      'OpenRouter request failed: 400 {"error":{"message":"response_format is not supported for this model"}}',
    );
  });
});
