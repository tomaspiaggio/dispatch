import { prisma } from "../lib/prisma";
import { broadcastToConversation } from "../lib/ws";

export async function logMessageStep(
  conversationId: string,
  role: string,
  content: string | null,
  toolCalls?: unknown[] | null,
  thinking?: string | null,
  tokensUsed?: { prompt: number; completion: number; total: number } | null
) {
  "use step";

  const message = await prisma.message.create({
    data: {
      conversationId,
      role,
      content,
      toolCalls: (toolCalls as any) ?? [],
      thinking: typeof thinking === "string" ? thinking : null,
      tokensUsed: tokensUsed ?? undefined,
    },
  });

  broadcastToConversation(conversationId, "new_message", message);

  return { messageId: message.id };
}
