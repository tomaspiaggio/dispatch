// SSE (Server-Sent Events) endpoint — works over regular HTTP, no WebSocket upgrade needed
// This is more compatible with Nitro's dev server
import { Hono } from "hono";
import { streamSSE } from "hono/streaming";

const sse = new Hono();

// In-memory subscriber list
type Subscriber = (data: string) => void;
const subscribers = new Set<Subscriber>();

export function broadcast(event: object) {
  const data = JSON.stringify(event);
  for (const sub of subscribers) {
    try {
      sub(data);
    } catch {
      subscribers.delete(sub);
    }
  }
}

export function broadcastToConversation(
  conversationId: string,
  type: string,
  payload: unknown
) {
  broadcast({ type, conversationId, payload });
}

sse.get("/events", (c) => {
  return streamSSE(c, async (stream) => {
    const send: Subscriber = (data) => {
      stream.writeSSE({ data, event: "message" });
    };
    subscribers.add(send);

    // Keep alive
    const keepAlive = setInterval(() => {
      stream.writeSSE({ data: "", event: "ping" });
    }, 30000);

    // Wait until the client disconnects
    try {
      await new Promise((_, reject) => {
        stream.onAbort(() => reject(new Error("aborted")));
      });
    } catch {
      // Client disconnected
    } finally {
      clearInterval(keepAlive);
      subscribers.delete(send);
    }
  });
});

export default sse;
