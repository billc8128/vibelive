import { describe, expect, it } from "vitest";

import { MessageGate } from "./message-gate.js";

describe("MessageGate", () => {
  it("rejects near-duplicate bot messages within cooldown", () => {
    const gate = new MessageGate();

    expect(gate.accept("curious", "Why not split this hook?", 1000)).toBe(true);
    expect(gate.accept("builder", "Why not split this hook?", 2000)).toBe(false);
  });

  it("enforces a room-level cooldown between accepted bot messages", () => {
    const gate = new MessageGate();

    expect(gate.accept("curious", "Why not split auth first?", 1_000)).toBe(
      true,
    );
    expect(
      gate.accept("builder", "Would middleware make this easier?", 20_000),
    ).toBe(false);
    expect(
      gate.accept("builder", "Would middleware make this easier?", 35_000),
    ).toBe(true);
  });
});
