import { prisma } from "../lib/prisma";

export async function sendStatusStep(
  _threadJson: string | null,
  conversationId: string,
  message: string
) {
  "use step";

  // Just log to DB — the chat handler (outside workflow) will post to the chat platform
  await prisma.message.create({
    data: {
      conversationId,
      role: "status",
      content: message,
    },
  });

  return { sent: true };
}
