import { Hono } from "hono";
import { start } from "workflow/api";
import { prisma } from "../lib/prisma";
import { handleMessageWorkflow } from "../workflows/handle-message";

const api = new Hono();

// List conversations
api.get("/conversations", async (c) => {
  const conversations = await prisma.conversation.findMany({
    orderBy: { updatedAt: "desc" },
    take: 50,
  });
  return c.json({ conversations });
});

// Get single conversation with messages
api.get("/conversations/:id", async (c) => {
  const { id } = c.req.param();
  const conversation = await prisma.conversation.findUnique({
    where: { id },
  });
  if (!conversation) return c.json({ error: "Not found" }, 404);

  const messages = await prisma.message.findMany({
    where: { conversationId: id },
    orderBy: { createdAt: "asc" },
  });
  return c.json({ conversation, messages });
});

// Send message from web UI
api.post("/messages", async (c) => {
  const { content, conversationId } = await c.req.json<{
    content: string;
    conversationId?: string;
  }>();

  const convId = conversationId ?? crypto.randomUUID();

  // Find or create conversation for web platform
  const conversation = await prisma.conversation.upsert({
    where: {
      platform_channelId_threadId: {
        platform: "web",
        channelId: "web",
        threadId: convId,
      },
    },
    create: {
      id: convId,
      platform: "web",
      channelId: "web",
      threadId: convId,
    },
    update: { updatedAt: new Date() },
  });

  // Trigger workflow (it will log the user message internally)
  const run = await start(handleMessageWorkflow, [
    null, // no chat-sdk thread for web UI
    content,
    "web",
    "web",
    conversation.id,
  ]);

  return c.json({ conversationId: conversation.id, runId: String(run) });
});

// Stats
api.get("/stats", async (c) => {
  const [totalConversations, totalMessages, tokenAgg] = await Promise.all([
    prisma.conversation.count(),
    prisma.message.count(),
    prisma.message.findMany({
      where: { NOT: { tokensUsed: undefined } },
      select: { tokensUsed: true },
    }),
  ]);

  const totalTokens = tokenAgg.reduce(
    (acc, m) => {
      const t = m.tokensUsed as { prompt?: number; completion?: number; total?: number } | null;
      if (!t) return acc;
      return {
        prompt: acc.prompt + (t.prompt ?? 0),
        completion: acc.completion + (t.completion ?? 0),
        total: acc.total + (t.total ?? 0),
      };
    },
    { prompt: 0, completion: 0, total: 0 }
  );

  return c.json({ totalConversations, totalMessages, totalTokens });
});

// Memory (file-based: ~/.dispatch/memories.md)
api.get("/memories", async (c) => {
  const { getMemoriesContent } = await import("../steps/memory");
  const content = await getMemoriesContent();
  return c.json({ content });
});

api.post("/memories", async (c) => {
  const { instruction } = await c.req.json<{ instruction: string }>();
  const { updateMemoryStep } = await import("../steps/memory");
  const result = await updateMemoryStep(instruction);
  return c.json(result);
});

// Soul (file-based: ~/.dispatch/soul.md)
api.get("/soul", async (c) => {
  const { getSoulContent } = await import("../steps/memory");
  const content = await getSoulContent();
  return c.json({ content });
});

api.post("/soul", async (c) => {
  const { instruction } = await c.req.json<{ instruction: string }>();
  const { updateSoulStep } = await import("../steps/memory");
  const result = await updateSoulStep(instruction);
  return c.json(result);
});

export default api;
