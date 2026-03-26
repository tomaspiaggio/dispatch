// Standalone thread poster — does NOT import bot.ts to avoid pulling
// chat-sdk Node.js modules into the workflow bundle.
// Instead, uses a registered callback set by the main process.

let _postFn: ((threadJson: string, message: string) => Promise<void>) | null = null;

export function registerThreadPoster(
  fn: (threadJson: string, message: string) => Promise<void>
) {
  _postFn = fn;
}

export async function postToThread(threadJson: string, message: string) {
  if (!_postFn) {
    console.warn("Thread poster not registered, skipping chat post");
    return;
  }
  try {
    await _postFn(threadJson, message);
  } catch (err) {
    console.error("Failed to post to thread:", err);
  }
}
