export async function spawnTaskStep(
  prompt: string,
  platform: string,
  channelId: string,
) {
  "use step";

  const { executePromptAndDeliver } = await import("../chat/deliver");
  const result = await executePromptAndDeliver(prompt, platform, channelId);

  return {
    spawned: true,
    conversationId: result.conversationId,
    runId: result.runId,
    message: `Task spawned in a separate conversation. It will deliver the result to ${platform}/${channelId} when done.`,
  };
}
