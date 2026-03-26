import { Chat } from "chat";
import { createTelegramAdapter } from "@chat-adapter/telegram";
import { createRedisState } from "@chat-adapter/state-redis";

// Slack is handled entirely via Socket Mode (@slack/socket-mode) — no chat-sdk adapter needed.
// Only Telegram uses chat-sdk.

const adapters: Record<string, any> = {};

if (process.env.TELEGRAM_BOT_TOKEN) {
  adapters.telegram = createTelegramAdapter({
    mode: "polling",
    longPolling: {
      timeout: 30,
      dropPendingUpdates: false,
    },
  });
  console.log("Telegram adapter enabled (polling mode)");
} else {
  console.warn("TELEGRAM_BOT_TOKEN not set — Telegram adapter disabled");
}

// State: use Redis if available, otherwise skip
const hasRedis = !!process.env.REDIS_URL;
const stateConfig = hasRedis ? { state: createRedisState() } : {};
if (!hasRedis) {
  console.warn("REDIS_URL not set — running without persistent state (dev only)");
}

export const bot = new Chat({
  userName: "dispatch",
  adapters,
  ...stateConfig,
  onLockConflict: "force",
} as any);
