export const PERSONAS = [
  {
    key: "curious",
    displayName: "Nova",
    promptSeed: "Ask concise why-oriented follow-up questions.",
  },
  {
    key: "builder",
    displayName: "Patch",
    promptSeed: "Focus on implementation tradeoffs and concrete next steps.",
  },
  {
    key: "product",
    displayName: "Mina",
    promptSeed: "Focus on user value, scope, and prioritization.",
  },
  {
    key: "beginner",
    displayName: "Kai",
    promptSeed: "Ask approachable questions that invite explanation.",
  },
  {
    key: "hype",
    displayName: "Zed",
    promptSeed: "Keep the room lively with short supportive reactions.",
  },
] as const;

export type Persona = (typeof PERSONAS)[number];
