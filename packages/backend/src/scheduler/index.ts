import { prisma } from "../lib/prisma";
import { executePromptAndDeliver } from "../chat/deliver";

const POLL_INTERVAL_MS = 60_000; // Check every 60 seconds

function log(msg: string, data?: any) {
  const ts = new Date().toISOString().slice(11, 23);
  if (data !== undefined) {
    console.log(`[${ts}] [scheduler] ${msg}`, typeof data === "string" ? data : JSON.stringify(data));
  } else {
    console.log(`[${ts}] [scheduler] ${msg}`);
  }
}

async function tick() {
  try {
    const due = await prisma.schedule.findMany({
      where: {
        status: "active",
        nextRun: { lte: new Date() },
      },
    });

    if (due.length === 0) return;

    log(`Found ${due.length} due schedule(s)`);

    for (const schedule of due) {
      log(`Executing: "${schedule.name}"`, {
        id: schedule.id,
        prompt: schedule.prompt.slice(0, 80),
        platform: schedule.platform,
      });

      try {
        // Add background worker prefix so the agent does the work directly
        // instead of trying to delegate via doTask
        const prompt = `IMPORTANT: You are a background worker executing a scheduled task. Do the work directly using your tools (bash, readFile, writeFile, webFetch, etc). Do NOT use doTask — complete the work yourself and respond with the result.\n\n${schedule.prompt}`;
        await executePromptAndDeliver(
          prompt,
          schedule.platform,
          schedule.channelId,
        );

        // Update schedule
        if (schedule.cronExpression) {
          // Recurring: compute next run
          const { CronExpressionParser } = await import("cron-parser");
          const interval = CronExpressionParser.parse(schedule.cronExpression);
          const nextRun = interval.next().toDate();

          await prisma.schedule.update({
            where: { id: schedule.id },
            data: { lastRun: new Date(), nextRun },
          });

          log(`Recurring schedule "${schedule.name}" next run: ${nextRun.toISOString()}`);
        } else {
          // One-time: mark completed
          await prisma.schedule.update({
            where: { id: schedule.id },
            data: { lastRun: new Date(), status: "completed" },
          });

          log(`One-time schedule "${schedule.name}" completed`);
        }
      } catch (err) {
        log(`Failed to execute schedule "${schedule.name}": ${err}`);
      }
    }
  } catch (err) {
    log(`Tick error: ${err}`);
  }
}

let intervalHandle: ReturnType<typeof setInterval> | null = null;

export function startScheduler() {
  if (intervalHandle) return;

  log(`Started (checking every ${POLL_INTERVAL_MS / 1000}s)`);

  // Run immediately on start to catch any missed schedules
  tick();

  intervalHandle = setInterval(tick, POLL_INTERVAL_MS);
}

export function stopScheduler() {
  if (intervalHandle) {
    clearInterval(intervalHandle);
    intervalHandle = null;
    log(`Stopped`);
  }
}
