export async function respondStep(
  _threadJson: string | null,
  _conversationId: string,
  message: string
) {
  "use step";

  // This is a no-op now — the message content is captured by the workflow
  // as a tool result, and the final response is logged by logMessageStep.
  // The chat handler polls DB and posts to the chat platform.
  return { sent: true, message };
}
