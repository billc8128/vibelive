export type AiAudienceIntensity = "low" | "medium" | "high";

export interface AiAudienceSettings {
  enabled: boolean;
  count: number;
  intensity: AiAudienceIntensity;
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
      ? Math.min(input.ai_audience_count, 5)
      : 5;

  return {
    enabled: input.ai_audience_enabled === true,
    count,
    intensity,
  };
}
