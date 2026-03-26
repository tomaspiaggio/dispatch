import type { WsEvent } from "@dispatch/shared";

// Re-export from the SSE route for use by steps
// This module acts as a bridge so steps can broadcast without importing the route directly
let _broadcast: ((event: WsEvent) => void) | null = null;

export function setBroadcaster(fn: (event: WsEvent) => void) {
  _broadcast = fn;
}

export function broadcast(event: WsEvent) {
  _broadcast?.(event);
}

export function broadcastToConversation(
  conversationId: string,
  type: WsEvent["type"],
  payload: unknown
) {
  broadcast({ type, conversationId, payload } as WsEvent);
}
