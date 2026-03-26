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
    conversationId: result.conversationId,
    runId: result.runId,
    message: `Task spawned in a separate conversation. It will deliver the result to ${platform}/${channelId} when done.`,
  };
}

export async function listSpawnedTasksStep(parentConversationId: string) {
  "use step";

  // Find all _spawnedTask tool call records in this conversation
  const taskMessages = await prisma.message.findMany({
    where: {
      conversationId: parentConversationId,
      role: "tool",
    },
    orderBy: { createdAt: "desc" },
  });

  const tasks: {
    conversationId: string;
    runId: string;
    prompt: string;
    spawnedAt: string;
    status: "running" | "completed" | "unknown";
    result: string | null;
  }[] = [];

  for (const msg of taskMessages) {
    const calls = msg.toolCalls as any[];
    for (const call of calls) {
      if (call.toolName !== "_spawnedTask") continue;

      // Check if the spawned conversation has an assistant response
      const assistantMsg = await prisma.message.findFirst({
        where: {
          conversationId: call.spawnedConversationId,
          role: "assistant",
        },
        orderBy: { createdAt: "desc" },
      });

      tasks.push({
        conversationId: call.spawnedConversationId,
        runId: call.runId,
        prompt: call.prompt,
        spawnedAt: call.spawnedAt,
        status: assistantMsg ? "completed" : "running",
        result: assistantMsg?.content?.slice(0, 200) ?? null,
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
