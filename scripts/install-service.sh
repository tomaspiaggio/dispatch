#!/usr/bin/env bash
set -euo pipefail

# Install Dispatch as a systemd user service.
#
# Usage:
#   ./scripts/install-service.sh                          # uses .env from project root
#   ./scripts/install-service.sh /path/to/custom.env      # custom env file location
#
# This script:
#   1. Builds the project (shared + backend)
#   2. Creates a systemd user service (~/.config/systemd/user/dispatch.service)
#   3. Enables it to start on boot (via lingering)
#   4. Starts the service
#
# Prerequisites:
#   - Node.js 22+
#   - pnpm installed
#   - Docker running (for Postgres + Redis)
#   - systemd with user sessions (Linux / Raspberry Pi)

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
ENV_FILE="${1:-$PROJECT_DIR/.env}"
NODE_BIN="$(which node)"
PNPM_BIN="$(which pnpm)"

echo "=== Dispatch Service Installer ==="
echo "Project dir: $PROJECT_DIR"
echo "Env file:    $ENV_FILE"
echo "Node:        $NODE_BIN"
echo ""

# Validate
if [ ! -f "$ENV_FILE" ]; then
  echo "ERROR: Env file not found: $ENV_FILE"
  echo "Copy .env.example to .env and fill in your keys first."
  exit 1
fi

if [ ! -f "$PROJECT_DIR/package.json" ]; then
  echo "ERROR: Not a valid project directory: $PROJECT_DIR"
  exit 1
fi

# Step 1: Install dependencies
echo ">>> Installing dependencies..."
cd "$PROJECT_DIR"
$PNPM_BIN install --frozen-lockfile

# Step 2: Generate Prisma client + build everything via Turborepo
echo ">>> Generating Prisma client..."
cd "$PROJECT_DIR/packages/backend"
npx prisma generate

echo ">>> Building all packages (via Turborepo)..."
cd "$PROJECT_DIR"
$PNPM_BIN build

# Step 3: Start Docker containers (if not already running)
echo ">>> Ensuring Docker containers are running..."
cd "$PROJECT_DIR"
docker compose up -d

# Step 4: Push DB schema
echo ">>> Pushing database schema..."
cd "$PROJECT_DIR/packages/backend"
# Load env for DATABASE_URL
set -a; source "$ENV_FILE" 2>/dev/null || true; set +a
npx prisma db push || echo "WARNING: prisma db push failed — DB might not be ready yet"

echo ">>> Running workflow postgres migration..."
cd "$PROJECT_DIR"
$PNPM_BIN --filter @dispatch/backend exec workflow-postgres-setup || echo "WARNING: workflow-postgres-setup failed"

# Step 5: Create systemd service
echo ">>> Creating systemd user service..."
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
ExecStart=$NODE_BIN .output/server/index.mjs
Restart=always
RestartSec=5
StandardOutput=journal
StandardError=journal

# Give it time to connect to Telegram/Slack
TimeoutStartSec=30

[Install]
WantedBy=default.target
UNIT

echo "Created: $SYSTEMD_DIR/dispatch.service"

# Step 6: Enable and start
echo ">>> Reloading systemd..."
systemctl --user daemon-reload

echo ">>> Enabling service (starts on boot)..."
systemctl --user enable dispatch.service

# Enable lingering so user services run without being logged in
echo ">>> Enabling lingering for user $USER..."
loginctl enable-linger "$USER" 2>/dev/null || sudo loginctl enable-linger "$USER" || echo "WARNING: Could not enable lingering. Service may not start on boot without a login session."

echo ">>> Starting service..."
systemctl --user restart dispatch.service

sleep 2

echo ""
echo "=== Done! ==="
echo ""
echo "Service status:"
systemctl --user status dispatch.service --no-pager || true
echo ""
echo "Useful commands:"
echo "  systemctl --user status dispatch    # check status"
echo "  systemctl --user restart dispatch   # restart"
echo "  systemctl --user stop dispatch      # stop"
echo "  journalctl --user -u dispatch -f    # follow logs"
echo "  journalctl --user -u dispatch -n 50 # last 50 lines"
echo ""
echo "Env file: $ENV_FILE"
echo "To change env, edit the file and run: systemctl --user restart dispatch"
