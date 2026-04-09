import { afterEach, describe, expect, it } from "vitest";

import { readConfig } from "./config.js";

describe("readConfig", () => {
  afterEach(() => {
    delete process.env.PORT;
    delete process.env.ORCHESTRATOR_SECRET;
    delete process.env.AI_AUDIENCE_MODEL_PROVIDER;
    delete process.env.AI_AUDIENCE_MODEL_NAME;
    delete process.env.AI_AUDIENCE_MODEL_API_KEY;
  });

  it("reads OpenRouter model settings when configured", () => {
    process.env.PORT = "3200";
    process.env.ORCHESTRATOR_SECRET = "shared-secret";
    process.env.AI_AUDIENCE_MODEL_PROVIDER = "openrouter";
    process.env.AI_AUDIENCE_MODEL_NAME = "anthropic/claude-sonnet-4.6";
    process.env.AI_AUDIENCE_MODEL_API_KEY = "test-key";

    expect(readConfig()).toMatchObject({
      port: 3200,
      orchestratorSecret: "shared-secret",
      model: {
        provider: "openrouter",
        name: "anthropic/claude-sonnet-4.6",
        apiKey: "test-key",
      },
    });
  });

  it("falls back to no remote model when required values are missing", () => {
    process.env.ORCHESTRATOR_SECRET = "shared-secret";
    process.env.AI_AUDIENCE_MODEL_PROVIDER = "openrouter";

    expect(readConfig()).toMatchObject({
      model: null,
    });
  });
});
