import { describe, expect, it } from "vitest";

import { buildSignedOrchestratorHeaders } from "./client";

describe("buildSignedOrchestratorHeaders", () => {
  it("includes the shared secret header", () => {
    expect(buildSignedOrchestratorHeaders("test")["x-orchestrator-secret"]).toBe(
      "test",
    );
  });
});
