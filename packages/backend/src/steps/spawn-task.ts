import { prisma } from "../lib/prisma";

export async function spawnTaskStep(
  prompt: string,
  platform: string,
  channelId: string,
  parentConversationId: string,
) {
  "use step";

  // Call the HTTP endpoint instead of importing deliver.ts directly,
  // because this step runs inside the workflow sandbox where workflow
  // module imports don't resolve correctly.
  const res = await fetch("http://localhost:3000/api/prompt", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ prompt, platform, channelId }),
  });
  const result = await res.json() as { conversationId: string; runId: string };

  // Track the spawned task so we can query its status later
  await prisma.message.create({
    data: {
      conversationId: parentConversationId,
      role: "tool",
      content: null,
      toolCalls: [{
        toolName: "_spawnedTask",
        spawnedConversationId: result.conversationId,
        runId: result.runId,
        prompt: prompt.slice(0, 200),
        spawnedAt: new Date().toISOString(),
      }] as any,
    },
  });

  return {
    spawned: true,
    taskId: result.conversationId,
    message: "Task is running in the background. The result will be delivered to the chat when done. DO NOT call doTask again for this request — the task is already running. Just confirm to the user and stop.",
  };
}

export async function listSpawnedTasksStep(parentConversationId: string) {
  "use step";

  // Find _spawnedTask records from the last hour
  const since = new Date(Date.now() - 60 * 60 * 1000);
  const taskMessages = await prisma.message.findMany({
    where: {
      conversationId: parentConversationId,
      role: "tool",
      createdAt: { gte: since },
    },
    orderBy: { createdAt: "desc" },
  });

  const tasks: {
    id: string;
    prompt: string;
    spawnedAt: string;
    status: "running" | "completed" | "unknown";
    result: string | null;
  }[] = [];

  for (const msg of taskMessages) {
    const calls = msg.toolCalls as any[];
    for (const call of calls) {
      if (call.toolName !== "_spawnedTask") continue;

      // Find the spawned conversation by threadId
      const spawnedConv = await prisma.conversation.findFirst({
        where: { threadId: call.spawnedConversationId },
      });

      let status: "running" | "completed" | "unknown" = "unknown";
      let result: string | null = null;

      if (spawnedConv) {
        const assistantMsg = await prisma.message.findFirst({
          where: { conversationId: spawnedConv.id, role: "assistant" },
          orderBy: { createdAt: "desc" },
        });
        status = assistantMsg ? "completed" : "running";
        result = assistantMsg?.content?.slice(0, 200) ?? null;
      }

      tasks.push({
        id: call.spawnedConversationId,
        prompt: call.prompt,
        spawnedAt: call.spawnedAt,
        status,
        result,
      });
    }
  }

  if (tasks.length === 0) {
    return { tasks: [], message: "No spawned tasks found in this conversation." };
  }

  const running = tasks.filter((t) => t.status === "running").length;
  const completed = tasks.filter((t) => t.status === "completed").length;

  return {
    tasks,
    message: `${tasks.length} spawned task(s): ${running} running, ${completed} completed.`,
  };
}
