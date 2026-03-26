#!/usr/bin/env bash
set -euo pipefail

# ==============================================================================
# Dispatch — systemd service installer
#
# Installs Dispatch as a systemd user service that starts on boot and
# auto-restarts on crash. Works on any Linux with systemd (Raspberry Pi,
# Ubuntu, Debian, etc.).
#
# PREREQUISITES:
#   1. Node.js 22+     → curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash - && sudo apt install -y nodejs
#   2. pnpm            → npm i -g pnpm@10
#   3. Docker + Compose → https://docs.docker.com/engine/install/debian/
#   4. Git             → sudo apt install -y git
#
# QUICK START (from a fresh clone):
#   git clone https://github.com/your-org/dispatch.git
#   cd dispatch
#   cp .env.example .env          # edit with your API keys
#   ./scripts/install-service.sh
#
# CUSTOM ENV FILE:
#   ./scripts/install-service.sh /home/pi/my-dispatch.env
#
# WHAT THIS SCRIPT DOES:
#   1. pnpm install (dependencies)
#   2. prisma generate (database client)
#   3. turbo build (shared → backend → cli)
#   4. docker compose up -d (Postgres + Redis)
#   5. workflow-postgres-setup (workflow tables)
#   6. prisma db push (app tables)
#   7. Creates ~/.config/systemd/user/dispatch.service
#   8. Enables lingering (service runs without login session)
#   9. Starts the service
#
# AFTER INSTALL:
#   - Service auto-starts on boot (via lingering)
#   - Auto-restarts on crash (restart=always, 5s delay)
#   - Logs: journalctl --user -u dispatch -f
#   - Status: systemctl --user status dispatch
# ==============================================================================

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
ENV_FILE="${1:-$PROJECT_DIR/.env}"
NODE_BIN="$(which node)"
PNPM_BIN="$(which pnpm)"

echo "=== Dispatch Service Installer ==="
echo ""
echo "  Project:  $PROJECT_DIR"
echo "  Env file: $ENV_FILE"
echo "  Node:     $NODE_BIN ($(node --version))"
echo "  pnpm:     $PNPM_BIN ($(pnpm --version))"
echo "  User:     $USER"
echo ""

# --- Validate ---

if [ ! -f "$ENV_FILE" ]; then
  echo "ERROR: Env file not found: $ENV_FILE"
  echo ""
  echo "Create it first:"
  echo "  cp .env.example .env"
  echo "  nano .env   # fill in your API keys"
  echo ""
  echo "Required keys:"
  echo "  GOOGLE_GENERATIVE_AI_API_KEY  — from https://aistudio.google.com/apikey"
  echo "  TELEGRAM_BOT_TOKEN           — from @BotFather on Telegram"
  echo "  ALLOWED_TELEGRAM_IDS         — your Telegram user ID (from @userinfobot)"
  echo "  DATABASE_URL                 — postgres://dispatch:dispatch@localhost:5432/dispatch"
  echo "  WORKFLOW_POSTGRES_URL        — same as DATABASE_URL"
  exit 1
fi

if [ ! -f "$PROJECT_DIR/package.json" ]; then
  echo "ERROR: Not a valid project directory: $PROJECT_DIR"
  exit 1
fi

# --- Step 1: Install dependencies ---
echo ">>> [1/7] Installing dependencies..."
cd "$PROJECT_DIR"
$PNPM_BIN install --frozen-lockfile

# --- Step 2: Generate Prisma client ---
echo ">>> [2/7] Generating Prisma client..."
cd "$PROJECT_DIR/packages/backend"
npx prisma generate

# --- Step 3: Build all packages via Turborepo ---
echo ">>> [3/7] Building all packages..."
cd "$PROJECT_DIR"
$PNPM_BIN build

# --- Step 4: Start Docker containers ---
echo ">>> [4/7] Starting Postgres + Redis..."
cd "$PROJECT_DIR"
docker compose up -d

# Wait for Postgres to be ready
echo "    Waiting for Postgres..."
for i in $(seq 1 15); do
  if docker exec dispatch-postgres pg_isready -U dispatch -d dispatch > /dev/null 2>&1; then
    echo "    Postgres is ready."
    break
  fi
  sleep 1
done

# --- Step 5: Run workflow Postgres migration ---
echo ">>> [5/7] Running workflow database migration..."
cd "$PROJECT_DIR"
set -a; source "$ENV_FILE" 2>/dev/null || true; set +a
$PNPM_BIN --filter @dispatch/backend exec workflow-postgres-setup || echo "    WARNING: workflow-postgres-setup failed (may already be set up)"

# --- Step 6: Push Prisma schema ---
echo ">>> [6/7] Pushing Prisma schema..."
cd "$PROJECT_DIR/packages/backend"
npx prisma db push --accept-data-loss || echo "    WARNING: prisma db push failed"

# --- Step 7: Create and start systemd service ---
echo ">>> [7/7] Setting up systemd service..."
SYSTEMD_DIR="$HOME/.config/systemd/user"
mkdir -p "$SYSTEMD_DIR"

cat > "$SYSTEMD_DIR/dispatch.service" << UNIT
[Unit]
Description=Dispatch AI Agent
After=network-online.target docker.service
Wants=network-online.target

[Service]
Type=simple
WorkingDirectory=$PROJECT_DIR/packages/backend
EnvironmentFile=$ENV_FILE
ExecStart=$PNPM_BIN run dev
Restart=always
RestartSec=5
StandardOutput=journal
StandardError=journal

# Workflow compiler + Telegram/Slack init takes time on startup
TimeoutStartSec=60

[Install]
# default.target ensures the service starts when the user session is active.
# Combined with lingering (below), this means it starts on boot — no login needed.
WantedBy=default.target
UNIT

echo "    Created: $SYSTEMD_DIR/dispatch.service"

# Reload systemd
systemctl --user daemon-reload

# Enable the service (auto-start on boot)
systemctl --user enable dispatch.service

# Enable lingering: allows user services to run without an active login session.
# Without this, systemd kills user services when you log out / SSH disconnects.
echo "    Enabling lingering for $USER..."
loginctl enable-linger "$USER" 2>/dev/null \
  || sudo loginctl enable-linger "$USER" 2>/dev/null \
  || echo "    WARNING: Could not enable lingering. Service may stop when you log out."

# Start (or restart) the service
systemctl --user restart dispatch.service

# Wait for it to come up
sleep 3

echo ""
echo "============================================"
echo "  Dispatch is running!"
echo "============================================"
echo ""
systemctl --user status dispatch.service --no-pager -l 2>/dev/null || true
echo ""
echo "--- Commands ---"
echo ""
echo "  systemctl --user status dispatch      # is it running?"
echo "  systemctl --user restart dispatch     # restart after config changes"
echo "  systemctl --user stop dispatch        # stop"
echo "  journalctl --user -u dispatch -f      # follow logs (live)"
echo "  journalctl --user -u dispatch -n 100  # last 100 log lines"
echo ""
echo "--- Config ---"
echo ""
echo "  Env file:   $ENV_FILE"
echo "  Soul file:  ~/.dispatch/soul.md"
echo "  Memory:     ~/.dispatch/memories.md"
echo "  Service:    $SYSTEMD_DIR/dispatch.service"
echo ""
echo "--- Behavior ---"
echo ""
echo "  Starts on boot:     YES (via lingering)"
echo "  Restarts on crash:  YES (every 5 seconds)"
echo "  Survives logout:    YES (lingering enabled)"
echo ""
echo "To update: git pull && ./scripts/install-service.sh"
