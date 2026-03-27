import { prisma } from "../lib/prisma";

export async function spawnTasksStep(
  tasks: { name: string; prompt: string }[],
  platform: string,
  channelId: string,
  parentConversationId: string,
) {
  "use step";

  const results: { name: string; taskId: string; status: string }[] = [];

  for (const task of tasks) {
    const res = await fetch("http://localhost:3000/api/prompt", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt: task.prompt, platform, channelId }),
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: "Request failed" })) as { error: string };
      results.push({ name: task.name, taskId: "", status: `error: ${err.error}` });
      continue;
    }

    const result = await res.json() as { conversationId: string; runId: string };

    // Track the spawned task
    await prisma.message.create({
      data: {
        conversationId: parentConversationId,
        role: "tool",
        content: null,
        toolCalls: [{
          toolName: "_spawnedTask",
          spawnedConversationId: result.conversationId,
          runId: result.runId,
          name: task.name,
          prompt: task.prompt.slice(0, 200),
          spawnedAt: new Date().toISOString(),
        }] as any,
      },
    });

    results.push({ name: task.name, taskId: result.conversationId, status: "spawned" });
  }

  const spawned = results.filter(r => r.status === "spawned").length;
  return {
    spawned: spawned,
    total: tasks.length,
    tasks: results,
    message: `${spawned}/${tasks.length} task(s) spawned. Results will be delivered to the chat as they complete.`,
  };
}

export async function listSpawnedTasksStep(parentConversationId: string) {
  "use step";

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
    name: string;
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
        name: call.name ?? "unnamed",
        id: call.spawnedConversationId,
        prompt: call.prompt,
        spawnedAt: call.spawnedAt,
        status,
        result,
      });
    }
  }

  if (tasks.length === 0) {
    return { tasks: [], message: "No spawned tasks found." };
  }

  const running = tasks.filter((t) => t.status === "running").length;
  const completed = tasks.filter((t) => t.status === "completed").length;

  return {
    tasks,
    message: `${tasks.length} task(s): ${running} running, ${completed} completed.`,
  };
}
