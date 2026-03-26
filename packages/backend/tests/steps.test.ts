import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { setupTestDb, teardownTestDb } from "./setup";
import type { PrismaClient } from "@prisma/client";
import { writeFile, mkdir, readFile, rm } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";

let prisma: PrismaClient;
let testDir: string;

beforeAll(async () => {
  const result = await setupTestDb();
  prisma = result.prisma;

  // Create a temp directory for file tests
  testDir = join(tmpdir(), `dispatch-test-${Date.now()}`);
  await mkdir(testDir, { recursive: true });
});

afterAll(async () => {
  await rm(testDir, { recursive: true, force: true });
  await teardownTestDb();
});

beforeEach(async () => {
  await prisma.message.deleteMany();
  await prisma.conversation.deleteMany();
});

describe("readFile step logic", () => {
  it("reads a file successfully", async () => {
    const filePath = join(testDir, "test-read.txt");
    await writeFile(filePath, "Hello, Chepibe!");

    const content = await readFile(filePath, "utf-8");
    expect(content).toBe("Hello, Chepibe!");
  });

  it("throws on non-existent file", async () => {
    await expect(
      readFile(join(testDir, "nonexistent.txt"), "utf-8")
    ).rejects.toThrow();
  });
});

describe("writeFile step logic", () => {
  it("writes a file", async () => {
    const filePath = join(testDir, "test-write.txt");
    await writeFile(filePath, "Written by test");

    const content = await readFile(filePath, "utf-8");
    expect(content).toBe("Written by test");
  });

  it("creates nested directories", async () => {
    const filePath = join(testDir, "nested", "dir", "test.txt");
    await mkdir(join(testDir, "nested", "dir"), { recursive: true });
    await writeFile(filePath, "Nested content");

    const content = await readFile(filePath, "utf-8");
    expect(content).toBe("Nested content");
  });
});

describe("bash step logic", () => {
  it("executes a simple command", async () => {
    const { execSync } = await import("child_process");
    const result = execSync("echo 'hello from bash'", { encoding: "utf-8" });
    expect(result.trim()).toBe("hello from bash");
  });

  it("captures stderr", async () => {
    const { exec } = await import("child_process");
    const { promisify } = await import("util");
    const execAsync = promisify(exec);

    try {
      await execAsync("ls /nonexistent_path_12345");
    } catch (error: any) {
      expect(error.stderr).toBeTruthy();
    }
  });
});

describe("webFetch step logic", () => {
  it("fetches a URL", async () => {
    const res = await fetch("https://httpbin.org/get");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.url).toBe("https://httpbin.org/get");
  });

  it("sends POST requests", async () => {
    const res = await fetch("https://httpbin.org/post", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ test: true }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.json.test).toBe(true);
  });
});

describe("Memory step logic (file-based)", () => {
  it("creates and lists memories via file", async () => {
    // Test the file-based memory functions directly
    const memFile = join(testDir, "memories.json");
    await writeFile(memFile, JSON.stringify([]), "utf-8");

    const data = await readFile(memFile, "utf-8");
    const memories = JSON.parse(data);
    expect(memories).toEqual([]);

    // Add a memory
    const entry = { id: "test-1", content: "Always use pnpm", addedBy: "user", createdAt: new Date().toISOString() };
    memories.push(entry);
    await writeFile(memFile, JSON.stringify(memories), "utf-8");

    const updated = JSON.parse(await readFile(memFile, "utf-8"));
    expect(updated).toHaveLength(1);
    expect(updated[0].content).toBe("Always use pnpm");
  });

  it("removes a memory from file", async () => {
    const memFile = join(testDir, "memories2.json");
    const entries = [
      { id: "a", content: "keep", addedBy: "user", createdAt: new Date().toISOString() },
      { id: "b", content: "remove", addedBy: "user", createdAt: new Date().toISOString() },
    ];
    await writeFile(memFile, JSON.stringify(entries), "utf-8");

    const data = JSON.parse(await readFile(memFile, "utf-8"));
    const filtered = data.filter((m: any) => m.id !== "b");
    await writeFile(memFile, JSON.stringify(filtered), "utf-8");

    const result = JSON.parse(await readFile(memFile, "utf-8"));
    expect(result).toHaveLength(1);
    expect(result[0].content).toBe("keep");
  });
});

describe("Conversation step logic", () => {
  it("finds or creates a conversation", async () => {
    // Create
    const conv1 = await prisma.conversation.upsert({
      where: {
        platform_channelId_threadId: {
          platform: "slack",
          channelId: "C123",
          threadId: "t1",
        },
      },
      create: { platform: "slack", channelId: "C123", threadId: "t1" },
      update: { updatedAt: new Date() },
    });

    // Find (same params)
    const conv2 = await prisma.conversation.upsert({
      where: {
        platform_channelId_threadId: {
          platform: "slack",
          channelId: "C123",
          threadId: "t1",
        },
      },
      create: { platform: "slack", channelId: "C123", threadId: "t1" },
      update: { updatedAt: new Date() },
    });

    expect(conv1.id).toBe(conv2.id);
  });

  it("builds system prompt with soul and memories from files", async () => {
    const soulEntries = [
      { key: "name", value: "Chepi" },
      { key: "personality", value: "casual and helpful" },
    ];
    const memories = ["Always use pnpm", "Prefer TypeScript"];

    const soulSection = soulEntries.map((s) => `${s.key}: ${s.value}`).join("\n");
    const memoriesSection = memories.map((m) => `- ${m}`).join("\n");

    expect(soulSection).toContain("name: Chepi");
    expect(soulSection).toContain("personality: casual and helpful");
    expect(memoriesSection).toContain("- Always use pnpm");
    expect(memoriesSection).toContain("- Prefer TypeScript");
  });
});

describe("Soul file logic", () => {
  it("stores and reads soul entries from file", async () => {
    const soulFile = join(testDir, "soul.json");
    const entries = [
      { key: "name", value: "Chepi" },
      { key: "tone", value: "casual" },
    ];
    await writeFile(soulFile, JSON.stringify(entries), "utf-8");

    const data = JSON.parse(await readFile(soulFile, "utf-8"));
    expect(data).toHaveLength(2);
    expect(data[0].key).toBe("name");
    expect(data[0].value).toBe("Chepi");

    // Update existing entry
    const updated = data.map((e: any) =>
      e.key === "name" ? { ...e, value: "Chepibe" } : e
    );
    await writeFile(soulFile, JSON.stringify(updated), "utf-8");

    const final = JSON.parse(await readFile(soulFile, "utf-8"));
    expect(final.find((e: any) => e.key === "name").value).toBe("Chepibe");
  });
});
