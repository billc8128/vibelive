import type { ContextPacket } from "./context-packet.js";
import type { Persona } from "./personas.js";

export type AgentDecision =
  | { type: "hold" }
  | {
      type: "speak";
      text: string;
      target?: "streamer" | "viewer";
      reason?: string;
    };

export interface ModelClient {
  decide(persona: Persona, packet: ContextPacket): Promise<AgentDecision>;
}

export class NullModelClient implements ModelClient {
  async decide(): Promise<AgentDecision> {
    return { type: "hold" };
  }
}
