import { start } from "workflow/api";
import { handleMessageWorkflow } from "../workflows/handle-message";
import { waitForConversation } from "./poll-response";

function log(msg: string, data?: any) {
  const ts = new Date().toISOString().slice(11, 23);
  if (data !== undefined) {
    console.log(`[${ts}] [deliver] ${msg}`, typeof data === "string" ? data : JSON.stringify(data));
  } else {
    console.log(`[${ts}] [deliver] ${msg}`);
  }
}

const TELEGRAM_MAX_LENGTH = 4096;

function splitMessage(text: string, maxLen: number): string[] {
  if (text.length <= maxLen) return [text];

  const chunks: string[] = [];
  let remaining = text;

  while (remaining.length > 0) {
    if (remaining.length <= maxLen) {
      chunks.push(remaining);
      break;
    }

    // Try to split at a newline near the limit
    let splitIdx = remaining.lastIndexOf("\n", maxLen);
    if (splitIdx < maxLen * 0.5) {
      // No good newline break — split at a space
      splitIdx = remaining.lastIndexOf(" ", maxLen);
    }
    if (splitIdx < maxLen * 0.3) {
      // No good break point — hard split
      splitIdx = maxLen;
    }

    chunks.push(remaining.slice(0, splitIdx));
    remaining = remaining.slice(splitIdx).trimStart();
  }

  return chunks;
}

async function sendTelegramChunk(token: string, chatId: string, text: string) {
  const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text, parse_mode: "Markdown" }),
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

async function sendTelegram(chatId: string, text: string) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) throw new Error("TELEGRAM_BOT_TOKEN not set");

  const chunks = splitMessage(text, TELEGRAM_MAX_LENGTH);
  for (const chunk of chunks) {
    await sendTelegramChunk(token, chatId, chunk);
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

// Track delivered threadIds to prevent duplicate deliveries
const deliveredThreads = new Set<string>();

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

  log(`Starting workflow`, { platform, channelId, threadId, prompt: prompt.slice(0, 80) });

  const run = await start(handleMessageWorkflow, [
    null,       // threadJson — no chat-sdk thread for API calls
    prompt,
    platform,
    channelId,
    threadId,
  ]);

  // Background: wait for workflow to complete, then deliver ONLY the final message
  (async () => {
    try {
      const deliver = createDeliveryCallback(platform, channelId, { skipStatus: true });
      const MAX_WAIT = 10 * 60_000; // 10 minutes
      const POLL_INTERVAL = 3_000;
      const deadline = Date.now() + MAX_WAIT;

      // Wait for workflow to finish
      while (Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, POLL_INTERVAL));
        const status = await run.status.catch(() => "unknown" as const);
        if (status === "completed" || status === "failed" || status === "cancelled") break;
      }

      // Find the conversation and deliver the last assistant message
      const conv = await waitForConversation(platform, channelId, threadId);
      if (!conv) {
        log(`No conversation found for delivery`, { platform, channelId, threadId });
        return;
      }

      const { prisma } = await import("../lib/prisma");
      const lastMsg = await prisma.message.findFirst({
        where: { conversationId: conv.id, role: "assistant" },
        orderBy: { createdAt: "desc" },
      });

      if (lastMsg?.content && !deliveredThreads.has(threadId)) {
        deliveredThreads.add(threadId);
        log(`Delivering final result: ${lastMsg.content.slice(0, 80)}...`);
        await deliver({ role: "assistant", content: lastMsg.content });
      } else if (deliveredThreads.has(threadId)) {
        log(`Already delivered for ${threadId}, skipping`);
      } else {
        log(`Workflow finished but no assistant message found`);
      }
    } catch (err) {
      log(`Background delivery error: ${err}`);
    }
  })();

  return { conversationId: threadId, runId: run.runId };
}
