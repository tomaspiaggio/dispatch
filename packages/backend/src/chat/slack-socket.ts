import { SocketModeClient } from "@slack/socket-mode";
import { WebClient } from "@slack/web-api";
import { start } from "workflow/api";
import { handleMessageWorkflow } from "../workflows/handle-message";
import { prisma } from "../lib/prisma";

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

// Check if user is allowed
function isAllowed(userId: string): boolean {
  const allowedRaw = process.env.ALLOWED_USER_IDS;
  if (!allowedRaw) return true;
  return allowedRaw.split(",").map((id) => id.trim()).includes(userId);
}

// Post a markdown-formatted message to Slack
async function postMessage(channel: string, text: string, threadTs?: string) {
  if (!webClient) return;
  await webClient.chat.postMessage({
    channel,
    text, // Fallback
    mrkdwn: true,
    blocks: [{ type: "section", text: { type: "mrkdwn", text } }],
    ...(threadTs ? { thread_ts: threadTs } : {}),
  });
}

// Poll DB for response and post to Slack
async function waitAndPostResponse(
  channel: string,
  conversationId: string,
  startTime: Date,
  threadTs?: string
) {
  const maxWait = 120_000;
  const pollInterval = 2000;
  const postedIds = new Set<string>();

  const deadline = Date.now() + maxWait;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, pollInterval));

    const msgs = await prisma.message.findMany({
      where: {
        conversationId,
        role: { in: ["assistant", "status"] },
        createdAt: { gt: startTime },
      },
      orderBy: { createdAt: "asc" },
    });

    for (const msg of msgs) {
      if (postedIds.has(msg.id) || !msg.content) continue;
      postedIds.add(msg.id);

      log(`Posting: [${msg.role}] ${msg.content.slice(0, 80)}...`);
      try {
        const text = msg.role === "status" ? `_${msg.content}_` : msg.content;
        await postMessage(channel, text, threadTs);
      } catch (err) {
        log(`Failed to post: ${err}`);
      }
    }

    if (msgs.some((m) => m.role === "assistant" && postedIds.has(m.id))) {
      log(`Response delivered`);
      return;
    }
  }

  log(`TIMEOUT waiting for response`);
  try {
    await postMessage(channel, "Sorry, I timed out waiting for a response. The task might still be running — check back in a bit.", threadTs);
  } catch {}
}

const ACKS = ["Working on it...", "Let me check...", "On it...", "Looking into it...", "Give me a sec..."];
function randomAck() { return ACKS[Math.floor(Math.random() * ACKS.length)]!; }

export async function startSlackSocketMode() {
  const appToken = process.env.SLACK_APP_TOKEN;
  const botToken = process.env.SLACK_BOT_TOKEN;
  if (!appToken || !botToken) {
    log("SLACK_APP_TOKEN or SLACK_BOT_TOKEN not set — Slack disabled");
    return;
  }

  socketClient = new SocketModeClient({ appToken });
  webClient = new WebClient(botToken);

  // Get our bot user ID so we can detect mentions
  let botUserId = "";
  try {
    const auth = await webClient.auth.test();
    botUserId = auth.user_id as string;
    log(`Connected as bot user: ${botUserId}`);
  } catch (err) {
    log(`Failed to get bot info: ${err}`);
  }

  socketClient.on("slash_commands", async ({ body, ack }: any) => {
    await ack();
    const command = body.command;
    const userId = body.user_id;
    const channelId = body.channel_id;

    log(`Slash command: ${command}`, { userId, channelId });

    if (!isAllowed(userId)) {
      log(`BLOCKED: ${userId}`);
      return;
    }

    if (command === "/new") {
      await postMessage(channelId, "Fresh start! Send me a message to begin a new conversation.");
      return;
    }

    if (command === "/dispatch") {
      const text = body.text ?? "";
      if (!text) {
        await postMessage(channelId, "Usage: `/dispatch <message>`");
        return;
      }
      // Treat as a new message
      await handleSlackMessage(channelId, userId, text);
    }
  });

  socketClient.on("slack_event", async ({ event, body, ack }: any) => {
    await ack();

    if (!event) return;

    // Handle message events
    if (event.type === "message" && !event.subtype && event.text) {
      const userId = event.user;
      const channelId = event.channel;
      const threadTs = event.thread_ts ?? event.ts; // Thread or top-level
      const isThread = !!event.thread_ts;

      // Ignore bot's own messages
      if (userId === botUserId) return;

      if (!isAllowed(userId)) {
        log(`BLOCKED: ${userId}`);
        return;
      }

      log(`Message from ${userId} in ${channelId}`, {
        text: event.text.slice(0, 120),
        isThread,
        threadTs,
      });

      await handleSlackMessage(channelId, userId, event.text, threadTs);
    }

    // Handle app_mention events (when someone @mentions the bot)
    if (event.type === "app_mention" && event.text) {
      const userId = event.user;
      const channelId = event.channel;
      const threadTs = event.thread_ts ?? event.ts;
      const isThread = !!event.thread_ts;

      if (userId === botUserId) return;
      if (!isAllowed(userId)) {
        log(`BLOCKED: ${userId}`);
        return;
      }

      // Strip the bot mention from the text
      const text = event.text.replace(/<@[A-Z0-9]+>/g, "").trim();
      if (!text) return;

      log(`Mention from ${userId}: "${text.slice(0, 120)}"`, { isThread });
      await handleSlackMessage(channelId, userId, text, threadTs);
    }
  });

  socketClient.on("interactive", async ({ body, ack }: any) => {
    await ack();
    log(`Interactive event`, { type: body?.type });
  });

  await socketClient.start();
  log(`Socket Mode connected`);
}

async function handleSlackMessage(
  channelId: string,
  _userId: string,
  text: string,
  threadTs?: string,
) {
  const startTime = new Date();

  try {
    // Ack
    await postMessage(channelId, randomAck(), threadTs);

    const conversationThreadId = threadTs ?? `slack-${channelId}-${Date.now()}`;

    log(`Starting workflow`, { channelId, threadId: conversationThreadId });
    await start(handleMessageWorkflow, [
      null,
      text,
      "slack",
      channelId,
      conversationThreadId,
    ]);

    // Wait for conversation to be created by workflow
    const deadline = Date.now() + 15_000;
    let conv = null;
    while (Date.now() < deadline) {
      conv = await prisma.conversation.findFirst({
        where: { platform: "slack", channelId },
        orderBy: { createdAt: "desc" },
      });
      if (conv) break;
      await new Promise((r) => setTimeout(r, 500));
    }

    if (conv) {
      await waitAndPostResponse(channelId, conv.id, startTime, threadTs);
    } else {
      await postMessage(channelId, "Something went wrong: couldn't create conversation. Check the logs.", threadTs);
    }
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    log(`!!! Slack handler error: ${msg}`);
    try {
      await postMessage(channelId, `Something went wrong: ${msg}`, threadTs);
    } catch {}
  }
}

export async function stopSlackSocketMode() {
  if (socketClient) {
    await socketClient.disconnect();
    socketClient = null;
  }
}
