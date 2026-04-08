import { describe, expect, it } from "vitest";

import { MessageGate } from "./message-gate.js";

describe("MessageGate", () => {
  it("rejects near-duplicate bot messages within cooldown", () => {
    const gate = new MessageGate();

    expect(gate.accept("curious", "Why not split this hook?", 1000)).toBe(true);
    expect(gate.accept("builder", "Why not split this hook?", 2000)).toBe(false);
  });
});
