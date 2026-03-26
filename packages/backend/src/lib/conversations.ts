import { PrismaClient } from "@prisma/client";

// Rough token estimation: ~4 chars per token
function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

const MAX_HISTORY_TOKENS = 400_000;

export async function findOrCreateConversation(
  prisma: PrismaClient,
  platform: string,
  channelId: string,
  threadId: string | null
) {
  return prisma.conversation.upsert({
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
}

export async function getConversationHistory(
  prisma: PrismaClient,
  conversationId: string
) {
  const messages = await prisma.message.findMany({
    where: {
      conversationId,
      role: { in: ["user", "assistant"] },
    },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: 50,
  });

  messages.reverse();

  const result: { role: "user" | "assistant" | "system"; content: string }[] =
    [];
  let tokenCount = 0;

  for (const m of messages) {
    const content = m.content ?? "";
    const msgTokens = estimateTokens(content);

    if (tokenCount + msgTokens > MAX_HISTORY_TOKENS && result.length > 0) {
      result.unshift({
        role: "system",
        content:
          "[Earlier conversation history was truncated to fit context window.]",
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

export async function logMessage(
  prisma: PrismaClient,
  conversationId: string,
  role: string,
  content: string | null,
  toolCalls?: unknown[] | null,
  thinking?: string | null,
  tokensUsed?: { prompt: number; completion: number; total: number } | null
) {
  return prisma.message.create({
    data: {
      conversationId,
      role,
      content,
      toolCalls: (toolCalls as any) ?? [],
      thinking: typeof thinking === "string" ? thinking : null,
      tokensUsed: tokensUsed ?? undefined,
    },
  });
}

export function buildSystemPrompt(
  soulContent: string,
  memoriesContent: string,
  defaultPrompt: string
): string {
  let prompt = "";

  if (soulContent.trim() && soulContent.trim() !== "# Soul") {
    prompt += soulContent.trim() + "\n\n";
  }

  prompt += defaultPrompt;

  if (memoriesContent.trim() && memoriesContent.trim() !== "# Memories") {
    prompt += "\n\n" + memoriesContent.trim();
  }

  return prompt;
}
