const BASE = "/api";

export async function getConversations() {
  const res = await fetch(`${BASE}/conversations`);
  return res.json();
}

export async function getConversation(id: string) {
  const res = await fetch(`${BASE}/conversations/${id}`);
  return res.json();
}

export async function sendMessage(content: string, conversationId?: string) {
  const res = await fetch(`${BASE}/messages`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ content, conversationId }),
  });
  return res.json();
}

export async function getStats() {
  const res = await fetch(`${BASE}/stats`);
  return res.json();
}

export async function getMemories() {
  const res = await fetch(`${BASE}/memories`);
  return res.json();
}

export async function addMemory(content: string) {
  const res = await fetch(`${BASE}/memories`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ content }),
  });
  return res.json();
}

export async function deleteMemory(id: string) {
  await fetch(`${BASE}/memories/${id}`, { method: "DELETE" });
}

export async function getSoul() {
  const res = await fetch(`${BASE}/soul`);
  return res.json();
}

export async function updateSoul(key: string, value: string) {
  const res = await fetch(`${BASE}/soul/${key}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ value }),
  });
  return res.json();
}

export async function getSchedules() {
  const res = await fetch(`${BASE}/schedules`);
  return res.json();
}
