export const AI_AUDIENCE_DEFAULT_COUNT = 5;
export const AI_AUDIENCE_SETTINGS_KEYS = [
  "ai_audience_enabled",
  "ai_audience_count",
  "ai_audience_intensity",
] as const;

export type AiAudienceSettingsKey =
  (typeof AI_AUDIENCE_SETTINGS_KEYS)[number];
export type AiAudienceIntensity = "low" | "medium" | "high";

export interface AiAudienceSettings {
  enabled: boolean;
  count: number;
  intensity: AiAudienceIntensity;
}

export interface AiAudienceSettingsPatch {
  ai_audience_enabled?: boolean;
  ai_audience_count?: number;
  ai_audience_intensity?: AiAudienceIntensity;
}

export function isAllowedAiAudienceSettingsKey(
  key: string,
): key is AiAudienceSettingsKey {
  return AI_AUDIENCE_SETTINGS_KEYS.includes(key as AiAudienceSettingsKey);
}

function normalizeAiAudienceCount(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    return AI_AUDIENCE_DEFAULT_COUNT;
  }

  return Math.min(Math.max(Math.round(value), 1), AI_AUDIENCE_DEFAULT_COUNT);
}

export function normalizeAiAudienceSettings(
  input: Record<string, unknown>,
): AiAudienceSettings {
  const intensity =
    input.ai_audience_intensity === "low" ||
    input.ai_audience_intensity === "high"
      ? input.ai_audience_intensity
      : "medium";

  const count =
    typeof input.ai_audience_count === "number" && input.ai_audience_count > 0
      ? normalizeAiAudienceCount(input.ai_audience_count)
      : AI_AUDIENCE_DEFAULT_COUNT;

  return {
    enabled: input.ai_audience_enabled === true,
    count,
    intensity,
  };
}

export function normalizeAiAudienceSettingsPatch(
  input: Record<string, unknown>,
): AiAudienceSettingsPatch {
  const patch: AiAudienceSettingsPatch = {};

  if (typeof input.ai_audience_enabled === "boolean") {
    patch.ai_audience_enabled = input.ai_audience_enabled;
  }

  if ("ai_audience_count" in input) {
    patch.ai_audience_count = normalizeAiAudienceCount(input.ai_audience_count);
  }

  if ("ai_audience_intensity" in input) {
    patch.ai_audience_intensity =
      input.ai_audience_intensity === "low" ||
      input.ai_audience_intensity === "high"
        ? input.ai_audience_intensity
        : "medium";
  }

  return patch;
}
