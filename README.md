# Dispatch

AI agent platform that connects to Slack, Telegram, and a terminal UI. Every message becomes a durable workflow — if something breaks, you get a message about it instead of silence.

All connections are persistent (Socket Mode, polling, API) — no public URL, no tunnels, no webhooks needed.

## Quick Start

```bash
# 1. Install dependencies
pnpm install

# 2. Start Postgres + Redis
pnpm docker:up

# 3. Copy env and fill in your keys
cp .env.example .env

# 4. Generate Prisma client + push schema
pnpm setup

# 5. Start the backend
pnpm dev:backend

# 6. In another terminal, open the TUI
pnpm dispatch
```

## Usage

### Terminal UI

```bash
pnpm dispatch
```

Chat interface in your terminal. Type messages, get responses in real-time.

| Command | Action |
|---|---|
| `/new` | Start a fresh conversation |
| `/list` | Browse past conversations (↑↓ Enter) |
| `/quit` | Exit |
| `Ctrl+C` | Exit |

To connect to a remote backend:
```bash
DISPATCH_API_URL=http://your-server:3000 pnpm dispatch
```

### Telegram

DM your bot or add it to a group. It responds to all messages. Send `/new` to start a fresh conversation.

### Slack

The bot listens to all messages in channels it's invited to. Top-level messages start new conversations, thread replies continue them.

- `@Dispatch <message>` — mention the bot
- `/dispatch <message>` — slash command
- `/new` — fresh conversation
- Just type in a channel — it responds to everything

---

## Slack Bot Setup (Socket Mode)

Socket Mode connects to Slack over a WebSocket — no public URL needed.

### 1. Create a Slack App

1. Go to https://api.slack.com/apps
2. Click **Create New App** → **From scratch** (or use a manifest)
3. Name it `Dispatch`, pick your workspace

### 2. Enable Socket Mode

1. Go to **Socket Mode** in the sidebar
2. Toggle **Enable Socket Mode** to ON
3. Generate an **App-Level Token**:
   - Name: `dispatch-socket`
   - Scope: `connections:write`
4. Copy the token (`xapp-...`) → `SLACK_APP_TOKEN` in `.env`

### 3. Configure Bot Permissions

Go to **OAuth & Permissions** → **Bot Token Scopes** and add:
- `app_mentions:read`, `chat:write`, `commands`
- `channels:history`, `channels:read`
- `groups:history`, `im:history`, `im:read`, `im:write`
- `mpim:history`, `mpim:read`, `mpim:write`
- `users:read`, `reactions:read`, `reactions:write`
- `files:read`, `files:write`

### 4. Install to Workspace

1. Go to **OAuth & Permissions** → **Install to Workspace** → **Allow**
2. Copy the **Bot User OAuth Token** (`xoxb-...`) → `SLACK_BOT_TOKEN` in `.env`

### 5. Subscribe to Events

1. Go to **Event Subscriptions** → toggle ON
2. No Request URL needed (Socket Mode handles delivery)
3. Under **Subscribe to bot events**, add:
   - `app_mention`, `message.channels`, `message.groups`, `message.im`, `message.mpim`
4. **Save Changes**

### 6. Invite the Bot

```
/invite @Dispatch
```

---

## Telegram Bot Setup (Polling)

The bot uses long polling — no public URL or webhook needed.

### 1. Create a Bot with BotFather

1. Open Telegram → search **@BotFather**
2. Send `/newbot`
3. Set a name (e.g., `Dispatch`) and username (must end in `bot`)
4. Copy the token → `TELEGRAM_BOT_TOKEN` in `.env`

### 2. Configure via BotFather (optional)

```
/setdescription   → AI assistant with full tool access
/setcommands      → new - Start a new session
/setprivacy       → Disable (to see all group messages)
```

### 3. Restrict Access

Telegram bots are public. Restrict to your user ID only:

1. Message **@userinfobot** on Telegram to get your numeric user ID
2. Set `ALLOWED_TELEGRAM_IDS=your_id` in `.env`

Anyone else who messages the bot will be silently ignored.

### 4. Test It

Start the backend (`pnpm dev:backend`), open a chat with your bot, send a message.

---

## How It Works

| Platform | Connection | Details |
|----------|-----------|---------|
| **Terminal** | HTTP API | TUI polls `localhost:3000` every 2s |
| **Slack** | Socket Mode | WebSocket via `@slack/socket-mode` — events pushed instantly |
| **Telegram** | Long Polling | `getUpdates` loop via chat-sdk — messages arrive instantly |

Every incoming message (from any platform) triggers a durable workflow:
1. Fast contextual ack via `gemini-3.1-flash-lite-preview`
2. Main agent runs via `gemini-3-flash-preview` with full tool access
3. Response saved to DB → delivered back to the platform
4. If anything fails, the error is always reported to the user

---

## Environment Variables

| Variable | Description |
|---|---|
| `GOOGLE_GENERATIVE_AI_API_KEY` | Google AI Studio API key |
| `SLACK_BOT_TOKEN` | Slack Bot User OAuth Token (`xoxb-...`) |
| `SLACK_APP_TOKEN` | Slack App-Level Token for Socket Mode (`xapp-...`) |
| `TELEGRAM_BOT_TOKEN` | Telegram bot token from BotFather |
| `ALLOWED_TELEGRAM_IDS` | Comma-separated Telegram user IDs (empty = allow all) |
| `DATABASE_URL` | PostgreSQL connection string |
| `WORKFLOW_POSTGRES_URL` | Postgres URL for workflow durability (usually same as DATABASE_URL) |
| `REDIS_URL` | Redis connection string |
| `DISPATCH_API_URL` | Backend URL for the TUI (default: `http://localhost:3000`) |
| `PLAYWRIGHT_MCP_URL` | Playwright MCP server URL |

## Scripts

| Command | Description |
|---|---|
| `pnpm dev:backend` | Start the backend (Nitro + workflows) |
| `pnpm dispatch` | Open the terminal UI |
| `pnpm dev` | Start everything (backend + shared watcher) |
| `pnpm build` | Build all packages |
| `pnpm test` | Run tests |
| `pnpm docker:up` | Start Postgres + Redis containers |
| `pnpm docker:down` | Stop containers |
| `pnpm setup` | Full setup: docker + prisma generate + db push |
| `pnpm db:studio` | Open Prisma Studio (DB GUI) |

## Deploy as a Daemon (Raspberry Pi / Linux)

Run Dispatch as a systemd service that **starts on boot**, **restarts on crash**, and **survives SSH disconnects**.

### Prerequisites

```bash
# Node.js 22+
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt install -y nodejs

# pnpm
npm i -g pnpm@10

# Docker + Docker Compose
# https://docs.docker.com/engine/install/debian/
# After install: sudo usermod -aG docker $USER && newgrp docker

# Git
sudo apt install -y git
```

### Full setup from scratch

```bash
# 1. Clone
git clone https://github.com/your-org/dispatch.git
cd dispatch

# 2. Create .env with your keys
cp .env.example .env
nano .env
```

Required `.env` values:
```env
GOOGLE_GENERATIVE_AI_API_KEY=...       # from https://aistudio.google.com/apikey
TELEGRAM_BOT_TOKEN=...                 # from @BotFather on Telegram
ALLOWED_TELEGRAM_IDS=...               # your Telegram user ID (from @userinfobot)
DATABASE_URL=postgres://dispatch:dispatch@localhost:5432/dispatch
WORKFLOW_POSTGRES_URL=postgres://dispatch:dispatch@localhost:5432/dispatch
REDIS_URL=redis://localhost:6379
```

```bash
# 3. Run the installer — does everything
./scripts/install-service.sh
```

The installer:
1. `pnpm install` — dependencies
2. `prisma generate` — database client
3. `turbo build` — shared → backend → cli
4. `docker compose up -d` — Postgres + Redis containers
5. `workflow-postgres-setup` — workflow durability tables
6. `prisma db push` — app tables (conversations, messages)
7. Creates systemd service at `~/.config/systemd/user/dispatch.service`
8. Enables **lingering** — service runs without a login session
9. Starts the service

### Custom env file location

```bash
./scripts/install-service.sh /home/pi/my-dispatch.env
```

The systemd service will use this path for `EnvironmentFile=`.

### Will it restart on reboot?

**Yes.** Three things ensure this:
- `loginctl enable-linger $USER` — user services start at boot, not at login
- `WantedBy=default.target` — service is part of the default startup
- `Restart=always` + `RestartSec=5` — restarts on crash after 5 seconds

### Managing the service

```bash
systemctl --user status dispatch        # is it running?
systemctl --user restart dispatch       # restart (after env or code changes)
systemctl --user stop dispatch          # stop
journalctl --user -u dispatch -f        # follow logs live
journalctl --user -u dispatch -n 100    # last 100 log lines
journalctl --user -u dispatch --since today  # today's logs
```

### Updating

```bash
cd /path/to/dispatch
git pull
./scripts/install-service.sh
```

The installer is idempotent — rebuilds, re-pushes schema, restarts the service.

### Uninstall

```bash
./scripts/uninstall-service.sh
# Docker containers + data are NOT removed. To remove:
docker compose down -v
```

### Where things live

| Path | Purpose |
|---|---|
| `~/.config/systemd/user/dispatch.service` | systemd service unit |
| `~/.dispatch/soul.md` | Agent identity — name, tone, personality |
| `~/.dispatch/memories.md` | Persistent instructions and preferences |
| `.env` (or custom path) | API keys, tokens, database URLs |
| Docker volumes `dispatch_pgdata`, `dispatch_redisdata` | Database + Redis data |
