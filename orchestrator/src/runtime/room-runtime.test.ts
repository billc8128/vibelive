import { describe, expect, it } from "vitest";

import { ChatInjector } from "./chat-injector.js";
import { AgentRunner } from "./agent-runner.js";
import { RoomRuntime } from "./room-runtime.js";
import type { ModelClient } from "./model-client.js";
import type { ContextPacket } from "./context-packet.js";
import type { Persona } from "./personas.js";

describe("RoomRuntime", () => {
  it("skips message publish when no screenshot is available but continues running", async () => {
    const runtime = new RoomRuntime({
      roomSlug: "demo-room",
      roomTitle: "Demo Room",
      projectStage: "coding",
      codingTool: "cursor",
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

    const chatInjector = new ChatInjector("demo-room");
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
});
