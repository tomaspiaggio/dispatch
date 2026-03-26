#!/usr/bin/env bash
set -euo pipefail

echo "=== Uninstalling Dispatch service ==="

systemctl --user stop dispatch.service 2>/dev/null || true
systemctl --user disable dispatch.service 2>/dev/null || true
rm -f "$HOME/.config/systemd/user/dispatch.service"
systemctl --user daemon-reload

echo "Service removed."
echo "Docker containers and data are NOT removed. Run 'docker compose down -v' to remove them."
