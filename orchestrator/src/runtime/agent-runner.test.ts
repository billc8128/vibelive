import { afterEach, describe, expect, it, vi } from "vitest";

import { buildContextPacket } from "./context-packet.js";
import { AgentRunner } from "./agent-runner.js";
import {
  HeuristicModelClient,
  type AgentDecision,
  type ModelClient,
} from "./model-client.js";
import { PERSONAS } from "./personas.js";

describe("AgentRunner", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("falls back to the heuristic model when the primary model throws", async () => {
    class ThrowingModelClient implements ModelClient {
      async decide(): Promise<AgentDecision> {
        throw new Error("provider down");
      }
    }

    const runner = new AgentRunner(
      new ThrowingModelClient(),
      new HeuristicModelClient(),
    );
    vi.spyOn(console, "warn").mockImplementation(() => undefined);

    const packet = buildContextPacket({
      room: {
        slug: "demo-room",
        title: "Build an AI code stream",
        stage: "coding",
        codingTool: "cursor",
      },
      chatWindow: [],
      audioWindow: ["Need to decide whether to split this stage"],
    });

    const decision = await runner.decide(PERSONAS[0], packet);

    expect(decision).toMatchObject({
      type: "speak",
      reason: "heuristic-fallback",
    });
  });
});
