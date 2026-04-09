import { describe, expect, it } from "vitest";

import { resolveViewerIdentity } from "./viewerIdentity";

describe("resolveViewerIdentity", () => {
  it("keeps the display name but changes the transport identity for self-monitoring streamers", () => {
    const session = resolveViewerIdentity("bichenchen", {
      isOwnerSelfWatch: true,
      uniqueSuffix: "self1",
    });

    expect(session.displayName).toBe("bichenchen");
    expect(session.transportIdentity).not.toBe("bichenchen");
    expect(session.transportIdentity).toContain("self1");
  });

  it("uses the display name directly for normal viewers", () => {
    const session = resolveViewerIdentity("alice", {
      isOwnerSelfWatch: false,
      uniqueSuffix: "ignored",
    });

    expect(session.displayName).toBe("alice");
    expect(session.transportIdentity).toBe("alice");
  });
});
