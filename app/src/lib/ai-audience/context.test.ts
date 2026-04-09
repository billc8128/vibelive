import { describe, expect, it } from "vitest";

import { isAiAudienceContextEvent } from "./context";

describe("isAiAudienceContextEvent", () => {
  it("accepts mirrored video clip context events", () => {
    expect(
      isAiAudienceContextEvent({
        roomSlug: "demo-room",
        kind: "video_clip",
        url: "data:video/webm;base64,clip",
        capturedAt: 1_744_163_200_000,
      }),
    ).toBe(true);
  });
});
