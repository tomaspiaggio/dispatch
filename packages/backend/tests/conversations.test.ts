import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { setupTestDb, teardownTestDb } from "./setup";
import type { PrismaClient } from "@prisma/client";
import {
  findOrCreateConversation,
  getConversationHistory,
  logMessage,
  buildSystemPrompt,
} from "../src/lib/conversations";

let prisma: PrismaClient;

beforeAll(async () => {
  const result = await setupTestDb();
  prisma = result.prisma;
});

afterAll(async () => {
  await teardownTestDb();
});

beforeEach(async () => {
  await prisma.message.deleteMany();
  await prisma.conversation.deleteMany();
});

describe("findOrCreateConversation", () => {
  it("creates a new conversation", async () => {
    const conv = await findOrCreateConversation(prisma, "telegram", "123", "t1");
    expect(conv.platform).toBe("telegram");
    expect(conv.channelId).toBe("123");
    expect(conv.threadId).toBe("t1");
  });

  it("finds existing conversation with same key", async () => {
    const conv1 = await findOrCreateConversation(prisma, "slack", "C1", "ts1");
    const conv2 = await findOrCreateConversation(prisma, "slack", "C1", "ts1");
    expect(conv1.id).toBe(conv2.id);
  });

  it("creates different conversations for different threads", async () => {
    const conv1 = await findOrCreateConversation(prisma, "slack", "C1", "ts1");
    const conv2 = await findOrCreateConversation(prisma, "slack", "C1", "ts2");
    expect(conv1.id).not.toBe(conv2.id);
  });

  it("uses channelId as threadId when threadId is null", async () => {
    const conv = await findOrCreateConversation(prisma, "web", "web", null);
    expect(conv.threadId).toBe("web");
  });
});

describe("getConversationHistory", () => {
  it("returns empty for new conversation", async () => {
    const conv = await findOrCreateConversation(prisma, "web", "w", "t1");
    const history = await getConversationHistory(prisma, conv.id);
    expect(history).toEqual([]);
  });

  it("returns user and assistant messages", async () => {
    const conv = await findOrCreateConversation(prisma, "web", "w", "t1");
    await logMessage(prisma, conv.id, "user", "hello");
    await logMessage(prisma, conv.id, "assistant", "hi");
    await logMessage(prisma, conv.id, "user", "how are you");

    const history = await getConversationHistory(prisma, conv.id);
    expect(history).toHaveLength(3);

    const roles = history.map((m) => m.role);
    expect(roles.filter((r) => r === "user")).toHaveLength(2);
    expect(roles.filter((r) => r === "assistant")).toHaveLength(1);

    const contents = history.map((m) => m.content);
    expect(contents).toContain("hello");
    expect(contents).toContain("hi");
    expect(contents).toContain("how are you");
  });

  it("excludes status and tool messages", async () => {
    const conv = await findOrCreateConversation(prisma, "web", "w", "t1");
    await logMessage(prisma, conv.id, "user", "do something");
    await logMessage(prisma, conv.id, "status", "working on it...");
    await logMessage(prisma, conv.id, "tool", null, [{ toolName: "bash" }]);
    await logMessage(prisma, conv.id, "assistant", "done");

    const history = await getConversationHistory(prisma, conv.id);
    expect(history).toHaveLength(2); // only user + assistant
    expect(history[0].content).toBe("do something");
    expect(history[1].content).toBe("done");
  });

  it("limits to 50 messages and truncates oldest", async () => {
    const conv = await findOrCreateConversation(prisma, "web", "w", "t1");

    // Create 60 messages
    for (let i = 0; i < 60; i++) {
      await logMessage(prisma, conv.id, i % 2 === 0 ? "user" : "assistant", `msg ${i}`);
    }

    const history = await getConversationHistory(prisma, conv.id);
    // Should be capped at ~50 messages (plus possible truncation notice)
    expect(history.length).toBeLessThanOrEqual(51);
    expect(history.length).toBeGreaterThanOrEqual(50);
  });
});

describe("logMessage", () => {
  it("creates a user message", async () => {
    const conv = await findOrCreateConversation(prisma, "web", "w", "t1");
    const msg = await logMessage(prisma, conv.id, "user", "test");
    expect(msg.role).toBe("user");
    expect(msg.content).toBe("test");
    expect(msg.conversationId).toBe(conv.id);
  });

  it("stores tool calls as JSON", async () => {
    const conv = await findOrCreateConversation(prisma, "web", "w", "t1");
    const toolCalls = [
      { toolName: "bash", input: { command: "ls" }, output: "file.txt" },
    ];
    const msg = await logMessage(prisma, conv.id, "tool", null, toolCalls);
    expect(msg.toolCalls).toEqual(toolCalls);
  });

  it("stores token usage", async () => {
    const conv = await findOrCreateConversation(prisma, "web", "w", "t1");
    const tokens = { prompt: 100, completion: 50, total: 150 };
    const msg = await logMessage(prisma, conv.id, "assistant", "response", null, null, tokens);
    expect(msg.tokensUsed).toEqual(tokens);
  });

  it("coerces non-string thinking to null", async () => {
    const conv = await findOrCreateConversation(prisma, "web", "w", "t1");
    const msg = await logMessage(prisma, conv.id, "assistant", "test", null, [] as any);
    expect(msg.thinking).toBeNull();
  });
});

describe("buildSystemPrompt", () => {
  const defaultPrompt = "You are a helpful assistant.";

  it("returns default prompt when soul and memories are empty", () => {
    const result = buildSystemPrompt("# Soul", "# Memories", defaultPrompt);
    expect(result).toBe(defaultPrompt);
  });

  it("prepends soul content", () => {
    const soul = "# Soul\n\n- **Name:** Dispatch\n- **Tone:** Casual";
    const result = buildSystemPrompt(soul, "# Memories", defaultPrompt);
    expect(result).toContain("**Name:** Dispatch");
    expect(result.indexOf("Dispatch")).toBeLessThan(result.indexOf("helpful assistant"));
  });

  it("appends memories content", () => {
    const memories = "# Memories\n\n- Always use pnpm\n- Deploy to prod on Fridays";
    const result = buildSystemPrompt("# Soul", memories, defaultPrompt);
    expect(result).toContain("Always use pnpm");
    expect(result.indexOf("helpful assistant")).toBeLessThan(result.indexOf("pnpm"));
  });

  it("combines soul + default + memories", () => {
    const soul = "# Soul\n\n- **Name:** Bot";
    const memories = "# Memories\n\n- Remember X";
    const result = buildSystemPrompt(soul, memories, defaultPrompt);

    const soulIdx = result.indexOf("Name: Bot");
    const defaultIdx = result.indexOf("helpful assistant");
    const memIdx = result.indexOf("Remember X");

    expect(soulIdx).toBeLessThan(defaultIdx);
    expect(defaultIdx).toBeLessThan(memIdx);
  });
});
