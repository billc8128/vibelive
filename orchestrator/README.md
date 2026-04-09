# AI Audience Orchestrator

Room-level worker service for VibeLive AI audience agents.

## Local Development

1. Install dependencies:

```bash
npm install
```

2. Set environment variables:

```bash
ORCHESTRATOR_SECRET=your-shared-secret
PORT=3100
NEXT_PUBLIC_LIVEKIT_URL=wss://your-livekit-host
LIVEKIT_API_KEY=your-livekit-key
LIVEKIT_API_SECRET=your-livekit-secret
```

3. Start the worker:

```bash
npm run dev
```

## Runtime Routes

- `POST /runtime/start`
- `POST /runtime/stop`
- `GET /runtime/usage`

Both routes require the `x-orchestrator-secret` header.

Usage/cost events are persisted to Postgres when `DATABASE_URL` is configured.
The orchestrator creates the `ai_audience_usage_events` table on startup/use. If
Postgres is unavailable, it falls back to in-memory usage data for the current
process.

## Railway

Set these variables in Railway:

- `ORCHESTRATOR_SECRET`
- `PORT`
- `NEXT_PUBLIC_LIVEKIT_URL`
- `LIVEKIT_API_KEY`
- `LIVEKIT_API_SECRET`
- `DATABASE_URL`
- `AI_AUDIENCE_MODEL_PROVIDER`
- `AI_AUDIENCE_MODEL_NAME`
- `AI_AUDIENCE_MODEL_API_KEY`

## Degraded Mode

If screenshots, video clips, or transcript input are unavailable, the runtime
still builds a context packet from room metadata and recent chat. The fallback
model emits short bot-badged prompts instead of failing closed.

## Manual Validation

- [ ] Railway service starts locally
- [ ] App can reach orchestrator start route
- [ ] Live room receives bot-badged messages
- [ ] AI audience identities do not inflate viewer counts
- [ ] Missing screenshot does not crash the runtime
