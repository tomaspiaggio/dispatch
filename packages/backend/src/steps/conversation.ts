import { prisma } from "../lib/prisma";
import { DEFAULT_SYSTEM_PROMPT } from "@dispatch/shared";
import type { ModelMessage } from "ai";

// Rough token estimation: ~4 chars per token
function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

const MAX_HISTORY_TOKENS = 400_000; // Leave room for system prompt + tools + response

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

  // Build messages and track token budget
  const result: ModelMessage[] = [];
  let tokenCount = 0;

  // Always include the most recent messages, trim older ones if over budget
  for (const m of messages) {
    const content = m.content ?? "";
    const msgTokens = estimateTokens(content);

    if (tokenCount + msgTokens > MAX_HISTORY_TOKENS && result.length > 0) {
      // Over budget — prepend a summary note and stop adding older messages
      result.unshift({
        role: "system" as any,
        content:
          "[Earlier conversation history was truncated to fit context window. The most recent messages are shown below.]",
      });
      break;
    }

    result.push({
      role: m.role as "user" | "assistant",
      content,
    });
    tokenCount += msgTokens;
  }

  return result;
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
