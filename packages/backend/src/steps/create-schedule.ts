import { prisma } from "../lib/prisma";

function parseDelay(delay: string): number {
  const match = delay.match(/^(\d+)(m|h|d|s)$/);
  if (!match) throw new Error(`Invalid delay format: ${delay}. Use e.g., "30m", "2h", "1d"`);
  const [, num, unit] = match;
  const multipliers: Record<string, number> = {
    s: 1000,
    m: 60 * 1000,
    h: 60 * 60 * 1000,
    d: 24 * 60 * 60 * 1000,
  };
  return parseInt(num!) * multipliers[unit!]!;
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

  const nextRun = delay
    ? new Date(Date.now() + parseDelay(delay))
    : cronExpression
      ? calculateNextCronRun(cronExpression)
      : null;

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

function calculateNextCronRun(cron: string): Date {
  // Simple cron parsing for common patterns
  // For production, use a library like cron-parser
  // For now, default to 1 hour from now as placeholder
  return new Date(Date.now() + 60 * 60 * 1000);
}
