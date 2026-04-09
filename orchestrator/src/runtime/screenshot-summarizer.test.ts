import { describe, expect, it, vi } from "vitest";

import { OpenRouterScreenshotSummarizer } from "./screenshot-summarizer.js";

describe("OpenRouterScreenshotSummarizer", () => {
  it("summarizes a screenshot into structured vibe-coding context", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content:
                  '{"uiLanguage":"zh","primarySurface":"terminal","dominantSource":"agent_output","contentContext":"streamer_workspace","activityConfidence":"high","streamerActivity":"主播在调试 AI audience 的语言和节奏","humanPromptSummary":"主播在要求 agent 调整 AI audience 行为","agentOutputSummary":"agent 正在解释 prompt 和 runtime 调整","currentTaskSummary":"主播在调试 AI audience 的语言和节奏","suggestedAngles":["为什么先改 prompt 而不是 gate"]}',
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

    const summarizer = new OpenRouterScreenshotSummarizer(
      {
        name: "anthropic/claude-sonnet-4.6",
        apiKey: "test-key",
      },
      fetchMock as typeof fetch,
    );

    await expect(
      summarizer.summarize("data:image/jpeg;base64,abc123"),
    ).resolves.toEqual({
      uiLanguage: "zh",
      primarySurface: "terminal",
      dominantSource: "agent_output",
      contentContext: "streamer_workspace",
      activityConfidence: "high",
      streamerActivity: "主播在调试 AI audience 的语言和节奏",
      humanPromptSummary: "主播在要求 agent 调整 AI audience 行为",
      agentOutputSummary: "agent 正在解释 prompt 和 runtime 调整",
      currentTaskSummary: "主播在调试 AI audience 的语言和节奏",
      suggestedAngles: ["为什么先改 prompt 而不是 gate"],
    });

    const [, requestInit] = fetchMock.mock.calls[0] as [
      string,
      RequestInit | undefined,
    ];
    const body = JSON.parse(String(requestInit?.body)) as {
      messages: Array<{ role: string; content: unknown }>;
    };

    expect(body.messages[0]?.content).toContain(
      "Summarize one screenshot from a vibe coding livestream",
    );
    expect(body.messages[0]?.content).toContain(
      "uiLanguage must be one of zh, en, mixed, unknown",
    );
    expect(body.messages[0]?.content).toContain(
      "Return one compact JSON object with no markdown fences",
    );
    expect(body.messages[0]?.content).toContain(
      "Translate low-level hooks, logs, and bug text into higher-level viewer takeaways",
    );
    expect(body.messages[0]?.content).toContain(
      "Identify what the streamer is doing with the content, not just what the content says",
    );
    const userText = String(
      (body.messages[1]?.content as Array<{ type?: string; text?: string }>)[0]
        ?.text,
    );
    expect(userText).toContain(
      "Suggested angles should support public-chat questions or comments about tools, workflow, project stage, platform choice, current blocker, or the stream vibe",
    );
    expect(userText).toContain('"contentContext"');
    expect(userText).toContain('"activityConfidence"');
    expect(userText).toContain('"streamerActivity"');
    expect(body.messages[1]?.content).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: "text" }),
        expect.objectContaining({
          type: "image_url",
          image_url: expect.objectContaining({
            url: "data:image/jpeg;base64,abc123",
          }),
        }),
      ]),
    );
  });

  it("includes the upstream error body when screenshot summarization fails", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          error: {
            message: "image_url is not supported for this request shape",
          },
        }),
        {
          status: 400,
          headers: { "content-type": "application/json" },
        },
      ),
    );

    const summarizer = new OpenRouterScreenshotSummarizer(
      {
        name: "anthropic/claude-sonnet-4.6",
        apiKey: "test-key",
      },
      fetchMock as typeof fetch,
    );

    await expect(
      summarizer.summarize("data:image/jpeg;base64,abc123"),
    ).rejects.toThrow(
      "Screenshot summary request failed: 400 {\"error\":{\"message\":\"image_url is not supported for this request shape\"}}",
    );
  });

  it("includes the raw model content when JSON parsing fails", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content:
                  '{"uiLanguage":"zh","currentTaskSummary":"主播在看 terminal 输出"\n\nI picked Chinese because the UI looked Chinese.',
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

    const summarizer = new OpenRouterScreenshotSummarizer(
      {
        name: "anthropic/claude-sonnet-4.6",
        apiKey: "test-key",
      },
      fetchMock as typeof fetch,
    );

    await expect(
      summarizer.summarize("data:image/jpeg;base64,abc123"),
    ).rejects.toThrow(
      'Invalid screenshot summary JSON: {"uiLanguage":"zh","currentTaskSummary":"主播在看 terminal 输出"',
    );
  });
});
