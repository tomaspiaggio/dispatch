import type { Run } from "workflow/api";
import { prisma } from "../lib/prisma";

const CONVERSATION_WAIT_MS = 15_000;
const POLL_INTERVAL_MS = 2_000;
const IDLE_TIMEOUT_MS = 120_000;
const COMPLETION_GRACE_MS = 5_000;
const MAX_WAIT_MS = 30 * 60_000;

type LogFn = (msg: string, data?: unknown) => void;

type DeliverMessage = (message: { role: string; content: string }) => Promise<void>;

type WaitAndPostOptions = {
  conversationId: string;
  startTime: Date;
  run: Run<unknown>;
  log: LogFn;
  deliverMessage: DeliverMessage;
  timeoutMessage: string;
};

export async function waitForConversation(
  platform: string,
  channelId: string,
  threadId: string | null,
  maxWait = CONVERSATION_WAIT_MS
) {
  const resolvedThreadId = threadId ?? channelId;
  const deadline = Date.now() + maxWait;

  while (Date.now() < deadline) {
    const conv = await prisma.conversation.findUnique({
      where: {
        platform_channelId_threadId: {
          platform,
          channelId,
          threadId: resolvedThreadId,
        },
      },
    });
    if (conv) return conv;
    await new Promise((r) => setTimeout(r, 500));
  }

  return null;
}

export async function waitAndPostResponse({
  conversationId,
  startTime,
  run,
  log,
  deliverMessage,
  timeoutMessage,
}: WaitAndPostOptions) {
  const postedIds = new Set<string>();
  const startedAt = Date.now();
  let idleDeadline = startedAt + IDLE_TIMEOUT_MS;
  let completedAt: number | null = null;
  let lastKnownStatus:
    | "pending"
    | "running"
    | "workflow_suspended"
    | "completed"
    | "failed"
    | "cancelled"
    | "unknown" = "pending";

  log(`Polling for response on ${conversationId}...`, { runId: run.runId });

  while (Date.now() - startedAt < MAX_WAIT_MS) {
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));

    const msgs = await prisma.message.findMany({
      where: {
        conversationId,
        role: { in: ["assistant", "status"] },
        createdAt: { gt: startTime },
      },
      orderBy: { createdAt: "asc" },
    });

    for (const msg of msgs) {
      if (postedIds.has(msg.id) || !msg.content) continue;
      postedIds.add(msg.id);
      idleDeadline = Date.now() + IDLE_TIMEOUT_MS;
      log(`Posting [${msg.role}]: ${msg.content.slice(0, 80)}...`);
      await deliverMessage({ role: msg.role, content: msg.content });
    }

    if (msgs.some((msg) => msg.role === "assistant" && postedIds.has(msg.id))) {
      log(`Response delivered`, { runId: run.runId });
      return;
    }

    const status = await run.status.catch((error) => {
      log(`Failed to read workflow status`, error);
      return "unknown" as const;
    });
    lastKnownStatus = status;

    if (status === "completed" || status === "failed" || status === "cancelled") {
      completedAt ??= Date.now();
      if (Date.now() - completedAt >= COMPLETION_GRACE_MS) break;
      continue;
    }

    if (Date.now() >= idleDeadline) {
      log(`Workflow still active after idle timeout; extending wait`, {
        runId: run.runId,
        status,
      });
      idleDeadline = Date.now() + IDLE_TIMEOUT_MS;
    }
  }

  if (
    lastKnownStatus === "completed" ||
    lastKnownStatus === "failed" ||
    lastKnownStatus === "cancelled"
  ) {
    log(`Workflow finished without a final assistant message`, {
      runId: run.runId,
      status: lastKnownStatus,
    });
    await deliverMessage({
      role: "status",
      content: "Something went wrong: the workflow finished without a final response.",
    });
    return;
  }

  log(`TIMEOUT on ${conversationId}`, { runId: run.runId, status: lastKnownStatus });
  await deliverMessage({ role: "status", content: timeoutMessage });
}
