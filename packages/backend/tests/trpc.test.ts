import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { appRouter, createCaller } from "../src/trpc/router";
import { setupTestDb, teardownTestDb } from "./setup";
import type { PrismaClient } from "@prisma/client";

// Test tRPC router by calling procedures directly via caller
const caller = createCaller(appRouter)({});

let prisma: PrismaClient;

beforeAll(async () => {
  const result = await setupTestDb();
  prisma = result.prisma;

  // Monkey-patch the prisma import used by the router
  // The router imports from ../lib/prisma — we need to redirect it
  // For integration tests, we rely on the test DB being set up via env
});

afterAll(async () => {
  await teardownTestDb();
});

beforeEach(async () => {
  await prisma.message.deleteMany();
  await prisma.conversation.deleteMany();
});

describe("tRPC: listConversations", () => {
  it("returns empty list initially", async () => {
    const result = await caller.listConversations();
    expect(result).toEqual([]);
  });

  it("returns conversations after creating one", async () => {
    await prisma.conversation.create({
      data: { platform: "web", channelId: "web", threadId: "t1" },
    });

    const result = await caller.listConversations();
    expect(result).toHaveLength(1);
    expect(result[0].platform).toBe("web");
  });

  it("returns conversations sorted by updatedAt desc", async () => {
    await prisma.conversation.create({
      data: {
        platform: "web",
        channelId: "web",
        threadId: "old",
        updatedAt: new Date("2024-01-01"),
      },
    });
    await prisma.conversation.create({
      data: {
        platform: "telegram",
        channelId: "tg1",
        threadId: "new",
        updatedAt: new Date("2025-01-01"),
      },
    });

    const result = await caller.listConversations();
    expect(result).toHaveLength(2);
    expect(result[0].platform).toBe("telegram"); // newer first
  });
});

describe("tRPC: getConversation", () => {
  it("returns conversation with messages", async () => {
    const conv = await prisma.conversation.create({
      data: { platform: "web", channelId: "web", threadId: "t1" },
    });
    await prisma.message.create({
      data: { conversationId: conv.id, role: "user", content: "hello" },
    });
    await prisma.message.create({
      data: {
        conversationId: conv.id,
        role: "assistant",
        content: "hi there",
      },
    });

    const result = await caller.getConversation({ id: conv.id });
    expect(result.conversation.id).toBe(conv.id);
    expect(result.messages).toHaveLength(2);
    expect(result.messages[0].role).toBe("user");
    expect(result.messages[1].role).toBe("assistant");
  });

  it("throws for non-existent conversation", async () => {
    await expect(
      caller.getConversation({ id: "nonexistent" })
    ).rejects.toThrow();
  });
});

describe("tRPC: getStats", () => {
  it("returns zero stats initially", async () => {
    const result = await caller.getStats();
    expect(result.totalConversations).toBe(0);
    expect(result.totalMessages).toBe(0);
    expect(result.totalTokens.total).toBe(0);
  });

  it("counts conversations and messages with token aggregation", async () => {
    const conv = await prisma.conversation.create({
      data: { platform: "web", channelId: "web", threadId: "t1" },
    });
    await prisma.message.create({
      data: {
        conversationId: conv.id,
        role: "user",
        content: "test",
      },
    });
    await prisma.message.create({
      data: {
        conversationId: conv.id,
        role: "assistant",
        content: "response",
        tokensUsed: { prompt: 100, completion: 50, total: 150 },
      },
    });
    await prisma.message.create({
      data: {
        conversationId: conv.id,
        role: "assistant",
        content: "another",
        tokensUsed: { prompt: 200, completion: 80, total: 280 },
      },
    });

    const result = await caller.getStats();
    expect(result.totalConversations).toBe(1);
    expect(result.totalMessages).toBe(3);
    expect(result.totalTokens.prompt).toBe(300);
    expect(result.totalTokens.completion).toBe(130);
    expect(result.totalTokens.total).toBe(430);
  });
});

describe("tRPC: message flow simulation", () => {
  it("simulates a multi-message conversation with tool calls", async () => {
    const conv = await prisma.conversation.create({
      data: { platform: "telegram", channelId: "123", threadId: "t1" },
    });

    // User message
    await prisma.message.create({
      data: { conversationId: conv.id, role: "user", content: "What time is it?" },
    });

    // Status update
    await prisma.message.create({
      data: { conversationId: conv.id, role: "status", content: "Checking system clock..." },
    });

    // Tool call
    await prisma.message.create({
      data: {
        conversationId: conv.id,
        role: "tool",
        toolCalls: [
          { toolName: "bash", input: { command: "date" }, output: "Wed Mar 25 12:00:00 2026" },
        ],
      },
    });

    // Assistant response
    await prisma.message.create({
      data: {
        conversationId: conv.id,
        role: "assistant",
        content: "It's 12:00 PM",
        tokensUsed: { prompt: 500, completion: 20, total: 520 },
      },
    });

    const result = await caller.getConversation({ id: conv.id });
    expect(result.messages).toHaveLength(4);
    expect(result.messages[0].role).toBe("user");
    expect(result.messages[1].role).toBe("status");
    expect(result.messages[2].role).toBe("tool");
    expect(result.messages[3].role).toBe("assistant");

    // Verify tool call stored correctly
    const toolMsg = result.messages[2];
    expect(toolMsg.toolCalls).toHaveLength(1);
    expect((toolMsg.toolCalls as any)[0].toolName).toBe("bash");
  });

  it("handles conversations across platforms", async () => {
    await prisma.conversation.create({
      data: { platform: "slack", channelId: "C123", threadId: "ts1" },
    });
    await prisma.conversation.create({
      data: { platform: "telegram", channelId: "456", threadId: "t1" },
    });
    await prisma.conversation.create({
      data: { platform: "web", channelId: "web", threadId: "w1" },
    });

    const result = await caller.listConversations();
    expect(result).toHaveLength(3);
    const platforms = result.map((c) => c.platform);
    expect(platforms).toContain("slack");
    expect(platforms).toContain("telegram");
    expect(platforms).toContain("web");
  });
});
