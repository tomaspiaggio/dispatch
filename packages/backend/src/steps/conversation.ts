import { prisma } from "../lib/prisma";
import { DEFAULT_SYSTEM_PROMPT, MODELS } from "@dispatch/shared";
import type { ModelMessage } from "ai";

// Rough token estimation: ~4 chars per token
function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

const MAX_HISTORY_TOKENS = 400_000; // Leave room for system prompt + tools + response
const MAX_HISTORY_MESSAGES = 20; // Compact after this many messages regardless of tokens

export async function findOrCreateConversationStep(
  platform: string,
  channelId: string,
  threadId: string | null
) {
  "use step";

  const conversation = await prisma.conversation.upsert({
    where: {
      platform_channelId_threadId: {
        platform,
        channelId,
        threadId: threadId ?? channelId,
      },
    },
    create: {
      platform,
      channelId,
      threadId: threadId ?? channelId,
    },
    update: {
      updatedAt: new Date(),
    },
  });

  return conversation;
}

export async function getConversationHistoryStep(
  conversationId: string
): Promise<ModelMessage[]> {
  "use step";

  const messages = await prisma.message.findMany({
    where: {
      conversationId,
      role: { in: ["user", "assistant"] },
    },
    orderBy: { createdAt: "desc" }, // Newest first so we can trim from the oldest
    take: 50,
  });

  // Reverse to chronological order
  messages.reverse();

  // Build messages and track token budget — iterate backwards from newest
  // to find the split point between what fits and what gets compacted
  const parsed: { role: string; content: string | any[]; contentStr: string; tokens: number }[] = [];
  for (const m of messages) {
    const rawContent = m.content ?? "";
    let content: string | any[] = rawContent;

    if (rawContent.startsWith("[") || rawContent.startsWith("{")) {
      try {
        const p = JSON.parse(rawContent);
        if (Array.isArray(p)) content = p;
      } catch {}
    }

    const contentStr = typeof content === "string" ? content : JSON.stringify(content);
    parsed.push({ role: m.role, content, contentStr, tokens: estimateTokens(contentStr) });
  }

  // Find split point: keep at most MAX_HISTORY_MESSAGES recent messages
  // AND stay within token budget
  let tokenCount = 0;
  let splitIdx = 0;
  let keptCount = 0;
  for (let i = parsed.length - 1; i >= 0; i--) {
    const wouldExceedTokens = tokenCount + parsed[i].tokens > MAX_HISTORY_TOKENS;
    const wouldExceedMessages = keptCount >= MAX_HISTORY_MESSAGES;

    if ((wouldExceedTokens || wouldExceedMessages) && keptCount > 0) {
      splitIdx = i + 1;
      break;
    }
    tokenCount += parsed[i].tokens;
    keptCount++;
  }

  const recentMessages = parsed.slice(splitIdx);
  const droppedMessages = parsed.slice(0, splitIdx);

  const result: ModelMessage[] = recentMessages.map((m) => ({
    role: m.role as "user" | "assistant",
    content: m.content as any,
  }));

  // If we dropped messages, summarize them with LLM and notify the user
  if (droppedMessages.length > 0) {
    const reason = keptCount >= MAX_HISTORY_MESSAGES ? "message limit" : "token limit";
    console.log(`[compaction] Compacting ${droppedMessages.length} messages (${reason}), keeping ${recentMessages.length}`);

    // Notify the user that compaction is happening (use assistant role so it's delivered to chat)
    const { broadcastToConversation } = await import("../lib/ws");
    const statusMsg = await prisma.message.create({
      data: {
        conversationId,
        role: "assistant",
        content: `📝 Compacting conversation — summarizing ${droppedMessages.length} older messages to keep context manageable. Recent messages are preserved.`,
      },
    });
    broadcastToConversation(conversationId, "new_message", statusMsg);

    let summary: string;
    try {
      summary = await compactMessages(droppedMessages);
    } catch (err) {
      console.log(`[compaction] Failed to summarize: ${err}`);
      summary = `[${droppedMessages.length} earlier messages were compacted. The conversation covered various topics.]`;
    }

    result.unshift({ role: "system" as any, content: summary });
  }

  return result;
}

async function compactMessages(
  messages: { role: string; contentStr: string }[]
): Promise<string> {
  const { generateText } = await import("ai");
  const { google } = await import("@ai-sdk/google");

  // Build a condensed transcript for summarization (cap at ~50k chars to stay reasonable)
  const transcript = messages
    .map((m) => `${m.role}: ${m.contentStr.slice(0, 500)}`)
    .join("\n")
    .slice(0, 50_000);

  const { text } = await generateText({
    model: google(MODELS.FAST),
    maxOutputTokens: 1000,
    prompt: `Summarize the following conversation history into a concise recap. Focus on:
- Key topics discussed
- Important decisions or conclusions reached
- Any action items, preferences, or instructions the user gave
- Technical context that would be needed to continue the conversation

Keep it under 500 words. Write as a factual summary, not a conversation.

Conversation:
${transcript}`,
  });

  console.log(`[compaction] Summarized ${messages.length} messages into ${text.length} chars`);
  return `[Summary of ${messages.length} earlier messages]\n${text}`;
}

export async function getSystemPromptStep(): Promise<string> {
  "use step";

  const { readFile, mkdir } = await import("fs/promises");
  const { join } = await import("path");
  const { homedir } = await import("os");
  const dir = join(homedir(), ".dispatch");
  await mkdir(dir, { recursive: true });

  let soulContent = "";
  let memoriesContent = "";
  try { soulContent = await readFile(join(dir, "soul.md"), "utf-8"); } catch {}
  try { memoriesContent = await readFile(join(dir, "memories.md"), "utf-8"); } catch {}

  let prompt = "";

  if (soulContent.trim() && soulContent.trim() !== "# Soul") {
    prompt += soulContent.trim() + "\n\n";
  }

  prompt += DEFAULT_SYSTEM_PROMPT;

  if (memoriesContent.trim() && memoriesContent.trim() !== "# Memories") {
    prompt += "\n\n" + memoriesContent.trim();
  }

  return prompt;
}
