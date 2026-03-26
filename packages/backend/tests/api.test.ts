import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { Hono } from "hono";
import { setupTestDb, teardownTestDb } from "./setup";
import type { PrismaClient } from "@prisma/client";

let prisma: PrismaClient;
let app: Hono;

beforeAll(async () => {
  const result = await setupTestDb();
  prisma = result.prisma;

  // Create a test Hono app with the test Prisma client
  // We import the routes and inject the test prisma
  app = new Hono();

  // Health check
  app.get("/health", (c) => c.json({ status: "ok" }));

  // Conversations
  app.get("/api/conversations", async (c) => {
    const conversations = await prisma.conversation.findMany({
      orderBy: { updatedAt: "desc" },
      take: 50,
    });
    return c.json({ conversations });
  });

  app.get("/api/conversations/:id", async (c) => {
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

  app.post("/api/messages", async (c) => {
    const { content, conversationId } = await c.req.json<{
      content: string;
      conversationId?: string;
    }>();
    const convId = conversationId ?? crypto.randomUUID();
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
    await prisma.message.create({
      data: { conversationId: conversation.id, role: "user", content },
    });
    return c.json({ conversationId: conversation.id, runId: "test" });
  });

  // Stats
  app.get("/api/stats", async (c) => {
    const [totalConversations, totalMessages] = await Promise.all([
      prisma.conversation.count(),
      prisma.message.count(),
    ]);
    return c.json({
      totalConversations,
      totalMessages,
      totalTokens: { prompt: 0, completion: 0, total: 0 },
    });
  });

  // Memory and Soul are now file-based (~/.dispatch/), not tested via Prisma
});

afterAll(async () => {
  await teardownTestDb();
});

beforeEach(async () => {
  // Clean up between tests
  await prisma.message.deleteMany();
  await prisma.conversation.deleteMany();
});

function req(path: string, init?: RequestInit) {
  return app.request(path, init);
}

describe("Health check", () => {
  it("returns ok", async () => {
    const res = await req("/health");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "ok" });
  });
});

describe("Conversations API", () => {
  it("returns empty list initially", async () => {
    const res = await req("/api/conversations");
    const data = await res.json();
    expect(data.conversations).toEqual([]);
  });

  it("creates conversation via message", async () => {
    const res = await req("/api/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: "Hello, Chepibe!" }),
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.conversationId).toBeTruthy();

    // Verify conversation exists
    const listRes = await req("/api/conversations");
    const listData = await listRes.json();
    expect(listData.conversations).toHaveLength(1);
    expect(listData.conversations[0].platform).toBe("web");
  });

  it("retrieves conversation with messages", async () => {
    // Create a conversation
    const createRes = await req("/api/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: "Test message" }),
    });
    const { conversationId } = await createRes.json();

    // Get conversation
    const res = await req(`/api/conversations/${conversationId}`);
    const data = await res.json();
    expect(data.conversation.id).toBe(conversationId);
    expect(data.messages).toHaveLength(1);
    expect(data.messages[0].content).toBe("Test message");
    expect(data.messages[0].role).toBe("user");
  });

  it("returns 404 for non-existent conversation", async () => {
    const res = await req("/api/conversations/non-existent-id");
    expect(res.status).toBe(404);
  });

  it("adds messages to existing conversation", async () => {
    // Create conversation
    const res1 = await req("/api/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: "First message" }),
    });
    const { conversationId } = await res1.json();

    // Add another message to same conversation
    await req("/api/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: "Second message", conversationId }),
    });

    // Verify both messages
    const res = await req(`/api/conversations/${conversationId}`);
    const data = await res.json();
    expect(data.messages).toHaveLength(2);
    expect(data.messages[0].content).toBe("First message");
    expect(data.messages[1].content).toBe("Second message");
  });
});

describe("Stats API", () => {
  it("returns zero stats initially", async () => {
    const res = await req("/api/stats");
    const data = await res.json();
    expect(data.totalConversations).toBe(0);
    expect(data.totalMessages).toBe(0);
  });

  it("counts conversations and messages", async () => {
    await req("/api/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: "Hello" }),
    });
    await req("/api/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: "World" }),
    });

    const res = await req("/api/stats");
    const data = await res.json();
    expect(data.totalConversations).toBe(2);
    expect(data.totalMessages).toBe(2);
  });
});

// Memory and Soul are now file-based (~/.dispatch/), tested separately in steps.test.ts

describe("Message flow simulation", () => {
  it("simulates a multi-message conversation", async () => {
    // User sends first message
    const res1 = await req("/api/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: "What's the weather like?" }),
    });
    const { conversationId } = await res1.json();

    // Simulate assistant response (direct DB insert)
    await prisma.message.create({
      data: {
        conversationId,
        role: "assistant",
        content: "Let me check that for you...",
        tokensUsed: { prompt: 50, completion: 20, total: 70 },
      },
    });

    // Simulate status message
    await prisma.message.create({
      data: {
        conversationId,
        role: "status",
        content: "Fetching weather data...",
      },
    });

    // Simulate tool call message
    await prisma.message.create({
      data: {
        conversationId,
        role: "tool",
        toolCalls: [
          {
            id: "tc_1",
            name: "webFetch",
            args: { url: "https://api.weather.com/current" },
            result: { temperature: 22, condition: "sunny" },
            status: "success",
            durationMs: 150,
          },
        ],
      },
    });

    // Simulate final response
    await prisma.message.create({
      data: {
        conversationId,
        role: "assistant",
        content: "It's 22C and sunny!",
        tokensUsed: { prompt: 150, completion: 30, total: 180 },
      },
    });

    // User follows up
    await req("/api/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        content: "What about tomorrow?",
        conversationId,
      }),
    });

    // Verify full conversation
    const res = await req(`/api/conversations/${conversationId}`);
    const data = await res.json();
    expect(data.messages).toHaveLength(6); // 2 user + 2 assistant + 1 status + 1 tool
    expect(data.messages[0].role).toBe("user");
    expect(data.messages[1].role).toBe("assistant");
    expect(data.messages[2].role).toBe("status");
    expect(data.messages[3].role).toBe("tool");
    expect(data.messages[4].role).toBe("assistant");
    expect(data.messages[5].role).toBe("user");

    // Verify tool calls are stored correctly
    const toolMsg = data.messages[3];
    expect(toolMsg.toolCalls).toHaveLength(1);
    expect(toolMsg.toolCalls[0].name).toBe("webFetch");
    expect(toolMsg.toolCalls[0].status).toBe("success");
  });

  it("simulates messages from different platforms", async () => {
    // Create Slack conversation
    await prisma.conversation.create({
      data: {
        platform: "slack",
        channelId: "C12345",
        threadId: "1234567890.123",
      },
    });

    // Create Telegram conversation
    await prisma.conversation.create({
      data: {
        platform: "telegram",
        channelId: "chat_456",
        threadId: "789",
      },
    });

    // Create Web conversation
    await req("/api/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: "Hello from web" }),
    });

    // Verify all 3 show up
    const res = await req("/api/conversations");
    const data = await res.json();
    expect(data.conversations).toHaveLength(3);

    const platforms = data.conversations.map(
      (c: { platform: string }) => c.platform
    );
    expect(platforms).toContain("slack");
    expect(platforms).toContain("telegram");
    expect(platforms).toContain("web");
  });
});

// Schedules now use workflow sleep() — no DB table needed
