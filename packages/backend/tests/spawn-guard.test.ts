import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { setupTestDb, teardownTestDb } from "./setup";
import type { PrismaClient } from "@prisma/client";

let prisma: PrismaClient;

beforeAll(async () => {
  const result = await setupTestDb();
  prisma = result.prisma;
});

afterAll(async () => {
  await teardownTestDb();
});

let convId: string;

beforeEach(async () => {
  await prisma.message.deleteMany();
  await prisma.conversation.deleteMany();
  const conv = await prisma.conversation.create({
    data: { platform: "test", channelId: "test", threadId: "test-spawn" },
  });
  convId = conv.id;
});

// Replicate the spawnPendingTasks guard logic for testing
async function findDoTaskMessages(conversationId: string) {
  const toolMessages = await prisma.message.findMany({
    where: { conversationId, role: "tool" },
    orderBy: { createdAt: "desc" },
    take: 20,
  });

  return toolMessages.filter(
    (m) => (m.toolCalls as any[])?.some((c: any) => c.toolName === "doTask")
  );
}

async function isAlreadySpawned(conversationId: string) {
  const doTaskMessages = await findDoTaskMessages(conversationId);
  return doTaskMessages.some((m) => m.content === "__spawned");
}

async function markAllSpawned(conversationId: string) {
  const doTaskMessages = await findDoTaskMessages(conversationId);
  for (const m of doTaskMessages) {
    if (m.content !== "__spawned") {
      await prisma.message.update({ where: { id: m.id }, data: { content: "__spawned" } });
    }
  }
}

// ─── Spawn guard logic ──────────────────────────────────────────────────────

describe("spawnPendingTasks guard", () => {
  it("finds doTask messages by toolName", async () => {
    await prisma.message.create({
      data: {
        conversationId: convId,
        role: "tool",
        toolCalls: [{ type: "tool-call", toolName: "doTask", input: { tasks: [{ name: "t1", prompt: "p1" }] } }],
      },
    });
    await prisma.message.create({
      data: {
        conversationId: convId,
        role: "tool",
        toolCalls: [{ type: "tool-call", toolName: "bash", input: { command: "ls" } }],
      },
    });

    const doTaskMsgs = await findDoTaskMessages(convId);
    expect(doTaskMsgs).toHaveLength(1);
  });

  it("returns not spawned when no __spawned messages exist", async () => {
    await prisma.message.create({
      data: {
        conversationId: convId,
        role: "tool",
        toolCalls: [{ type: "tool-call", toolName: "doTask", input: { tasks: [{ name: "t1", prompt: "p1" }] } }],
      },
    });

    expect(await isAlreadySpawned(convId)).toBe(false);
  });

  it("returns already spawned after marking", async () => {
    await prisma.message.create({
      data: {
        conversationId: convId,
        role: "tool",
        content: "__spawned",
        toolCalls: [{ type: "tool-call", toolName: "doTask", input: { tasks: [{ name: "t1", prompt: "p1" }] } }],
      },
    });

    expect(await isAlreadySpawned(convId)).toBe(true);
  });

  it("marks all doTask messages as __spawned", async () => {
    await prisma.message.create({
      data: {
        conversationId: convId,
        role: "tool",
        content: "__spawned",
        toolCalls: [{ type: "tool-call", toolName: "doTask", input: { tasks: [{ name: "t1", prompt: "p1" }] } }],
      },
    });
    // Second doTask (from a follow-up message, not yet marked)
    await prisma.message.create({
      data: {
        conversationId: convId,
        role: "tool",
        toolCalls: [{ type: "tool-call", toolName: "doTask", input: { tasks: [{ name: "t2", prompt: "p2" }] } }],
      },
    });

    await markAllSpawned(convId);

    const all = await findDoTaskMessages(convId);
    expect(all.every((m) => m.content === "__spawned")).toBe(true);
  });

  it("extracts tasks from toolCalls input", async () => {
    const msg = await prisma.message.create({
      data: {
        conversationId: convId,
        role: "tool",
        toolCalls: [{
          type: "tool-call",
          toolName: "doTask",
          input: {
            tasks: [
              { name: "Analyze project A", prompt: "Go to /path/a and analyze" },
              { name: "Analyze project B", prompt: "Go to /path/b and analyze" },
            ],
          },
        }],
      },
    });

    const calls = msg.toolCalls as any[];
    const tasks = calls[0].input.tasks;
    expect(tasks).toHaveLength(2);
    expect(tasks[0].name).toBe("Analyze project A");
    expect(tasks[1].prompt).toBe("Go to /path/b and analyze");
  });

  it("does not cross-contaminate between conversations", async () => {
    const conv2 = await prisma.conversation.create({
      data: { platform: "test", channelId: "test", threadId: "test-spawn-2" },
    });

    // Mark doTask as spawned in conv1
    await prisma.message.create({
      data: {
        conversationId: convId,
        role: "tool",
        content: "__spawned",
        toolCalls: [{ type: "tool-call", toolName: "doTask", input: { tasks: [] } }],
      },
    });

    // Conv2 should NOT be affected
    await prisma.message.create({
      data: {
        conversationId: conv2.id,
        role: "tool",
        toolCalls: [{ type: "tool-call", toolName: "doTask", input: { tasks: [{ name: "t", prompt: "p" }] } }],
      },
    });

    expect(await isAlreadySpawned(convId)).toBe(true);
    expect(await isAlreadySpawned(conv2.id)).toBe(false);
  });
});
