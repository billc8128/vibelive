import { readConfig } from "../config.js";
import type { ContextPacket } from "./context-packet.js";

import {
  createModelClient,
  HeuristicModelClient,
  type AgentDecision,
  type ModelClient,
} from "./model-client.js";
import type { Persona } from "./personas.js";

export class AgentRunner {
  constructor(
    private readonly modelClient: ModelClient = createModelClient(
      readConfig().model,
    ),
    private readonly fallbackModelClient: ModelClient = new HeuristicModelClient(),
  ) {}

  async decide(persona: Persona, packet: ContextPacket): Promise<AgentDecision> {
    try {
      return await this.modelClient.decide(persona, packet);
    } catch (error) {
      console.warn("model-client failed, falling back to heuristic", error);
      return this.fallbackModelClient.decide(persona, packet);
    }
  }
}
