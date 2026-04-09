import { describe, expect, it } from "vitest";

import { RoomManager } from "./room-manager.js";

describe("RoomManager", () => {
  it("keeps only one runtime per room", () => {
    const manager = new RoomManager();

    manager.register("demo-room", { stop() {} });
    manager.register("demo-room", { stop() {} });

    expect(manager.count()).toBe(1);
  });
});
