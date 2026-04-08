import type { ContextPacket } from "./context-packet.js";

import {
  HeuristicModelClient,
  type AgentDecision,
  type ModelClient,
} from "./model-client.js";
import type { Persona } from "./personas.js";

export class AgentRunner {
  constructor(
    private readonly modelClient: ModelClient = new HeuristicModelClient(),
  ) {}

  async decide(persona: Persona, packet: ContextPacket): Promise<AgentDecision> {
    return this.modelClient.decide(persona, packet);
  }
}
