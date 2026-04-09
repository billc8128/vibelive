# AI Audience Agents Design

## Summary

This feature adds a room-level AI audience system for live rooms in VibeLive.
When a room goes live, the platform can start a shared multimodal context builder
plus five independent audience agents. Each agent behaves like a lightweight
audience persona that can post short, reply-worthy chat messages to make the
stream more engaging.

This is explicitly not a fake "growth" or vanity system. The product behavior
must remain distinguishable from real users: bot messages render with a bot
badge in chat. Usernames may be natural, but the UI must disclose bot status on
each message.

The MVP favors believable, useful interaction over complex memory and long-term
simulation. It should make the stream feel more alive without turning the room
into bot chatter.

## Product Goals

- Increase streamer engagement during live coding sessions.
- Generate short comments that a streamer is likely to reply to.
- Use room context, not canned scripts, to decide what to say.
- Preserve the feeling of multiple independent audience viewpoints.
- Keep the system simple enough to ship as an MVP.

## Non-Goals

- No attempt to impersonate real users at the identity or UI level.
- No long-term social memory or persistent bot relationships.
- No bot-to-bot roleplay or staged multi-bot conversations.
- No complex topic graph, thread memory, or conversation planning layer.
- No frame-by-frame video intelligence pipeline in the MVP.
- No requirement that Vercel host the long-running orchestration runtime.

## Current Codebase Context

Relevant existing pieces:

- `app/src/app/go-live/page.tsx`
  - Current creator dashboard and persistent channel settings UI.
- `app/src/app/watch/[room]/page.tsx`
  - Current watch page, chat rendering, reactions, and LiveKit data handling.
- `app/src/app/api/channels/route.ts`
  - Channel settings persistence via `channels.settings` JSONB.
- `app/src/app/api/streams/route.ts`
  - Live session start/stop lifecycle.
- `app/src/app/api/livekit/token/route.ts`
  - Viewer/publisher token issuance.
- `app/src/lib/livekit/server.ts`
  - Shared LiveKit server SDK access.

Important current constraint:

- Chat is currently room-local and largely driven by the watch page plus
  LiveKit data messages, not by a dedicated server-side chat service.

## User Experience

### Streamer-facing behavior

- In channel settings / go-live settings, the streamer can enable AI audience.
- Default AI audience count is `5`.
- The MVP should expose a simple intensity control:
  - `low`
  - `medium`
  - `high`
- Default intensity is `medium`.
- The system starts when the room goes live and stops when the room ends.

### Viewer-facing behavior

- AI audience messages appear in the normal chat stream.
- Each AI message must include a bot badge in the UI.
- Usernames can look natural, but the badge must be clearly visible.
- AI audience should feel present but not dominant.

### Language behavior

- Agents must not default to Chinese or English.
- Each message should follow the room's current language context.
- Language selection should derive from:
  1. recent audio transcript
  2. recent chat language
  3. room title / metadata language
- In mixed-language rooms, the default should be the streamer's current
  speaking language, not a global room default.

## MVP Scope

### In scope

- Shared room context builder.
- Five independent audience agents per enabled live room.
- Room-level multimodal context packet injection.
- Agent personas with light role separation.
- Short bot comments in the existing chat stream.
- Bot badge rendering in the watch page.
- Minimal dedupe and cooldown gating.
- Vercel app integration with an external orchestrator service.

### Out of scope

- Persistent memory across sessions.
- Advanced conversation state tracking.
- Fine-grained bot scheduling heuristics beyond lightweight gating.
- Bot-to-bot discussion.
- Historical per-streamer agent customization.
- Advanced analytics dashboards.

## Recommended Architecture

### 1. Shared Room Context Builder

One runtime per live room builds a shared `context packet` for all agents. This
layer gathers and packages source inputs; it does not act as a central "brain"
that decides what every agent should say.

Inputs:

- Room metadata
  - room slug
  - stream title
  - project name
  - project stage
  - coding tool
  - elapsed live duration
- Recent chat messages
- Recent reaction activity
- Recent audio transcript window
- Latest screenshot
- Latest short video clip reference

Output:

- A room-level `context packet` containing recent raw inputs and lightweight
  metadata suitable for agent injection.

### 2. Independent Audience Agents

Each room starts five agent threads. They share the same context packet but
make independent decisions.

Initial personas:

- `curious`
- `builder`
- `product`
- `beginner`
- `hype`

Each agent can only decide:

- `hold`
- `speak`

If it chooses `speak`, it returns one short message candidate plus light
metadata such as target and rationale.

### 3. Lightweight Message Gate

This is not a planner. It only prevents obvious failure modes:

- near-duplicate messages
- rapid bot bursts
- repeated follow-up on the same just-addressed point
- bot-to-bot chaining

This layer must be intentionally small in the MVP.

### 4. Chat Injection Adapter

The final message is injected into the existing room chat path and rendered by
the current watch page chat UI with a bot badge.

## Deployment Model

### Vercel responsibilities

Keep these in the existing app:

- channel settings UI
- watch page bot badge rendering
- live start / stop triggers
- public APIs and auth
- channel configuration persistence

### Railway responsibilities

Run a dedicated long-lived `AI Audience Orchestrator` service on Railway:

- room runtime lifecycle
- multimodal context building
- agent execution
- lightweight gating
- chat injection

### Why split deployment

The audience runtime is room-scoped, long-lived, and multimodal. It is a poor
fit for Vercel request-driven functions with bounded execution time. A Railway
service is a better host for continuously running room workers.

## Context Packet Design

The MVP `context packet` should be intentionally small and fresh.

Suggested contents:

- `room`
  - slug
  - title
  - project name
  - stage
  - coding tool
  - started_at
  - intensity
- `chat_window`
  - last 20 messages
- `reaction_window`
  - recent reaction counters or deltas
- `audio_window`
  - last 30-60 seconds of transcript
- `latest_screenshot`
  - image reference plus timestamp
- `latest_video_clip`
  - clip reference plus timestamp

The packet should favor recency over history. The goal is to help agents react
to the current moment, not reconstruct the full session.

## Agent Behavior Rules

### Core behavior

Messages should be:

- short
- conversational
- relevant to the live moment
- likely to invite a response

### Allowed comment types

- follow-up question
- implementation reminder
- product prompt
- lightweight affirmation

### Disallowed comment types

- long analysis
- multi-paragraph reasoning
- fake prior relationship with the streamer
- synthetic inside jokes or invented history
- repeated hype spam
- direct bot-to-bot conversation

### Soft activity target

The system should aim for the feel of roughly `3-5` bot messages per minute
across the room at medium intensity, but this is a soft target, not a hard
rule. Agents should still decide based on context.

## Data Model Changes

Use `channels.settings` for MVP configuration.

New allowed settings keys:

- `ai_audience_enabled: boolean`
- `ai_audience_count: number`
- `ai_audience_intensity: "low" | "medium" | "high"`

No new primary database tables are required for the first version.

Optional later additions:

- event mirror tables
- bot message audit log
- orchestrator heartbeat table

## Integration Plan at a System Level

### On stream start

When a stream successfully becomes live:

1. existing app creates/starts the live session
2. existing app calls orchestrator `start-room-runtime`
3. orchestrator starts context builder + five agents

### During the stream

1. room events and chat are mirrored to orchestrator
2. orchestrator refreshes multimodal context
3. agents evaluate whether to speak
4. message gate accepts or rejects candidates
5. accepted messages are injected into chat

### On stream end

1. existing app calls orchestrator `stop-room-runtime`
2. orchestrator tears down room workers
3. transient room state is discarded

## Failure Handling

### Orchestrator unavailable

- Stream must continue normally.
- AI audience silently disables for that room.
- Watch page chat must remain functional for human users.

### Media capture unavailable

- Degrade gracefully to text-heavy context:
  - chat
  - reactions
  - room metadata
  - whatever transcript is available
- Do not block all agent activity if one modality fails.

### Transcript unavailable

- Continue using screenshot + clip + chat context.

### Chat injection failure

- Drop the message and continue runtime.
- Do not retry aggressively in a way that could duplicate messages.

### Excessive bot activity

- Gate must reject bursts.
- Intensity can be lowered dynamically by runtime policy, but MVP should avoid
  adding complex adaptive policy code.

## Security and Disclosure

- Bot messages must always render with a bot badge.
- Bot messages must never claim to be real users.
- The system should avoid storing more media than needed for current context.
- Model prompts must not expose secrets or service credentials to agents.

## Testing Strategy

### Unit tests

- context packet assembly
- allowed settings validation
- message gate dedupe behavior
- language selection from context hints
- persona prompt / output normalization

### Integration tests

- stream start triggers orchestrator start
- stream stop triggers orchestrator teardown
- bot message rendering includes badge
- degraded mode still works when screenshot or transcript is missing

### Manual validation

- room with no human chat
- room with active human chat
- Chinese stream
- English stream
- mixed-language stream
- stream with transcript but no useful visual context
- stream with useful visual context but no transcript

## Rollout Strategy

Start with:

- streamer opt-in only
- fixed count of 5
- medium intensity default
- no advanced analytics

After MVP quality is acceptable, expand to:

- better persona tuning
- more reliable chat mirroring
- richer moderation / safety controls
- operational dashboards

## Deployment Notes

### Railway service

- Run the room orchestrator as a long-lived Railway service.
- Configure `ORCHESTRATOR_SECRET` and match it with the app-side
  `AI_AUDIENCE_ORCHESTRATOR_SECRET`.
- Provide LiveKit server credentials so the orchestrator can publish bot chat
  messages with `RoomServiceClient.sendData`.
- Keep `SUPABASE_SERVICE_ROLE_KEY` available for future room-state reads, even
  if the current degraded mode only needs room metadata from the app payload.

### Current degraded mode

- If transcript, screenshot, or short clip input is missing, the runtime still
  ticks using room title, stage, coding tool, and recent chat.
- The fallback model emits one short bot-badged message at a time rather than
  failing the room runtime.
- Viewer counts remain protected because AI audience identities use a reserved
  prefix and the watch page filters them out.

### Manual deployment checklist

- [ ] Railway service starts locally
- [ ] App can reach orchestrator start route
- [ ] Live room receives bot-badged messages
- [ ] AI audience identities do not inflate viewer counts
- [ ] Missing screenshot does not crash the runtime

## Open Decisions Resolved

- Disclosure mode: natural usernames plus visible bot badge on each message
- Context scope: full multimodal MVP direction
- Agent topology: shared context builder plus five independent agent threads
- Interaction target: streamer first, occasional audience replies allowed
- Deployment: Vercel for app, Railway for orchestrator

## Next Step

If this design is accepted, the next artifact should be an implementation plan
that breaks the work into small, testable tasks across:

- app configuration and UI
- chat schema and rendering
- orchestrator service skeleton
- room lifecycle integration
- context builder
- independent agent runtime
- message gate
