import { start } from "workflow/api";
import { bot } from "./bot";
import { startSlackSocketMode } from "./slack-socket";
import { handleMessageWorkflow } from "../workflows/handle-message";
import { google } from "@ai-sdk/google";
import { generateText } from "ai";
import { waitAndPostResponse, waitForConversation } from "./poll-response";

import { MODELS } from "@dispatch/shared";

function log(msg: string, data?: any) {
  const ts = new Date().toISOString().slice(11, 23);
  if (data !== undefined) {
    console.log(`[${ts}] [chat] ${msg}`, typeof data === "string" ? data : JSON.stringify(data));
  } else {
    console.log(`[${ts}] [chat] ${msg}`);
  }
}

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
- "remember to always use pnpm" → "Got it, I'll remember that."
- "can you read my config file" → "Sure, let me pull that up..."

User message: "${userMessage.slice(0, 200)}"

Your short acknowledgment:`,
    });
    return text.trim() || "On it...";
  } catch {
    return "On it...";
  }
}

// Telegram bots are public — restrict to allowed IDs. Slack is org-level, allow all.
function isAllowedUser(thread: any): boolean {
  const adapterName = thread.adapter?.name ?? "unknown";
  if (adapterName !== "telegram") return true; // Slack/other: allow all

  const allowedRaw = process.env.ALLOWED_TELEGRAM_IDS;
  if (!allowedRaw) return true;
  const allowedIds = allowedRaw.split(",").map((id) => id.trim());
  const authorId = thread.recentMessages?.[thread.recentMessages.length - 1]?.author?.id;
  const channelId = thread.channelId ?? "";
  if (authorId && allowedIds.includes(String(authorId))) return true;
  if (channelId && allowedIds.includes(String(channelId))) return true;
  return false;
}

// Best-effort message send — tries markdown, falls back to plain text, never throws
async function safeSend(thread: any, text: string) {
  try {
    await thread.post({ markdown: text });
  } catch {
    try {
      await thread.post(text);
    } catch (err) {
      log(`safeSend failed completely: ${err}`);
    }
  }
}

async function handleIncomingMessage(thread: any, isNew: boolean) {
  const lastMessage = thread.recentMessages[thread.recentMessages.length - 1];
  if (!lastMessage) return;

  const messageText = lastMessage.text ?? "";
  const adapterName = thread.adapter?.name ?? "unknown";
  const channelId = thread.channelId ?? "unknown";

  log(`>>> [${adapterName}] ${isNew ? "new" : "reply"}: "${messageText.slice(0, 120)}"`, {
    channel: channelId,
    author: lastMessage.author?.id,
  });

  if (!isAllowedUser(thread)) {
    log(`BLOCKED`);
    return;
  }

  if (messageText.trim().toLowerCase() === "/new") {
    await thread.unsubscribe();
    await thread.post("Fresh start! Send me a message to begin a new conversation.");
    return;
  }

  if (isNew) await thread.subscribe();

  const startTime = new Date();

  try {
    // Check for voice messages
    const audioAttachment = lastMessage.attachments?.find((a: any) => a.type === "audio");
    let content: any = messageText;
    if (audioAttachment && audioAttachment.fetchData) {
      log(`Voice message detected, downloading...`);
      const buffer = await audioAttachment.fetchData();
      log(`Downloaded ${buffer.length} bytes`);
      content = [
        { type: "text", text: messageText || "Voice message" },
        { type: "file", data: buffer.toString("base64"), mimeType: audioAttachment.mimeType || "audio/ogg" },
      ];
    }

    // Fast contextual ack via flash-lite
    const ack = await generateAck(messageText || "voice message");
    log(`Ack: "${ack}"`);
    await thread.post(ack);
    try { await thread.startTyping(); } catch {}

    // Start workflow
    log(`Starting workflow...`);
    const run = await start(handleMessageWorkflow, [
      JSON.stringify(thread),
      typeof content === "string" ? content : JSON.stringify(content),
      adapterName,
      channelId,
      thread.id ?? null,
    ]);

    // Wait for conversation, then poll for response
    log(`Waiting for conversation...`);
    const conv = await waitForConversation(adapterName, channelId, thread.id ?? null);

    if (conv) {
      log(`Found conversation: ${conv.id}`);
      await waitAndPostResponse({
        conversationId: conv.id,
        startTime,
        run,
        log,
        timeoutMessage:
          "Sorry, I timed out waiting for a response. The task might still be running in the background — check back in a bit.",
        deliverMessage: async ({ content }) => {
          await safeSend(thread, content);
        },
      });
    } else {
      log(`No conversation found`);
      await safeSend(thread, "Something went wrong: couldn't create conversation. Check the logs.");
    }
  } catch (error: unknown) {
    // ALWAYS report errors to the user
    const msg = error instanceof Error ? error.message : String(error);
    log(`!!! Handler error: ${msg}`);
    await safeSend(thread, `Something went wrong: ${msg}`);
  }
}

bot.onNewMention(async (thread) => {
  await handleIncomingMessage(thread, true);
});

bot.onSubscribedMessage(async (thread) => {
  await handleIncomingMessage(thread, false);
});

export async function initChat() {
  const hasTelegram = !!process.env.TELEGRAM_BOT_TOKEN;

  if (hasTelegram) {
    try {
      await bot.initialize();
      log(`Chat-sdk initialized (Telegram polling)`);
    } catch (err) {
      log(`Chat-sdk init warning: ${err}`);
    }
  } else {
    log(`Telegram not configured`);
  }

  await startSlackSocketMode();
}

export { bot };
