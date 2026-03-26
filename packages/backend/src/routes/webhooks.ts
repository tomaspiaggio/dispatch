import { Hono } from "hono";
import { bot } from "../chat/handlers";

const webhooks = new Hono();

// Slack webhook - delegates to chat-sdk
webhooks.post("/slack", async (c) => {
  const response = await bot.webhooks.slack(c.req.raw);
  return response;
});

// Telegram webhook - delegates to chat-sdk
webhooks.post("/telegram", async (c) => {
  const response = await bot.webhooks.telegram(c.req.raw);
  return response;
});

export default webhooks;
