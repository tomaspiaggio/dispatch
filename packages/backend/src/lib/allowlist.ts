/**
 * Check if a user is allowed based on platform and env vars.
 * Telegram: restricted by ALLOWED_TELEGRAM_IDS
 * Slack/other: always allowed (org-level auth)
 */
export function isAllowed(
  platform: string,
  userId: string | undefined,
  channelId: string | undefined,
  allowedTelegramIds?: string
): boolean {
  if (platform !== "telegram") return true;

  const allowedRaw = allowedTelegramIds ?? process.env.ALLOWED_TELEGRAM_IDS;
  if (!allowedRaw) return true;

  const allowedIds = allowedRaw.split(",").map((id) => id.trim());
  if (userId && allowedIds.includes(String(userId))) return true;
  if (channelId && allowedIds.includes(String(channelId))) return true;
  return false;
}

/**
 * Parse a delay string like "30s", "5m", "1h", "2d" into milliseconds.
 */
export function parseDelay(delay: string): number {
  const match = delay.match(/^(\d+)\s*(s|sec|m|min|h|hr|hour|d|day)s?$/i);
  if (!match)
    throw new Error(
      `Invalid delay: "${delay}". Use e.g. "30s", "5m", "1h", "2d"`
    );
  const [, num, unit] = match;
  const u = unit!.toLowerCase();
  const multipliers: Record<string, number> = {
    s: 1000,
    sec: 1000,
    m: 60_000,
    min: 60_000,
    h: 3600_000,
    hr: 3600_000,
    hour: 3600_000,
    d: 86400_000,
    day: 86400_000,
  };
  return parseInt(num!) * multipliers[u]!;
}
