import { describe, expect, it } from "vitest";

import { isAiAudienceIdentity, isViewerParticipant } from "./participants";

describe("participants", () => {
  it("identifies AI audience participants by reserved prefix", () => {
    expect(isAiAudienceIdentity("ai-audience:nova")).toBe(true);
    expect(isAiAudienceIdentity("viewer-nova")).toBe(false);
  });

  it("excludes AI audience participants from viewer counts", () => {
    expect(
      isViewerParticipant({
        identity: "ai-audience:nova",
        permissions: { canPublish: false },
      }),
    ).toBe(false);
    expect(
      isViewerParticipant({
        identity: "viewer-nova",
        permissions: { canPublish: false },
      }),
    ).toBe(true);
  });
});
