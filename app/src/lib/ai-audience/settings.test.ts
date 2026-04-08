import { describe, expect, it } from "vitest";

import { normalizeAiAudienceSettings } from "./settings";

describe("normalizeAiAudienceSettings", () => {
  it("applies MVP defaults for missing values", () => {
    expect(normalizeAiAudienceSettings({})).toEqual({
      enabled: false,
      count: 5,
      intensity: "medium",
    });
  });
});
