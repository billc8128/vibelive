import { describe, expect, it } from "vitest";

import { isBotChatMessage } from "./protocol";

describe("isBotChatMessage", () => {
  it("identifies bot-tagged chat messages", () => {
    expect(isBotChatMessage({ type: "chat", user: "Nova", bot: true })).toBe(
      true,
    );
  });

  it("ignores human chat messages", () => {
    expect(isBotChatMessage({ type: "chat", user: "Nova", bot: false })).toBe(
      false,
    );
  });
});
