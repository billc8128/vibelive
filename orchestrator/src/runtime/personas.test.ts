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

  it("defines identity cards with distinct voice guidance", () => {
    expect(
      PERSONAS.every((persona) =>
        typeof persona.identity === "string" &&
        persona.identity.length > 10 &&
        Array.isArray(persona.voiceTraits) &&
        persona.voiceTraits.length >= 3 &&
        Array.isArray(persona.avoidPatterns) &&
        persona.avoidPatterns.length >= 2 &&
        Array.isArray(persona.sampleLines.zh) &&
        persona.sampleLines.zh.length >= 2 &&
        Array.isArray(persona.sampleLines.en) &&
        persona.sampleLines.en.length >= 2,
      ),
    ).toBe(true);

    expect(PERSONAS.find((persona) => persona.key === "hype")).toMatchObject({
      displayName: "Zed",
      voiceTraits: expect.arrayContaining([
        expect.stringContaining("短"),
      ]),
      sampleLines: {
        zh: expect.arrayContaining(["主播好强，又在搞大事了"]),
        en: expect.arrayContaining([
          "Okay this looks like you're building something bigger now.",
        ]),
      },
    });
  });
});
