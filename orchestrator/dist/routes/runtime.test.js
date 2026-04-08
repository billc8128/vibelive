import { afterEach, describe, expect, it } from "vitest";
import { buildServer } from "../server.js";
describe("runtime routes", () => {
    afterEach(() => {
        delete process.env.ORCHESTRATOR_SECRET;
    });
    it("rejects requests with the wrong shared secret", async () => {
        process.env.ORCHESTRATOR_SECRET = "expected-secret";
        const server = buildServer();
        const res = await server.inject({
            method: "POST",
            url: "/runtime/start",
            headers: { "x-orchestrator-secret": "wrong" },
        });
        expect(res.statusCode).toBe(401);
    });
});
