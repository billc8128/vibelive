import { describe, expect, it } from "vitest";

import {
  isAllowedAiAudienceSettingsKey,
  normalizeAiAudienceSettings,
} from "./settings";

describe("normalizeAiAudienceSettings", () => {
  it("applies MVP defaults for missing values", () => {
    expect(normalizeAiAudienceSettings({})).toEqual({
      enabled: false,
      count: 5,
      intensity: "medium",
    });
  });

  it("accepts AI audience settings keys", () => {
    expect(isAllowedAiAudienceSettingsKey("ai_audience_enabled")).toBe(true);
    expect(isAllowedAiAudienceSettingsKey("ai_audience_count")).toBe(true);
    expect(isAllowedAiAudienceSettingsKey("ai_audience_intensity")).toBe(true);
    expect(isAllowedAiAudienceSettingsKey("slow_mode_enabled")).toBe(false);
  });
});
