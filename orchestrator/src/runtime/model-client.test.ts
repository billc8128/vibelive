import { describe, expect, it, vi } from "vitest";

import { buildContextPacket } from "./context-packet.js";
import { OpenRouterModelClient } from "./model-client.js";
import { PERSONAS } from "./personas.js";

describe("OpenRouterModelClient", () => {
  it("sends a chat completions request and parses a speak decision", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
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
      response_format?: { type: string };
      messages: Array<{ role: string; content: unknown }>;
    };

    expect(body.model).toBe("anthropic/claude-sonnet-4.6");
    expect(body).not.toHaveProperty("response_format");
    expect(body.messages[0]?.content).toContain(
      "Sound like a real livestream viewer in public chat",
    );
    expect(body.messages[0]?.content).toContain(
      "Do not sound like a code reviewer, architect, or teammate doing design review.",
    );
    expect(body.messages[0]?.content).toContain(
      "Do not quote visible file names, function names, config keys, or note text verbatim",
    );
    expect(body.messages[0]?.content).toContain(
      "Treat IDE, terminal, and chat prose as coding-agent output unless it is clearly typed by the human streamer.",
    );
    expect(body.messages[0]?.content).toContain(
      "If the screenshot UI is mostly Chinese, reply in Chinese.",
    );
    expect(body.messages[0]?.content).toContain(
      "the most useful questions are usually about the streamer's prompting method, workflow choice",
    );
    expect(body.messages[0]?.content).toContain(
      "Prefer top-level audience questions about tool choice, workflow, project stage, platform tradeoffs, or the current blocker.",
    );
    expect(body.messages[0]?.content).toContain(
      "Do not ask about hook names, stack traces, exit codes, script line numbers, or low-level agent housekeeping unless the streamer is explicitly discussing them.",
    );
    expect(body.messages[0]?.content).toContain(
      "If screenshot summary suggestedAngles are available, prefer the least technical, most audience-friendly angle.",
    );
    expect(body.messages[0]?.content).toContain(
      "When multiple angles are possible, prefer agent, tool, setup, platform, or project-stage questions before workflow-logic questions.",
    );
    expect(body.messages[0]?.content).toContain(
      "If you cannot clearly tell what the streamer is doing right now, hold.",
    );
    expect(body.messages[0]?.content).toContain(
      "When the streamer is reading external content, ask about the takeaway, relevance, or why they opened it",
    );
    expect(body.messages[0]?.content).toContain(
      "Do not make every message a question.",
    );
    expect(body.messages[0]?.content).toContain(
      "Mix questions with observations, evaluations, suggestions, and light hype",
    );
    expect(body.messages[0]?.content).toContain(
      "Avoid overfitting to exact on-screen terms",
    );
    expect(body.messages[0]?.content).toContain(
      "When the latest human chat is confused by or critical of recent bot messages",
    );
  });

  it("uses screenshot summary instead of raw image input for chat generation", async () => {
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

    expect(typeof body.messages[1]?.content).toBe("string");
    expect(body.messages[1]?.content).toContain('"recentHumanChat"');
    expect(body.messages[1]?.content).toContain('"recentBotChat"');
    expect(body.messages[1]?.content).toContain('"commentGoal"');
    expect(body.messages[1]?.content).toContain('"screenshotHint"');
    expect(body.messages[1]?.content).toContain('"productType": "vibe_coding_livestream"');
    expect(body.messages[1]?.content).toContain('"agentOutputRule"');
    expect(body.messages[1]?.content).toContain('"workflowPriority"');
    expect(body.messages[1]?.content).toContain('"questionPriority"');
    expect(body.messages[1]?.content).toContain('"avoidTopics"');
    expect(body.messages[1]?.content).toContain('"suggestedAnglePolicy"');
    expect(body.messages[1]?.content).toContain('"suggestedAngleOrder"');
    expect(body.messages[1]?.content).toContain('"understandingRequirement"');
    expect(body.messages[1]?.content).toContain('"externalContentRule"');
    expect(body.messages[1]?.content).toContain('"commentStyleMix"');
    expect(body.messages[1]?.content).toContain('"overfitAvoidance"');
    expect(body.messages[1]?.content).toContain('"exampleGoodComments"');
    expect(body.messages[1]?.content).toContain('"humanFeedbackRecovery"');
    expect(body.messages[1]?.content).toContain('"latestScreenshotSummary"');
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
