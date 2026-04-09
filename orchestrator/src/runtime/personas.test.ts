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

  it("encourages comments beyond only questions", () => {
    expect(
      PERSONAS.every((persona) =>
        persona.promptSeed.includes("Mix questions with"),
      ),
    ).toBe(true);
    expect(PERSONAS.find((persona) => persona.key === "hype")?.promptSeed).toContain(
      "light hype",
    );
  });
});
