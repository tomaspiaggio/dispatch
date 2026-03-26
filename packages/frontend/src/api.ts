const BASE = process.env.DISPATCH_API_URL ?? "http://localhost:3000";

async function fetchJson(path: string, init?: RequestInit) {
  const res = await fetch(`${BASE}${path}`, init);
  if (!res.ok) throw new Error(`API ${res.status}: ${await res.text()}`);
  return res.json();
}

export async function getConversations() {
  return fetchJson("/api/conversations");
}

export async function getConversation(id: string) {
  return fetchJson(`/api/conversations/${id}`);
}

export async function sendMessage(content: string, conversationId?: string) {
  return fetchJson("/api/messages", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ content, conversationId }),
  });
}

export async function getStats() {
  return fetchJson("/api/stats");
}

export async function getMemories() {
  return fetchJson("/api/memories");
}

export async function getSoul() {
  return fetchJson("/api/soul");
}
