import { afterEach, describe, expect, it, vi } from "vitest";

import { ChatInjector } from "./chat-injector.js";

describe("ChatInjector", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("swallows publisher errors so runtime loops stay alive", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const injector = new ChatInjector("demo-room", {
      sendData: vi.fn().mockRejectedValue(new Error("requested room does not exist")),
    });

    await expect(
      injector.publish({
        user: "Nova",
        text: "Can you split auth first?",
        bot: true,
        botPersona: "curious",
      }),
    ).resolves.toBeUndefined();

    expect(injector.published).toContainEqual(
      expect.objectContaining({
        user: "Nova",
        text: "Can you split auth first?",
      }),
    );
  });
});
