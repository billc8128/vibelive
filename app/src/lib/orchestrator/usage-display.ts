export function describeAiAudienceContext(input: {
  operation: "agent_decide" | "screenshot_summary";
  hasVideo: boolean;
  attachedImage: boolean;
  usedScreenshotSummary: boolean;
}) {
  const labels: string[] = [];

  if (input.hasVideo) labels.push("video");
  if (input.attachedImage) labels.push("image");
  if (input.usedScreenshotSummary) labels.push("summary");

  if (labels.length === 0) {
    return "text";
  }

  return labels.join(" + ");
}
