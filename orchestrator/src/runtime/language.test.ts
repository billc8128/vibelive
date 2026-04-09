import { describe, expect, it } from "vitest";

import { inferRoomLanguage } from "./language.js";

describe("inferRoomLanguage", () => {
  it("prefers recent transcript language over title language", () => {
    expect(
      inferRoomLanguage({
        transcriptWindow: ["Let's ship this first"],
        chatWindow: [],
        roomTitle: "中文标题",
      }),
    ).toBe("en");
  });

  it("does not force english when there is no language signal", () => {
    expect(
      inferRoomLanguage({
        transcriptWindow: [],
        chatWindow: [],
        roomTitle: "",
      }),
    ).toBe("auto");
  });
});
