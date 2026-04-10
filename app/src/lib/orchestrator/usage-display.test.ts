import { describe, expect, it } from "vitest";

import { describeAiAudienceContext } from "./usage-display";

describe("describeAiAudienceContext", () => {
  it("distinguishes screenshot summary context from direct image input", () => {
    expect(
      describeAiAudienceContext({
        operation: "agent_decide",
        hasVideo: false,
        attachedImage: false,
        usedScreenshotSummary: true,
      }),
    ).toBe("summary");

    expect(
      describeAiAudienceContext({
        operation: "screenshot_summary",
        hasVideo: false,
        attachedImage: true,
        usedScreenshotSummary: false,
      }),
    ).toBe("image");
  });

  it("shows combined media context when video and summary are both present", () => {
    expect(
      describeAiAudienceContext({
        operation: "agent_decide",
        hasVideo: true,
        attachedImage: false,
        usedScreenshotSummary: true,
      }),
    ).toBe("video + summary");
  });

  it("falls back to text when no media context is attached", () => {
    expect(
      describeAiAudienceContext({
        operation: "agent_decide",
        hasVideo: false,
        attachedImage: false,
        usedScreenshotSummary: false,
      }),
    ).toBe("text");
  });
});
