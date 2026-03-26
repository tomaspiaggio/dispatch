import { SocketModeClient } from "@slack/socket-mode";
import { WebClient } from "@slack/web-api";
import { start } from "workflow/api";
import { handleMessageWorkflow } from "../workflows/handle-message";
import { waitAndPostResponse, waitForConversation } from "./poll-response";

let socketClient: SocketModeClient | null = null;
let webClient: WebClient | null = null;

function log(msg: string, data?: any) {
  const ts = new Date().toISOString().slice(11, 23);
  if (data !== undefined) {
    console.log(`[${ts}] [slack] ${msg}`, typeof data === "string" ? data : JSON.stringify(data));
  } else {
    console.log(`[${ts}] [slack] ${msg}`);
  }
}

async function postMessage(channel: string, text: string, threadTs?: string) {
  if (!webClient) return;
  try {
    await webClient.chat.postMessage({
      channel,
      text,
      mrkdwn: true,
      ...(threadTs ? { thread_ts: threadTs } : {}),
    });
  } catch (err) {
    log(`postMessage failed: ${err}`);
  }
}

import { google } from "@ai-sdk/google";
import { generateText } from "ai";
import { MODELS } from "@dispatch/shared";

async function generateAck(userMessage: string): Promise<string> {
  try {
    const { text } = await generateText({
      model: google(MODELS.FAST),
      maxOutputTokens: 40,
      prompt: `You're an AI assistant that just received a message. Generate a very short (5-15 words max) contextual acknowledgment. Be natural and casual. Don't answer the question — just acknowledge you're going to work on it.

Examples:
- "hello" → "Hey! What can I do for you?"
- "what's the weather" → "Checking the weather for you..."
- "deploy the app" → "On it, deploying now..."

User message: "${userMessage.slice(0, 200)}"

Your short acknowledgment:`,
    });
    return text.trim() || "On it...";
  } catch {
    return "On it...";
  }
}

export async function startSlackSocketMode() {
  const appToken = process.env.SLACK_APP_TOKEN;
  const botToken = process.env.SLACK_BOT_TOKEN;
  if (!appToken || !botToken) {
    log("SLACK_APP_TOKEN or SLACK_BOT_TOKEN not set — Slack disabled");
    return;
  }

  socketClient = new SocketModeClient({ appToken });
  webClient = new WebClient(botToken);

  let botUserId = "";
  let botId = "";
  try {
    const auth = await webClient.auth.test();
    botUserId = auth.user_id as string;
    botId = auth.bot_id as string ?? "";
    log(`Bot user: ${botUserId}, bot_id: ${botId}`);
  } catch (err) {
    log(`Failed to get bot info: ${err}`);
  }

  // Deduplicate: track processed event timestamps
  const processedEvents = new Set<string>();

  function shouldProcess(event: any): boolean {
    // Skip bot's own messages
    if (event.user === botUserId) return false;
    if (event.bot_id) return false;
    if (event.bot_profile) return false;

    // Skip subtypes (joins, leaves, edits, etc.)
    if (event.subtype) return false;

    // Must have text
    if (!event.text) return false;

    // Deduplicate by event timestamp
    const key = `${event.channel}:${event.ts}`;
    if (processedEvents.has(key)) return false;
    processedEvents.add(key);

    // Clean up old entries (keep last 100)
    if (processedEvents.size > 100) {
      const arr = Array.from(processedEvents);
      for (let i = 0; i < arr.length - 100; i++) {
        processedEvents.delete(arr[i]!);
      }
    }

    return true;
  }

  // Slash commands
  socketClient.on("slash_commands", async ({ body, ack }: any) => {
    await ack();
    log(`Slash: ${body.command}`, { user: body.user_id, channel: body.channel_id, text: body.text });

    if (body.command === "/new") {
      await postMessage(body.channel_id, "Fresh start!");
      return;
    }

    if (body.command === "/dispatch") {
      const text = body.text?.trim();
      if (!text) {
        await postMessage(body.channel_id, "Usage: `/dispatch <message>`");
        return;
      }
      await handleSlackMessage(body.channel_id, text);
    }
  });

  // Use ONLY slack_event — this is the canonical event listener for Socket Mode
  socketClient.on("slack_event", async ({ event, ack }: any) => {
    if (ack) await ack();
    if (!event) return;

    // Log all events for debugging
    log(`Event: ${event.type}`, {
      user: event.user,
      channel: event.channel,
      subtype: event.subtype,
      bot_id: event.bot_id,
      thread_ts: event.thread_ts,
      ts: event.ts,
      text: event.text?.slice(0, 80),
    });

    if (!shouldProcess(event)) return;

    // app_mention or message — handle both the same way
    if (event.type === "app_mention" || event.type === "message") {
      const text = event.text.replace(/<@[A-Z0-9]+>/gi, "").trim();
      if (!text) return;
      const threadTs = event.thread_ts ?? event.ts;
      log(`Processing: "${text.slice(0, 120)}"`, { channel: event.channel, threadTs });
      await handleSlackMessage(event.channel, text, threadTs);
    }
  });

  socketClient.on("interactive", async ({ ack }: any) => {
    if (ack) await ack();
  });

  await socketClient.start();
  log(`Socket Mode connected`);
}

async function handleSlackMessage(
  channelId: string,
  text: string,
  threadTs?: string,
) {
  const startTime = new Date();

  try {
    const ack = await generateAck(text);
    log(`Ack: "${ack}"`);
    await postMessage(channelId, ack, threadTs);

    const conversationThreadId = threadTs ?? `slack-${channelId}-${Date.now()}`;

    log(`Workflow start`, { channelId, threadId: conversationThreadId });
    const run = await start(handleMessageWorkflow, [
      null,
      text,
      "slack",
      channelId,
      conversationThreadId,
    ]);

    // Wait for conversation
    const conv = await waitForConversation("slack", channelId, conversationThreadId);

    if (conv) {
      await waitAndPostResponse({
        conversationId: conv.id,
        startTime,
        run,
        log,
        timeoutMessage: "Sorry, I timed out. The task might still be running.",
        deliverMessage: async ({ role, content }) => {
          const text = role === "status" ? `_${content}_` : content;
          await postMessage(channelId, text, threadTs);
        },
      });
    } else {
      await postMessage(channelId, "Something went wrong: couldn't create conversation.", threadTs);
    }
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    log(`!!! Error: ${msg}`);
    await postMessage(channelId, `Something went wrong: ${msg}`, threadTs);
  }
}

export async function stopSlackSocketMode() {
  if (socketClient) {
    await socketClient.disconnect();
    socketClient = null;
  }
}
