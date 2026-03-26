import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { setupTestDb, teardownTestDb } from "./setup";
import type { PrismaClient } from "@prisma/client";
import { getConversationHistoryStep, findOrCreateConversationStep } from "../src/steps/conversation";
import { logMessageStep } from "../src/steps/log-message";

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

describe("Voice Support in getConversationHistoryStep", () => {
  it("should parse JSON content into structured parts", async () => {
    const conv = await findOrCreateConversationStep("telegram", "123", "t1");
    const voiceContent = JSON.stringify([
      { type: "text", text: "What's in this audio?" },
      { type: "file", data: "base64data", mimeType: "audio/ogg" }
    ]);
    
    await logMessageStep(conv.id, "user", voiceContent);
    
    const history = await getConversationHistoryStep(conv.id);
    expect(history).toHaveLength(1);
    const msg = history[0];
    expect(msg.role).toBe("user");
    expect(Array.isArray(msg.content)).toBe(true);
    if (Array.isArray(msg.content)) {
      expect(msg.content).toHaveLength(2);
      expect(msg.content[0]).toEqual({ type: "text", text: "What's in this audio?" });
      expect(msg.content[1]).toEqual({ type: "file", data: "base64data", mimeType: "audio/ogg" });
    }
  });

  it("should still handle plain text content", async () => {
    const conv = await findOrCreateConversationStep("telegram", "123", "t1");
    await logMessageStep(conv.id, "user", "Hello world");
    
    const history = await getConversationHistoryStep(conv.id);
    expect(history).toHaveLength(1);
    expect(history[0].content).toBe("Hello world");
  });
});
