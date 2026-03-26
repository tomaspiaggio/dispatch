import { describe, it, expect, beforeAll, afterAll, beforeEach, vi, afterEach } from "vitest";
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

beforeEach(async () => {
  await prisma.schedule.deleteMany();
});

// ─── Schedule CRUD ───────────────────────────────────────────────────────────

describe("schedule CRUD", () => {
  it("creates a one-time schedule with delay", async () => {
    const before = Date.now();
    const schedule = await prisma.schedule.create({
      data: {
        name: "test reminder",
        prompt: "say hello",
        platform: "telegram",
        channelId: "123",
        status: "active",
        nextRun: new Date(Date.now() + 30 * 60_000), // 30m from now
      },
    });

    expect(schedule.name).toBe("test reminder");
    expect(schedule.cronExpression).toBeNull();
    expect(schedule.status).toBe("active");
    expect(schedule.nextRun!.getTime()).toBeGreaterThanOrEqual(before + 29 * 60_000);
  });

  it("creates a recurring schedule with cron expression", async () => {
    const schedule = await prisma.schedule.create({
      data: {
        name: "daily HN summary",
        prompt: "summarize hacker news",
        cronExpression: "30 8 * * *",
        platform: "telegram",
        channelId: "456",
        status: "active",
        nextRun: new Date("2026-03-27T15:30:00Z"),
      },
    });

    expect(schedule.cronExpression).toBe("30 8 * * *");
    expect(schedule.status).toBe("active");
  });

  it("lists active schedules", async () => {
    await prisma.schedule.createMany({
      data: [
        { name: "active1", prompt: "p1", platform: "telegram", channelId: "1", status: "active", nextRun: new Date() },
        { name: "completed1", prompt: "p2", platform: "telegram", channelId: "1", status: "completed" },
        { name: "active2", prompt: "p3", platform: "slack", channelId: "2", status: "active", nextRun: new Date() },
      ],
    });

    const active = await prisma.schedule.findMany({ where: { status: "active" } });
    expect(active).toHaveLength(2);
    expect(active.map((s) => s.name).sort()).toEqual(["active1", "active2"]);
  });

  it("deletes a schedule", async () => {
    const schedule = await prisma.schedule.create({
      data: {
        name: "to delete",
        prompt: "test",
        platform: "web",
        channelId: "api",
        status: "active",
      },
    });

    await prisma.schedule.delete({ where: { id: schedule.id } });
    const found = await prisma.schedule.findUnique({ where: { id: schedule.id } });
    expect(found).toBeNull();
  });

  it("updates lastRun and nextRun for recurring schedule", async () => {
    const schedule = await prisma.schedule.create({
      data: {
        name: "recurring",
        prompt: "do thing",
        cronExpression: "0 9 * * *",
        platform: "telegram",
        channelId: "1",
        status: "active",
        nextRun: new Date("2026-03-26T16:00:00Z"),
      },
    });

    const now = new Date();
    const nextRun = new Date("2026-03-27T16:00:00Z");
    const updated = await prisma.schedule.update({
      where: { id: schedule.id },
      data: { lastRun: now, nextRun },
    });

    expect(updated.lastRun!.getTime()).toBe(now.getTime());
    expect(updated.nextRun!.getTime()).toBe(nextRun.getTime());
  });

  it("marks one-time schedule as completed", async () => {
    const schedule = await prisma.schedule.create({
      data: {
        name: "one-time",
        prompt: "once",
        platform: "web",
        channelId: "api",
        status: "active",
        nextRun: new Date(),
      },
    });

    const updated = await prisma.schedule.update({
      where: { id: schedule.id },
      data: { status: "completed", lastRun: new Date() },
    });

    expect(updated.status).toBe("completed");
  });
});

// ─── Scheduler tick logic ────────────────────────────────────────────────────

describe("scheduler tick", () => {
  it("finds due schedules (nextRun <= now)", async () => {
    const pastDate = new Date(Date.now() - 60_000);
    const futureDate = new Date(Date.now() + 60 * 60_000);

    await prisma.schedule.createMany({
      data: [
        { name: "overdue", prompt: "p1", platform: "telegram", channelId: "1", status: "active", nextRun: pastDate },
        { name: "not yet", prompt: "p2", platform: "telegram", channelId: "1", status: "active", nextRun: futureDate },
        { name: "completed", prompt: "p3", platform: "telegram", channelId: "1", status: "completed", nextRun: pastDate },
      ],
    });

    const due = await prisma.schedule.findMany({
      where: {
        status: "active",
        nextRun: { lte: new Date() },
      },
    });

    expect(due).toHaveLength(1);
    expect(due[0].name).toBe("overdue");
  });

  it("does not pick up paused schedules", async () => {
    await prisma.schedule.create({
      data: {
        name: "paused",
        prompt: "p",
        platform: "telegram",
        channelId: "1",
        status: "paused",
        nextRun: new Date(Date.now() - 60_000),
      },
    });

    const due = await prisma.schedule.findMany({
      where: {
        status: "active",
        nextRun: { lte: new Date() },
      },
    });

    expect(due).toHaveLength(0);
  });
});

// ─── Cron parsing ────────────────────────────────────────────────────────────

describe("cron-parser integration", () => {
  it("computes next run from cron expression", async () => {
    const { CronExpressionParser } = await import("cron-parser");
    const interval = CronExpressionParser.parse("30 8 * * *"); // 8:30 AM daily
    const next = interval.next().toDate();

    expect(next).toBeInstanceOf(Date);
    expect(next.getTime()).toBeGreaterThan(Date.now());
    expect(next.getMinutes()).toBe(30);
    expect(next.getHours()).toBe(8);
  });

  it("computes next run for every-5-minutes cron", async () => {
    const { CronExpressionParser } = await import("cron-parser");
    const interval = CronExpressionParser.parse("*/5 * * * *");
    const next = interval.next().toDate();

    expect(next.getTime()).toBeGreaterThan(Date.now());
    // Should be within 5 minutes
    expect(next.getTime() - Date.now()).toBeLessThanOrEqual(5 * 60_000 + 1000);
  });

  it("throws on invalid cron expression", async () => {
    const { CronExpressionParser } = await import("cron-parser");
    expect(() => CronExpressionParser.parse("not a cron")).toThrow();
  });
});
