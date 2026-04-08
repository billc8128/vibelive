# AI Audience Agents Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a room-level AI audience system that starts with each live stream, runs five independent audience personas against a shared multimodal context packet, and injects bot-badged chat messages back into the existing VibeLive watch experience.

**Architecture:** Keep the current Next.js app on Vercel for channel settings, watch-page rendering, auth, and stream lifecycle hooks. Add a separate Railway-hosted orchestrator service that joins live rooms, builds room context, runs independent persona agents, applies lightweight gating, and publishes bot chat messages through LiveKit data messages so the existing chat flow remains intact.

**Tech Stack:** Next.js 16, React 19, TypeScript, Supabase, LiveKit, Railway, Node.js 22+, Fastify (or equivalent HTTP server), Vitest, Testing Library, livekit-client, livekit-server-sdk

---

## File Map

### Existing files to modify

- `app/package.json`
  - Add app-side test scripts and test dependencies.
- `app/src/app/api/channels/route.ts`
  - Allow AI audience settings keys in `channels.settings`.
- `app/src/app/api/streams/route.ts`
  - Trigger orchestrator start/stop on live lifecycle changes.
- `app/src/app/go-live/page.tsx`
  - Add AI audience settings UI to the existing chat / interaction section.
- `app/src/app/watch/[room]/page.tsx`
  - Move chat rendering to shared helpers, render bot badges, and exclude AI participants from viewer counts.
- `app/src/lib/i18n/en.ts`
  - Add English strings for AI audience settings and bot badge copy.
- `app/src/lib/i18n/zh.ts`
  - Add Chinese strings for AI audience settings and bot badge copy.

### New app files to create

- `app/vitest.config.ts`
  - App-side Vitest config for utility and component tests.
- `app/src/lib/ai-audience/settings.ts`
  - Shared app-side types and normalization helpers for AI audience settings.
- `app/src/lib/orchestrator/client.ts`
  - Small client for signed start/stop requests to the Railway orchestrator.
- `app/src/lib/orchestrator/client.test.ts`
  - Tests for orchestrator request helpers.
- `app/src/lib/chat/protocol.ts`
  - Shared chat message schema helpers for human and bot messages.
- `app/src/components/watch/chat/BotBadge.tsx`
  - Bot badge renderer used by the watch chat.
- `app/src/components/watch/chat/ChatMessageRow.tsx`
  - Shared row renderer for chat messages.
- `app/src/lib/participants.ts`
  - Helpers to classify streamer / OBS / AI audience participants.
- `app/src/lib/ai-audience/settings.test.ts`
  - Tests for settings normalization and defaults.
- `app/src/lib/chat/protocol.test.ts`
  - Tests for chat message parsing and bot detection.
- `app/src/lib/participants.test.ts`
  - Tests for participant filtering.

### New orchestrator service files to create

- `orchestrator/package.json`
  - Service scripts and dependencies.
- `orchestrator/tsconfig.json`
  - TypeScript config for the service.
- `orchestrator/vitest.config.ts`
  - Service-side Vitest config.
- `orchestrator/src/index.ts`
  - Process entrypoint.
- `orchestrator/src/config.ts`
  - Environment parsing and validation.
- `orchestrator/src/server.ts`
  - Fastify app creation and plugin wiring.
- `orchestrator/src/routes/runtime.ts`
  - Start/stop/status routes for room runtimes.
- `orchestrator/src/types.ts`
  - Shared service-side domain types.
- `orchestrator/src/runtime/room-manager.ts`
  - Registry for active room runtimes.
- `orchestrator/src/runtime/room-manager.test.ts`
  - Runtime registry tests.
- `orchestrator/src/runtime/room-runtime.ts`
  - Room lifecycle orchestration.
- `orchestrator/src/runtime/room-runtime.test.ts`
  - End-to-end runtime loop tests.
- `orchestrator/src/runtime/personas.ts`
  - Persona definitions and prompt seeds.
- `orchestrator/src/runtime/language.ts`
  - Language inference from the context packet.
- `orchestrator/src/runtime/context-packet.ts`
  - Build the shared room context packet.
- `orchestrator/src/runtime/message-gate.ts`
  - Minimal dedupe, cooldown, and anti-bot-chain logic.
- `orchestrator/src/runtime/model-client.ts`
  - Model adapter interface and provider implementation boundary.
- `orchestrator/src/runtime/livekit-observer.ts`
  - Join room, subscribe to data/video/audio, and publish bot chat messages.
- `orchestrator/src/runtime/media-snapshotter.ts`
  - Latest screenshot and short clip reference collection.
- `orchestrator/src/runtime/transcript-window.ts`
  - Rolling transcript window assembly.
- `orchestrator/src/runtime/agent-runner.ts`
  - Five independent agent invocation loop.
- `orchestrator/src/runtime/chat-injector.ts`
  - Publish bot messages through LiveKit data messages.
- `orchestrator/src/runtime/personas.test.ts`
  - Persona behavior / schema tests.
- `orchestrator/src/runtime/language.test.ts`
  - Language inference tests.
- `orchestrator/src/runtime/context-packet.test.ts`
  - Context packet assembly tests.
- `orchestrator/src/runtime/message-gate.test.ts`
  - Gating and dedupe tests.
- `orchestrator/src/routes/runtime.test.ts`
  - Start/stop route tests.

## Environment Variables

### App

- `AI_AUDIENCE_ORCHESTRATOR_URL`
- `AI_AUDIENCE_ORCHESTRATOR_SECRET`

### Orchestrator

- `PORT`
- `ORCHESTRATOR_SECRET`
- `NEXT_PUBLIC_LIVEKIT_URL`
- `LIVEKIT_API_KEY`
- `LIVEKIT_API_SECRET`
- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `AI_AUDIENCE_MODEL_PROVIDER`
- `AI_AUDIENCE_MODEL_NAME`
- `AI_AUDIENCE_MODEL_API_KEY`

## Task 1: Add Test Harness and Shared Settings Types

**Files:**
- Modify: `app/package.json`
- Create: `app/vitest.config.ts`
- Create: `app/src/lib/ai-audience/settings.ts`
- Test: `app/src/lib/ai-audience/settings.test.ts`

- [ ] **Step 1: Write the failing settings test**

```ts
import { describe, expect, it } from "vitest";
import { normalizeAiAudienceSettings } from "./settings";

describe("normalizeAiAudienceSettings", () => {
  it("applies MVP defaults for missing values", () => {
    expect(normalizeAiAudienceSettings({})).toEqual({
      enabled: false,
      count: 5,
      intensity: "medium",
    });
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd /Users/a/Desktop/vibelive/app && npm run test -- settings.test.ts`

Expected: FAIL because the Vitest script and settings module do not exist yet.

- [ ] **Step 3: Add the minimal test harness and implementation**

```ts
// app/src/lib/ai-audience/settings.ts
export type AiAudienceIntensity = "low" | "medium" | "high";

export function normalizeAiAudienceSettings(input: Record<string, unknown>) {
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
  } as const;
}
```

- [ ] **Step 4: Run the tests and make sure they pass**

Run: `cd /Users/a/Desktop/vibelive/app && npm run test -- settings.test.ts`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git -C /Users/a/Desktop/vibelive add \
  app/package.json \
  app/vitest.config.ts \
  app/src/lib/ai-audience/settings.ts \
  app/src/lib/ai-audience/settings.test.ts
git -C /Users/a/Desktop/vibelive commit -m "test: add app test harness for AI audience settings"
```

## Task 2: Expose AI Audience Settings in Channel API and Go-Live UI

**Files:**
- Modify: `app/src/app/api/channels/route.ts`
- Modify: `app/src/app/go-live/page.tsx`
- Modify: `app/src/lib/i18n/en.ts`
- Modify: `app/src/lib/i18n/zh.ts`
- Modify: `app/src/lib/ai-audience/settings.ts`
- Test: `app/src/lib/ai-audience/settings.test.ts`

- [ ] **Step 1: Write the failing API and normalization tests**

```ts
it("accepts AI audience settings keys", () => {
  expect(isAllowedAiAudienceSettingsKey("ai_audience_enabled")).toBe(true);
  expect(isAllowedAiAudienceSettingsKey("ai_audience_count")).toBe(true);
  expect(isAllowedAiAudienceSettingsKey("ai_audience_intensity")).toBe(true);
});
```

- [ ] **Step 2: Run the tests to verify failure**

Run: `cd /Users/a/Desktop/vibelive/app && npm run test -- settings.test.ts`

Expected: FAIL because the new keys and validators are not wired.

- [ ] **Step 3: Implement the minimal channel and UI changes**

```ts
// app/src/app/api/channels/route.ts
const SETTINGS_KEYS = new Set([
  "category",
  "platforms",
  "tags",
  "slow_mode_enabled",
  "slow_mode_seconds",
  "followers_only",
  "ai_audience_enabled",
  "ai_audience_count",
  "ai_audience_intensity",
]);
```

```tsx
// app/src/app/go-live/page.tsx
<Field label={t("goLive.chat.aiAudience")}>
  <ToggleButton
    enabled={!!draftChannel.settings.ai_audience_enabled}
    onChange={(v) => patchDraft({ settings: { ai_audience_enabled: v } })}
  />
</Field>
```

- [ ] **Step 4: Run tests and a targeted lint check**

Run: `cd /Users/a/Desktop/vibelive/app && npm run test -- settings.test.ts`

Run: `cd /Users/a/Desktop/vibelive/app && npm run lint`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git -C /Users/a/Desktop/vibelive add \
  app/src/app/api/channels/route.ts \
  app/src/app/go-live/page.tsx \
  app/src/lib/i18n/en.ts \
  app/src/lib/i18n/zh.ts \
  app/src/lib/ai-audience/settings.ts \
  app/src/lib/ai-audience/settings.test.ts
git -C /Users/a/Desktop/vibelive commit -m "feat: add AI audience settings to channel configuration"
```

## Task 3: Introduce Shared Chat Protocol and Bot Badge Rendering

**Files:**
- Create: `app/src/lib/chat/protocol.ts`
- Create: `app/src/lib/chat/protocol.test.ts`
- Create: `app/src/components/watch/chat/BotBadge.tsx`
- Create: `app/src/components/watch/chat/ChatMessageRow.tsx`
- Create: `app/src/lib/participants.ts`
- Create: `app/src/lib/participants.test.ts`
- Modify: `app/src/app/watch/[room]/page.tsx`
- Test: `app/src/lib/chat/protocol.test.ts`
- Test: `app/src/lib/participants.test.ts`

- [ ] **Step 1: Write the failing protocol tests**

```ts
import { describe, expect, it } from "vitest";
import { isBotChatMessage } from "./protocol";

describe("isBotChatMessage", () => {
  it("identifies bot-tagged chat messages", () => {
    expect(isBotChatMessage({ type: "chat", user: "Nova", bot: true })).toBe(true);
  });
});
```

- [ ] **Step 2: Run tests to verify failure**

Run: `cd /Users/a/Desktop/vibelive/app && npm run test -- protocol.test.ts participants.test.ts`

Expected: FAIL because the protocol helpers do not exist yet.

- [ ] **Step 3: Implement protocol helpers and watch-page rendering changes**

```ts
// app/src/lib/chat/protocol.ts
export interface RoomChatMessage {
  type: "chat";
  user: string;
  text: string;
  bot?: boolean;
  botPersona?: string;
}

export function isBotChatMessage(input: Partial<RoomChatMessage>) {
  return input.bot === true;
}
```

```ts
// app/src/lib/participants.ts
export function isAiAudienceIdentity(identity: string) {
  return identity.startsWith("ai-audience:");
}
```

```tsx
// app/src/components/watch/chat/ChatMessageRow.tsx
{message.bot && <BotBadge />}
```

- [ ] **Step 4: Run tests and verify lint passes**

Run: `cd /Users/a/Desktop/vibelive/app && npm run test -- protocol.test.ts participants.test.ts`

Run: `cd /Users/a/Desktop/vibelive/app && npm run lint`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git -C /Users/a/Desktop/vibelive add \
  app/src/lib/chat/protocol.ts \
  app/src/lib/chat/protocol.test.ts \
  app/src/components/watch/chat/BotBadge.tsx \
  app/src/components/watch/chat/ChatMessageRow.tsx \
  app/src/lib/participants.ts \
  app/src/lib/participants.test.ts \
  app/src/app/watch/[room]/page.tsx
git -C /Users/a/Desktop/vibelive commit -m "feat: render AI audience bot messages in room chat"
```

## Task 4: Add Orchestrator Client and Stream Lifecycle Hooks in the App

**Files:**
- Create: `app/src/lib/orchestrator/client.ts`
- Create: `app/src/lib/orchestrator/client.test.ts`
- Modify: `app/src/app/api/streams/route.ts`
- Test: `app/src/lib/orchestrator/client.test.ts`

- [ ] **Step 1: Write the failing orchestrator client test**

```ts
import { describe, expect, it } from "vitest";
import { buildSignedOrchestratorHeaders } from "./client";

describe("buildSignedOrchestratorHeaders", () => {
  it("includes the shared secret header", () => {
    expect(buildSignedOrchestratorHeaders("test")["x-orchestrator-secret"]).toBe("test");
  });
});
```

- [ ] **Step 2: Run the test to verify failure**

Run: `cd /Users/a/Desktop/vibelive/app && npm run test -- client.test.ts`

Expected: FAIL because the orchestrator client does not exist.

- [ ] **Step 3: Implement the minimal client and lifecycle hooks**

```ts
// app/src/lib/orchestrator/client.ts
export async function startAiAudienceRuntime(payload: { roomSlug: string }) {
  return fetch(`${process.env.AI_AUDIENCE_ORCHESTRATOR_URL}/runtime/start`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-orchestrator-secret": process.env.AI_AUDIENCE_ORCHESTRATOR_SECRET ?? "",
    },
    body: JSON.stringify(payload),
  });
}
```

```ts
// app/src/app/api/streams/route.ts
if (channel.settings?.ai_audience_enabled) {
  void startAiAudienceRuntime({ roomSlug: channel.slug });
}
```

- [ ] **Step 4: Run tests and lint**

Run: `cd /Users/a/Desktop/vibelive/app && npm run test -- client.test.ts`

Run: `cd /Users/a/Desktop/vibelive/app && npm run lint`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git -C /Users/a/Desktop/vibelive add \
  app/src/lib/orchestrator/client.ts \
  app/src/app/api/streams/route.ts
git -C /Users/a/Desktop/vibelive commit -m "feat: trigger AI audience runtime from stream lifecycle"
```

## Task 5: Scaffold the Railway Orchestrator Service

**Files:**
- Create: `orchestrator/package.json`
- Create: `orchestrator/tsconfig.json`
- Create: `orchestrator/vitest.config.ts`
- Create: `orchestrator/src/index.ts`
- Create: `orchestrator/src/config.ts`
- Create: `orchestrator/src/server.ts`
- Create: `orchestrator/src/routes/runtime.ts`
- Create: `orchestrator/src/routes/runtime.test.ts`

- [ ] **Step 1: Write the failing runtime route test**

```ts
import { describe, expect, it } from "vitest";
import { buildServer } from "../server";

describe("runtime routes", () => {
  it("rejects requests with the wrong shared secret", async () => {
    const server = buildServer();
    const res = await server.inject({
      method: "POST",
      url: "/runtime/start",
      headers: { "x-orchestrator-secret": "wrong" },
    });
    expect(res.statusCode).toBe(401);
  });
});
```

- [ ] **Step 2: Run the test to verify failure**

Run: `cd /Users/a/Desktop/vibelive/orchestrator && npm run test -- runtime.test.ts`

Expected: FAIL because the orchestrator service does not exist.

- [ ] **Step 3: Implement the minimal service skeleton**

```ts
// orchestrator/src/server.ts
import Fastify from "fastify";

export function buildServer() {
  const app = Fastify();
  app.post("/runtime/start", async (request, reply) => {
    if (request.headers["x-orchestrator-secret"] !== process.env.ORCHESTRATOR_SECRET) {
      return reply.code(401).send({ error: "unauthorized" });
    }
    return { ok: true };
  });
  return app;
}
```

- [ ] **Step 4: Run tests and start the service locally**

Run: `cd /Users/a/Desktop/vibelive/orchestrator && npm run test -- runtime.test.ts`

Run: `cd /Users/a/Desktop/vibelive/orchestrator && npm run dev`

Expected: PASS, then a local server listening on the configured port

- [ ] **Step 5: Commit**

```bash
git -C /Users/a/Desktop/vibelive add orchestrator
git -C /Users/a/Desktop/vibelive commit -m "feat: scaffold AI audience orchestrator service"
```

## Task 6: Build Room Manager and LiveKit Observer Plumbing

**Files:**
- Create: `orchestrator/src/types.ts`
- Create: `orchestrator/src/runtime/room-manager.ts`
- Create: `orchestrator/src/runtime/room-manager.test.ts`
- Create: `orchestrator/src/runtime/room-runtime.ts`
- Create: `orchestrator/src/runtime/livekit-observer.ts`
- Create: `orchestrator/src/runtime/chat-injector.ts`
- Modify: `orchestrator/src/routes/runtime.ts`
- Test: `orchestrator/src/runtime/room-manager.test.ts`
- Test: `orchestrator/src/routes/runtime.test.ts`

- [ ] **Step 1: Write the failing room manager test**

```ts
import { describe, expect, it } from "vitest";
import { RoomManager } from "./room-manager";

describe("RoomManager", () => {
  it("keeps only one runtime per room", () => {
    const manager = new RoomManager();
    manager.register("demo-room", {} as never);
    manager.register("demo-room", {} as never);
    expect(manager.count()).toBe(1);
  });
});
```

- [ ] **Step 2: Run the test to verify failure**

Run: `cd /Users/a/Desktop/vibelive/orchestrator && npm run test -- room-manager.test.ts runtime.test.ts`

Expected: FAIL because the manager and observer are not wired.

- [ ] **Step 3: Implement the manager and observer shell**

```ts
// orchestrator/src/runtime/room-manager.ts
export class RoomManager {
  private runtimes = new Map<string, unknown>();

  register(roomSlug: string, runtime: unknown) {
    this.runtimes.set(roomSlug, runtime);
  }

  count() {
    return this.runtimes.size;
  }
}
```

- [ ] **Step 4: Run tests and a local smoke check**

Run: `cd /Users/a/Desktop/vibelive/orchestrator && npm run test -- room-manager.test.ts runtime.test.ts`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git -C /Users/a/Desktop/vibelive add \
  orchestrator/src/types.ts \
  orchestrator/src/runtime/room-manager.ts \
  orchestrator/src/runtime/room-manager.test.ts \
  orchestrator/src/runtime/room-runtime.ts \
  orchestrator/src/runtime/livekit-observer.ts \
  orchestrator/src/runtime/chat-injector.ts \
  orchestrator/src/routes/runtime.ts \
  orchestrator/src/routes/runtime.test.ts
git -C /Users/a/Desktop/vibelive commit -m "feat: add room runtime manager and LiveKit observer shell"
```

## Task 7: Build the Shared Context Packet and Language Inference

**Files:**
- Create: `orchestrator/src/runtime/context-packet.ts`
- Create: `orchestrator/src/runtime/media-snapshotter.ts`
- Create: `orchestrator/src/runtime/transcript-window.ts`
- Create: `orchestrator/src/runtime/language.ts`
- Test: `orchestrator/src/runtime/context-packet.test.ts`
- Test: `orchestrator/src/runtime/language.test.ts`

- [ ] **Step 1: Write the failing context and language tests**

```ts
import { describe, expect, it } from "vitest";
import { inferRoomLanguage } from "./language";

describe("inferRoomLanguage", () => {
  it("prefers recent transcript language over title language", () => {
    expect(
      inferRoomLanguage({
        transcriptWindow: ["Let's ship this first"],
        chatWindow: [],
        roomTitle: "中文标题",
      }),
    ).toBe("en");
  });
});
```

- [ ] **Step 2: Run the tests to verify failure**

Run: `cd /Users/a/Desktop/vibelive/orchestrator && npm run test -- context-packet.test.ts language.test.ts`

Expected: FAIL because the packet and language logic do not exist.

- [ ] **Step 3: Implement the minimal context builder**

```ts
// orchestrator/src/runtime/context-packet.ts
export interface ContextPacket {
  room: { slug: string; title: string; stage: string; codingTool: string };
  chatWindow: Array<{ user: string; text: string; bot?: boolean }>;
  reactionWindow: Array<{ kind: string; count: number }>;
  audioWindow: string[];
  latestScreenshot: { url: string; capturedAt: number } | null;
  latestVideoClip: { url: string; capturedAt: number } | null;
  language: string;
}
```

- [ ] **Step 4: Run the tests to verify pass**

Run: `cd /Users/a/Desktop/vibelive/orchestrator && npm run test -- context-packet.test.ts language.test.ts`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git -C /Users/a/Desktop/vibelive add \
  orchestrator/src/runtime/context-packet.ts \
  orchestrator/src/runtime/media-snapshotter.ts \
  orchestrator/src/runtime/transcript-window.ts \
  orchestrator/src/runtime/language.ts \
  orchestrator/src/runtime/context-packet.test.ts \
  orchestrator/src/runtime/language.test.ts
git -C /Users/a/Desktop/vibelive commit -m "feat: add shared context packet assembly for AI audience"
```

## Task 8: Implement Persona Agents and the Lightweight Message Gate

**Files:**
- Create: `orchestrator/src/runtime/personas.ts`
- Create: `orchestrator/src/runtime/model-client.ts`
- Create: `orchestrator/src/runtime/agent-runner.ts`
- Create: `orchestrator/src/runtime/message-gate.ts`
- Test: `orchestrator/src/runtime/personas.test.ts`
- Test: `orchestrator/src/runtime/message-gate.test.ts`

- [ ] **Step 1: Write the failing gate test**

```ts
import { describe, expect, it } from "vitest";
import { MessageGate } from "./message-gate";

describe("MessageGate", () => {
  it("rejects near-duplicate bot messages within cooldown", () => {
    const gate = new MessageGate();
    expect(gate.accept("curious", "Why not split this hook?", 1000)).toBe(true);
    expect(gate.accept("builder", "Why not split this hook?", 2000)).toBe(false);
  });
});
```

- [ ] **Step 2: Run the tests to verify failure**

Run: `cd /Users/a/Desktop/vibelive/orchestrator && npm run test -- personas.test.ts message-gate.test.ts`

Expected: FAIL because the personas and gate do not exist.

- [ ] **Step 3: Implement minimal persona and gate logic**

```ts
// orchestrator/src/runtime/personas.ts
export const PERSONAS = [
  { key: "curious", displayName: "Nova" },
  { key: "builder", displayName: "Patch" },
  { key: "product", displayName: "Mina" },
  { key: "beginner", displayName: "Kai" },
  { key: "hype", displayName: "Zed" },
] as const;
```

```ts
// orchestrator/src/runtime/message-gate.ts
export class MessageGate {
  private lastTexts = new Map<string, number>();

  accept(persona: string, text: string, now: number) {
    const seenAt = this.lastTexts.get(text);
    if (seenAt && now - seenAt < 15_000) return false;
    this.lastTexts.set(text, now);
    return true;
  }
}
```

- [ ] **Step 4: Run the tests**

Run: `cd /Users/a/Desktop/vibelive/orchestrator && npm run test -- personas.test.ts message-gate.test.ts`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git -C /Users/a/Desktop/vibelive add \
  orchestrator/src/runtime/personas.ts \
  orchestrator/src/runtime/model-client.ts \
  orchestrator/src/runtime/agent-runner.ts \
  orchestrator/src/runtime/message-gate.ts \
  orchestrator/src/runtime/personas.test.ts \
  orchestrator/src/runtime/message-gate.test.ts
git -C /Users/a/Desktop/vibelive commit -m "feat: add persona agents and lightweight message gate"
```

## Task 9: Wire End-to-End Runtime Start, Message Injection, and Degraded Mode

**Files:**
- Modify: `orchestrator/src/runtime/room-runtime.ts`
- Create: `orchestrator/src/runtime/room-runtime.test.ts`
- Modify: `orchestrator/src/runtime/livekit-observer.ts`
- Modify: `orchestrator/src/runtime/agent-runner.ts`
- Modify: `orchestrator/src/runtime/chat-injector.ts`
- Modify: `app/src/app/watch/[room]/page.tsx`
- Test: `orchestrator/src/runtime/room-runtime.test.ts`
- Test: `orchestrator/src/routes/runtime.test.ts`
- Test: `orchestrator/src/runtime/message-gate.test.ts`

- [ ] **Step 1: Write the failing runtime behavior test**

```ts
import { describe, expect, it, vi } from "vitest";
import { RoomRuntime } from "./room-runtime";

describe("RoomRuntime", () => {
  it("skips message publish when no screenshot is available but continues running", async () => {
    const runtime = new RoomRuntime(/* mocked dependencies */);
    await expect(runtime.tick()).resolves.toBeUndefined();
  });
});
```

- [ ] **Step 2: Run the tests to verify failure**

Run: `cd /Users/a/Desktop/vibelive/orchestrator && npm run test -- runtime.test.ts message-gate.test.ts`

Expected: FAIL because the end-to-end runtime loop is not complete.

- [ ] **Step 3: Implement the minimal runtime loop**

```ts
// orchestrator/src/runtime/room-runtime.ts
const packet = await contextBuilder.build();
for (const persona of PERSONAS) {
  const decision = await agentRunner.decide(persona, packet);
  if (decision.type !== "speak") continue;
  if (!gate.accept(persona.key, decision.text, Date.now())) continue;
  await chatInjector.publish({
    user: persona.displayName,
    text: decision.text,
    bot: true,
    botPersona: persona.key,
  });
}
```

- [ ] **Step 4: Run the service test suite and app lint**

Run: `cd /Users/a/Desktop/vibelive/orchestrator && npm run test`

Run: `cd /Users/a/Desktop/vibelive/app && npm run lint`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git -C /Users/a/Desktop/vibelive add \
  orchestrator/src/runtime/room-runtime.ts \
  orchestrator/src/runtime/room-runtime.test.ts \
  orchestrator/src/runtime/livekit-observer.ts \
  orchestrator/src/runtime/agent-runner.ts \
  orchestrator/src/runtime/chat-injector.ts \
  app/src/app/watch/[room]/page.tsx
git -C /Users/a/Desktop/vibelive commit -m "feat: complete end-to-end AI audience runtime"
```

## Task 10: Deployment Wiring and Manual Validation Checklist

**Files:**
- Modify: `docs/superpowers/specs/2026-04-08-ai-audience-agents-design.md`
- Create: `orchestrator/README.md`

- [ ] **Step 1: Write the failing deployment checklist**

```md
- [ ] Railway service starts locally
- [ ] App can reach orchestrator start route
- [ ] Live room receives bot-badged messages
```

- [ ] **Step 2: Verify the checklist cannot yet be completed**

Run: manual local setup using `.env.local` and orchestrator env vars

Expected: at least one unchecked item before deployment docs exist

- [ ] **Step 3: Add deployment and operations notes**

```md
## Railway
- set `ORCHESTRATOR_SECRET`
- set LiveKit credentials
- set model provider credentials
```

- [ ] **Step 4: Run final verification**

Run: `cd /Users/a/Desktop/vibelive/orchestrator && npm run test`

Run: `cd /Users/a/Desktop/vibelive/app && npm run lint`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git -C /Users/a/Desktop/vibelive add \
  orchestrator/README.md \
  docs/superpowers/specs/2026-04-08-ai-audience-agents-design.md
git -C /Users/a/Desktop/vibelive commit -m "docs: add AI audience deployment notes"
```

## Notes for the Implementer

- Do not let AI audience participants inflate the viewer count. Any AI audience
  participant identity should be filtered out of viewer stats and online lists.
- Keep the watch-page chat payload backward compatible for human chat messages.
- Do not let the app fail closed if orchestrator start/stop requests fail.
- Keep the message gate minimal. If logic starts turning into a planner, stop.
- Do not add a persistent database table for bot memory in the MVP.
- The context packet should prefer fresh data over historical summaries.
- If direct LiveKit media capture proves too expensive or unstable in the first
  pass, keep the interfaces stable and degrade to partial multimodal inputs
  rather than blocking the whole feature.
