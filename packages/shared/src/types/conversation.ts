export type Platform = "slack" | "telegram" | "web";

export interface Conversation {
  id: string;
  platform: Platform;
  channelId: string;
  threadId: string | null;
  title: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ToolCallRecord {
  id: string;
  name: string;
  args: Record<string, unknown>;
  result: unknown;
  status: "pending" | "success" | "error";
  durationMs: number | null;
  createdAt: string;
}

export interface Message {
  id: string;
  conversationId: string;
  role: "user" | "assistant" | "tool" | "status";
  content: string | null;
  toolCalls: ToolCallRecord[];
  thinking: string | null;
  tokensUsed: TokenUsage | null;
  createdAt: string;
}

export interface TokenUsage {
  prompt: number;
  completion: number;
  total: number;
}

export interface MemoryEntry {
  id: string;
  content: string;
  addedBy: "user" | "agent";
  active: boolean;
  createdAt: string;
}

export interface SoulEntry {
  id: string;
  key: string;
  value: string;
  updatedAt: string;
  createdAt: string;
}

export interface Schedule {
  id: string;
  name: string;
  prompt: string;
  cronExpression: string | null;
  platform: Platform;
  channelId: string;
  status: "active" | "paused" | "completed";
  nextRun: string | null;
  lastRun: string | null;
  createdAt: string;
}
