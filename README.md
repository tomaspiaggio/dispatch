# Dispatch

AI agent platform that connects to Slack and Telegram. Every message becomes a durable workflow — if something breaks, you get a message about it instead of silence.

Both Slack and Telegram run over persistent connections (Socket Mode and polling respectively) — no public URL, no tunnels, no webhooks needed.

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

# 5. Start dev servers (backend + frontend)
pnpm dev
```

Frontend: http://localhost:5173
Backend: http://localhost:3000

---

## Slack Bot Setup (Socket Mode)

Socket Mode connects to Slack over a WebSocket — no public URL needed. Events flow through Slack's servers to your local machine.

### 1. Create a Slack App

1. Go to https://api.slack.com/apps
2. Click **Create New App** → **From scratch**
3. Name it `Dispatch` (or whatever you want), pick your workspace
4. Click **Create App**

### 2. Enable Socket Mode

1. In the left sidebar, go to **Socket Mode**
2. Toggle **Enable Socket Mode** to ON
3. You'll be prompted to generate an **App-Level Token**:
   - Give it a name like `dispatch-socket`
   - Add the scope `connections:write`
   - Click **Generate**
4. Copy the token (starts with `xapp-`) → paste as `SLACK_APP_TOKEN` in `.env`

### 3. Configure Bot Permissions

1. Go to **OAuth & Permissions** in the sidebar
2. Scroll to **Scopes** → **Bot Token Scopes** and add:
   - `app_mentions:read` — to receive @mentions
   - `chat:write` — to send messages
   - `channels:history` — to read channel messages
   - `groups:history` — to read private channel messages
   - `im:history` — to read DMs
   - `im:write` — to send DMs
   - `mpim:history` — to read group DMs

### 4. Install to Workspace

1. Still on **OAuth & Permissions**
2. Click **Install to Workspace** → **Allow**
3. Copy the **Bot User OAuth Token** (starts with `xoxb-`) → paste as `SLACK_BOT_TOKEN` in `.env`

### 5. Get Signing Secret

1. Go to **Basic Information**
2. Under **App Credentials**, copy the **Signing Secret** → paste as `SLACK_SIGNING_SECRET` in `.env`

### 6. Subscribe to Events

1. Go to **Event Subscriptions** in the sidebar
2. Toggle **Enable Events** to ON
3. You do NOT need to set a Request URL — Socket Mode handles delivery
4. Under **Subscribe to bot events**, add:
   - `app_mention` — triggers when someone @mentions the bot
   - `message.im` — triggers on DMs to the bot
5. Click **Save Changes**

### 7. Invite the Bot

In Slack, invite the bot to a channel:

```
/invite @Dispatch
```

Mention it with `@Dispatch do something` and it will respond.

---

## Telegram Bot Setup (Polling)

The bot uses long polling to fetch messages from Telegram — no public URL or webhook needed.

### 1. Create a Bot with BotFather

1. Open Telegram and search for **@BotFather**
2. Start a chat and send `/newbot`
3. BotFather asks for a **name** — this is the display name (e.g., `Dispatch`)
4. Then it asks for a **username** — must end in `bot` (e.g., `dispatch_bot`)
5. BotFather replies with your **bot token**:
   ```
   123456789:ABCdefGHIjklMNOpqrsTUVwxyz
   ```
6. Copy this token → paste as `TELEGRAM_BOT_TOKEN` in `.env`

### 2. Configure the Bot via BotFather

These are all optional but recommended. Send each command to @BotFather:

**Set description** (shown when users first open the bot):
```
/setdescription
```
Select your bot, then type: `AI assistant with full tool access`

**Set about text** (shown in the bot's profile):
```
/setabouttext
```

**Set commands** (shows a menu in the chat):
```
/setcommands
```
Then send:
```
help - Show what I can do
status - Check if I'm running
```

**Set bot picture**:
```
/setuserpic
```
Then send a photo.

### 3. Set Privacy Mode (for group chats)

By default, bots in groups only receive messages that @mention them or reply to them. To let the bot see all group messages:

1. Send `/setprivacy` to @BotFather
2. Select your bot
3. Choose **Disable**

> DMs always work regardless of this setting.

### 4. Remove Any Existing Webhook

If you previously set a webhook, clear it so polling works:

```bash
curl "https://api.telegram.org/bot<BOT_TOKEN>/deleteWebhook"
```

The adapter does this automatically on startup, but it doesn't hurt to do it manually.

### 5. Test It

Start the server (`pnpm dev`), open a chat with your bot in Telegram, and send a message. It should respond.

---

## How It Works (No Webhooks)

| Platform | Connection Method | How |
|----------|------------------|-----|
| **Slack** | Socket Mode (WebSocket) | `@slack/socket-mode` opens a persistent WebSocket to Slack's servers. Events are pushed to your local machine instantly. |
| **Telegram** | Long Polling | The adapter calls Telegram's `getUpdates` API in a loop, fetching new messages every ~30s (or instantly when messages arrive). |

Both methods work behind firewalls, NATs, and on local machines with no port forwarding needed.

---

## Environment Variables

| Variable | Description |
|---|---|
| `GOOGLE_GENERATIVE_AI_API_KEY` | Google AI Studio API key for Gemini |
| `SLACK_BOT_TOKEN` | Slack Bot User OAuth Token (`xoxb-...`) |
| `SLACK_APP_TOKEN` | Slack App-Level Token for Socket Mode (`xapp-...`) |
| `SLACK_SIGNING_SECRET` | Slack app signing secret |
| `TELEGRAM_BOT_TOKEN` | Telegram bot token from BotFather |
| `DATABASE_URL` | PostgreSQL connection string |
| `REDIS_URL` | Redis connection string |
| `WORKFLOW_TARGET_WORLD` | Workflow persistence backend |
| `PLAYWRIGHT_MCP_URL` | Playwright MCP server URL |

## Scripts

| Command | Description |
|---|---|
| `pnpm dev` | Start all dev servers (backend + frontend) |
| `pnpm build` | Build all packages |
| `pnpm test` | Run tests |
| `pnpm docker:up` | Start Postgres + Redis containers |
| `pnpm docker:down` | Stop containers |
| `pnpm setup` | Full setup: docker + prisma generate + db push |
| `pnpm db:studio` | Open Prisma Studio (DB GUI) |
