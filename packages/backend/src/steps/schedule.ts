import { prisma } from "../lib/prisma";

function parseDelay(delay: string): number {
  const match = delay.match(/^(\d+)\s*(s|sec|m|min|h|hr|hour|d|day)s?$/i);
  if (!match) throw new Error(`Invalid delay: "${delay}". Use e.g. "30s", "5m", "1h", "2d"`);
  const [, num, unit] = match;
  const u = unit!.toLowerCase();
  const multipliers: Record<string, number> = {
    s: 1000, sec: 1000,
    m: 60_000, min: 60_000,
    h: 3600_000, hr: 3600_000, hour: 3600_000,
    d: 86400_000, day: 86400_000,
  };
  return parseInt(num!) * multipliers[u]!;
}

export async function createScheduleStep(
  name: string,
  prompt: string,
  platform: string,
  channelId: string,
  threadJson: string | null,
  cronExpression?: string,
  delay?: string
) {
  "use step";

  const { CronExpressionParser } = await import("cron-parser");

  let nextRun: Date | null = null;

  if (cronExpression) {
    const interval = CronExpressionParser.parse(cronExpression);
    nextRun = interval.next().toDate();
  } else if (delay) {
    nextRun = new Date(Date.now() + parseDelay(delay));
  }

  const schedule = await prisma.schedule.create({
    data: {
      name,
      prompt,
      cronExpression: cronExpression ?? null,
      threadJson,
      platform,
      channelId,
      status: "active",
      nextRun,
    },
  });

  return {
    scheduleId: schedule.id,
    name: schedule.name,
    nextRun: nextRun?.toISOString() ?? null,
    type: cronExpression ? "recurring" : "one-time",
  };
}

export async function listSchedulesStep(status?: string) {
  "use step";

  const schedules = await prisma.schedule.findMany({
    where: status ? { status } : { status: { not: "completed" } },
    orderBy: { createdAt: "desc" },
  });

  return schedules.map((s) => ({
    id: s.id,
    name: s.name,
    prompt: s.prompt,
    cronExpression: s.cronExpression,
    platform: s.platform,
    channelId: s.channelId,
    status: s.status,
    nextRun: s.nextRun?.toISOString() ?? null,
    lastRun: s.lastRun?.toISOString() ?? null,
    createdAt: s.createdAt.toISOString(),
  }));
}

export async function deleteScheduleStep(scheduleId: string) {
  "use step";

  const schedule = await prisma.schedule.delete({
    where: { id: scheduleId },
  });

  return { deleted: true, name: schedule.name };
}
