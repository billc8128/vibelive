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

  it("excludes hover-preview participants from viewer counts", () => {
    // 首页 LiveStreamCard 的 hover 预览, 见 commit 0e7cd81
    expect(
      isViewerParticipant({
        identity: "hover-room42-x9k2a8",
        permissions: { canPublish: false },
      }),
    ).toBe(false);
  });
});
