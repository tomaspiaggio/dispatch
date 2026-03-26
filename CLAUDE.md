# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
# Start backend (Nitro dev server on :3000)
pnpm dev:backend

# Open the terminal UI (requires backend running)
pnpm dispatch

# Start everything (backend + shared watcher via Turborepo)
pnpm dev

# Run tests (Vitest + Testcontainers — needs Docker running)
cd packages/backend && npx vitest run

# Run a single test file
cd packages/backend && npx vitest run tests/api.test.ts

# Push Prisma schema to DB
cd packages/backend && npx prisma db push

# Regenerate Prisma client after schema changes
cd packages/backend && npx prisma generate

# Rebuild shared package (needed after changing types/constants)
pnpm --filter @dispatch/shared build

# Start Postgres + Redis containers
pnpm docker:up
```

## Architecture

pnpm monorepo with Turborepo. Three packages:

- **`@dispatch/backend`** (`packages/backend/`) — Hono server running on Nitro with useWorkflow.dev for durable workflows. Handles Telegram (chat-sdk polling), Slack (Socket Mode), and HTTP API.
- **`@dispatch/shared`** (`packages/shared/`) — TypeScript types, model registry (`MODELS.AGENT`, `MODELS.FAST`), system prompt. Built with `tsc` to `dist/`, exports use `.js` extensions for ESM.
- **`@dispatch/cli`** (`packages/frontend/`) — Terminal UI built with Ink (React for CLI). Connects to backend API via HTTP polling.

## Workflow System (Critical)

The backend uses [useWorkflow.dev](https://useworkflow.dev) which compiles code with `"use workflow"` and `"use step"` directives via Nitro.

**Workflow functions** (`src/workflows/`) run in a **sandboxed environment**:
- ❌ Cannot import Node.js modules (`fs`, `path`, `os`, `child_process`)
- ❌ Cannot import packages that depend on Node.js modules (e.g., `chat-sdk`, `@chat-adapter/*`)
- ✅ Can import `workflow` (`getWritable`, `sleep`), `@workflow/ai` (`DurableAgent`, `google`), `ai` (`tool`), `zod`
- ✅ Can call step functions

**Step functions** (`src/steps/`) run with **full Node.js access**:
- ✅ Can use `fs`, `path`, `child_process`, Prisma, etc.
- Must use `"use step"` directive
- Node.js modules must be dynamically imported inside the step: `const { readFile } = await import("fs/promises")`
- Return values must be JSON-serializable

**Common mistake**: Importing a module at the top of a step file that uses Node.js at module scope will break the workflow compiler. All Node.js usage must be inside the `"use step"` function body via dynamic imports.

## Message Flow

```
Incoming message (Telegram/Slack/CLI)
  → Chat handler sends fast ack (MODELS.FAST)
  → start(handleMessageWorkflow, [serializable args])
  → Workflow: log user msg → load history → build system prompt → DurableAgent.stream()
  → Agent calls tools (each is a durable step)
  → Final response saved to DB via logMessageStep
  → Chat handler polls DB every 2s, posts new messages to platform
```

The workflow never posts directly to chat platforms. It writes to DB; the handler (running in the main process, outside the workflow sandbox) polls and delivers.

## Key Patterns

**Lazy imports in `src/index.ts`**: Chat handlers are imported with dynamic `import()` to prevent the workflow compiler from bundling chat-sdk's Node.js dependencies into the workflow sandbox.

**Database as message bus**: Workflows write to Postgres. Chat handlers poll for new messages. This decouples durable execution from chat delivery.

**Memory/Soul are markdown files** at `~/.dispatch/memories.md` and `~/.dispatch/soul.md`. Updated by spawning a sub-agent (MODELS.FAST) that intelligently merges instructions. Read into the system prompt at workflow start.

**Telegram uses `ALLOWED_TELEGRAM_IDS`** env var to restrict access (bots are public). Slack has no restriction (org-level auth).

**Slack uses `@slack/socket-mode` directly** (not chat-sdk). Events deduplicated by `channel:ts` key. Responds to all messages in channels the bot is in.

## Model Registry

Defined in `packages/shared/src/constants/index.ts`:
- `MODELS.AGENT` = `"gemini-3-flash-preview"` — main agent, tool calling
- `MODELS.FAST` = `"gemini-3.1-flash-lite-preview"` — acks, memory/soul sub-agents

All model references go through this registry. Provider is `@ai-sdk/google`. Inside workflows, use `google()` from `@workflow/ai/google` (not `@ai-sdk/google` directly) — it wraps model creation in a step for serialization.

## Database

Prisma 7 with `@prisma/adapter-pg`. Schema at `packages/backend/prisma/schema.prisma`. Two tables:
- `conversations` — keyed by `(platform, channelId, threadId)`
- `messages` — `role` is `user | assistant | tool | status`

Config in `prisma.config.ts` (Prisma 7 style — no `url` in `datasource`, uses config file instead).

## Testing

Vitest with Testcontainers for PostgreSQL. Tests spin up a real Postgres container per suite. `tests/setup.ts` handles container lifecycle and runs `prisma db push` against the test DB.
