import { initTRPC } from "@trpc/server";
import { z } from "zod";
import { prisma } from "../lib/prisma";
import { start } from "workflow/api";
import { handleMessageWorkflow } from "../workflows/handle-message";

const t = initTRPC.create();

export const createCaller = t.createCallerFactory;

export const appRouter = t.router({
  // Conversations
  listConversations: t.procedure.query(async () => {
    const conversations = await prisma.conversation.findMany({
      orderBy: { updatedAt: "desc" },
      take: 50,
    });
    return conversations;
  }),

  getConversation: t.procedure
    .input(z.object({ id: z.string() }))
    .query(async ({ input }) => {
      const conversation = await prisma.conversation.findUnique({
        where: { id: input.id },
      });
      if (!conversation) throw new Error("Not found");

      const messages = await prisma.message.findMany({
        where: { conversationId: input.id },
        orderBy: { createdAt: "asc" },
      });
      return { conversation, messages };
    }),

  // Send a message (creates conversation if needed, triggers workflow)
  sendMessage: t.procedure
    .input(
      z.object({
        content: z.string().min(1),
        conversationId: z.string().optional(),
      })
    )
    .mutation(async ({ input }) => {
      const convId = input.conversationId ?? crypto.randomUUID();

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

      const run = await start(handleMessageWorkflow, [
        null,
        input.content,
        "web",
        "web",
        conversation.id,
      ]);

      return { conversationId: conversation.id };
    }),

  // Stats
  getStats: t.procedure.query(async () => {
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
        const t = m.tokensUsed as {
          prompt?: number;
          completion?: number;
          total?: number;
        } | null;
        if (!t) return acc;
        return {
          prompt: acc.prompt + (t.prompt ?? 0),
          completion: acc.completion + (t.completion ?? 0),
          total: acc.total + (t.total ?? 0),
        };
      },
      { prompt: 0, completion: 0, total: 0 }
    );

    return { totalConversations, totalMessages, totalTokens };
  }),

  // Memory (file-based)
  getMemories: t.procedure.query(async () => {
    const { readFile } = await import("fs/promises");
    const { join } = await import("path");
    const { homedir } = await import("os");
    try {
      const content = await readFile(
        join(homedir(), ".dispatch", "memories.md"),
        "utf-8"
      );
      return { content };
    } catch {
      return { content: "" };
    }
  }),

  updateMemory: t.procedure
    .input(z.object({ instruction: z.string() }))
    .mutation(async ({ input }) => {
      const { updateMemoryStep } = await import("../steps/memory");
      return updateMemoryStep(input.instruction);
    }),

  // Soul (file-based)
  getSoul: t.procedure.query(async () => {
    const { readFile } = await import("fs/promises");
    const { join } = await import("path");
    const { homedir } = await import("os");
    try {
      const content = await readFile(
        join(homedir(), ".dispatch", "soul.md"),
        "utf-8"
      );
      return { content };
    } catch {
      return { content: "" };
    }
  }),

  updateSoul: t.procedure
    .input(z.object({ instruction: z.string() }))
    .mutation(async ({ input }) => {
      const { updateSoulStep } = await import("../steps/memory");
      return updateSoulStep(input.instruction);
    }),
});

export type AppRouter = typeof appRouter;
