import { describe, expect, it } from "vitest";

import { PERSONAS } from "./personas.js";

describe("PERSONAS", () => {
  it("defines the five default AI audience personas", () => {
    expect(PERSONAS.map((persona) => persona.key)).toEqual([
      "curious",
      "builder",
      "product",
      "beginner",
      "hype",
    ]);
  });
});
