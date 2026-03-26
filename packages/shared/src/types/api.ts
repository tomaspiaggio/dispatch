import type { Conversation, Message, MemoryEntry, SoulEntry, Schedule, TokenUsage } from "./conversation.js";

export interface ListConversationsResponse {
  conversations: Conversation[];
}

export interface GetConversationResponse {
  conversation: Conversation;
  messages: Message[];
}

export interface SendMessageRequest {
  content: string;
  conversationId?: string;
}

export interface SendMessageResponse {
  conversationId: string;
  runId: string;
}

export interface StatsResponse {
  totalConversations: number;
  totalMessages: number;
  totalTokens: TokenUsage;
}

export interface ListMemoriesResponse {
  memories: MemoryEntry[];
}

export interface ListSoulResponse {
  soul: SoulEntry[];
}

export interface ListSchedulesResponse {
  schedules: Schedule[];
}
