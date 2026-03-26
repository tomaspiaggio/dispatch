import { start } from "workflow/api";
import { handleMessageWorkflow } from "../workflows/handle-message";
import { waitAndPostResponse, waitForConversation } from "./poll-response";

function log(msg: string, data?: any) {
  const ts = new Date().toISOString().slice(11, 23);
  if (data !== undefined) {
    console.log(`[${ts}] [deliver] ${msg}`, typeof data === "string" ? data : JSON.stringify(data));
  } else {
    console.log(`[${ts}] [deliver] ${msg}`);
  }
}

async function sendTelegram(chatId: string, text: string) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) throw new Error("TELEGRAM_BOT_TOKEN not set");

  const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: chatId,
      text,
      parse_mode: "Markdown",
    }),
  });

  if (!res.ok) {
    // Retry without Markdown if it fails (malformed markdown)
    const retry = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text }),
    });
    if (!retry.ok) {
      log(`Telegram send failed: ${retry.status} ${await retry.text()}`);
    }
  }
}

async function sendSlack(channelId: string, text: string) {
  const token = process.env.SLACK_BOT_TOKEN;
  if (!token) throw new Error("SLACK_BOT_TOKEN not set");

  const { WebClient } = await import("@slack/web-api");
  const client = new WebClient(token);
  await client.chat.postMessage({ channel: channelId, text, mrkdwn: true });
}

type DeliverMessage = (message: { role: string; content: string }) => Promise<void>;

export function createDeliveryCallback(
  platform: string,
  channelId: string,
  options?: { skipStatus?: boolean },
): DeliverMessage {
  return async ({ role, content }) => {
    // Skip status messages (e.g. "Still working on it...") for spawned tasks
    if (options?.skipStatus && role === "status") return;

    try {
      if (platform === "telegram") {
        await sendTelegram(channelId, content);
      } else if (platform === "slack") {
        await sendSlack(channelId, content);
      } else {
        // web/api — no push delivery, clients poll via SSE/tRPC
        log(`No push delivery for platform "${platform}"`);
      }
    } catch (err) {
      log(`Delivery failed [${platform}/${channelId}]: ${err}`);
    }
  };
}

/**
 * Start a workflow with the given prompt and poll for delivery in the background.
 * Returns immediately with { conversationId, runId }.
 */
export async function executePromptAndDeliver(
  prompt: string,
  platform: string,
  channelId: string,
  conversationId?: string,
) {
  const threadId = conversationId ?? `api-${Date.now()}`;
  const startTime = new Date();

  log(`Starting workflow`, { platform, channelId, threadId, prompt: prompt.slice(0, 80) });

  const run = await start(handleMessageWorkflow, [
    null,       // threadJson — no chat-sdk thread for API calls
    prompt,
    platform,
    channelId,
    threadId,
  ]);

  // Background: poll for response and deliver to platform
  (async () => {
    try {
      const conv = await waitForConversation(platform, channelId, threadId);
      if (!conv) {
        log(`No conversation found for delivery`, { platform, channelId, threadId });
        return;
      }

      await waitAndPostResponse({
        conversationId: conv.id,
        startTime,
        run,
        log,
        timeoutMessage: "The task timed out.",
        deliverMessage: createDeliveryCallback(platform, channelId, { skipStatus: true }),
      });
    } catch (err) {
      log(`Background delivery error: ${err}`);
    }
  })();

  return { conversationId: threadId, runId: run.runId };
}
