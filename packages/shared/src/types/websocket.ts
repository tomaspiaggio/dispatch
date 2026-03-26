import type { Message, ToolCallRecord } from "./conversation.js";

export type WsEventType =
  | "new_message"
  | "tool_call_start"
  | "tool_call_finish"
  | "workflow_started"
  | "workflow_completed"
  | "workflow_error"
  | "status_update";

export interface WsEvent {
  type: WsEventType;
  conversationId: string;
  payload: unknown;
}

export interface WsNewMessage extends WsEvent {
  type: "new_message";
  payload: Message;
}

export interface WsToolCallStart extends WsEvent {
  type: "tool_call_start";
  payload: { messageId: string; toolCall: ToolCallRecord };
}

export interface WsToolCallFinish extends WsEvent {
  type: "tool_call_finish";
  payload: { messageId: string; toolCall: ToolCallRecord };
}

export interface WsWorkflowStarted extends WsEvent {
  type: "workflow_started";
  payload: { runId: string };
}

export interface WsWorkflowCompleted extends WsEvent {
  type: "workflow_completed";
  payload: { runId: string };
}

export interface WsWorkflowError extends WsEvent {
  type: "workflow_error";
  payload: { runId: string; error: string };
}

export interface WsStatusUpdate extends WsEvent {
  type: "status_update";
  payload: { message: string };
}
