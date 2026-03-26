import type { Message } from "@dispatch/shared";
import { formatTime } from "@/lib/utils";
import ToolCallCard from "./ToolCallCard";
import ThinkingBlock from "./ThinkingBlock";
import TokenBadge from "./TokenBadge";
import { Bot, User, Info } from "lucide-react";

interface Props {
  message: Message;
}

export default function MessageBubble({ message }: Props) {
  const isUser = message.role === "user";
  const isStatus = message.role === "status";
  const isAssistant = message.role === "assistant";
  const isTool = message.role === "tool";

  if (isStatus) {
    return (
      <div className="flex items-center gap-2 py-1 px-4 text-sm text-muted-foreground italic">
        <Info size={14} />
        <span>{message.content}</span>
        <span className="text-xs">{formatTime(message.createdAt)}</span>
      </div>
    );
  }

  if (isTool && message.toolCalls && Array.isArray(message.toolCalls)) {
    return (
      <div className="px-4 py-2 space-y-2">
        {(message.toolCalls as any[]).map((tc, i) => (
          <ToolCallCard key={tc.id ?? i} toolCall={tc} />
        ))}
      </div>
    );
  }

  return (
    <div
      className={`flex gap-3 px-4 py-3 ${isUser ? "flex-row-reverse" : ""}`}
    >
      <div
        className={`flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center ${
          isUser ? "bg-primary" : "bg-accent"
        }`}
      >
        {isUser ? <User size={16} /> : <Bot size={16} />}
      </div>

      <div className={`flex-1 max-w-[80%] ${isUser ? "text-right" : ""}`}>
        <div
          className={`inline-block rounded-lg px-4 py-2 ${
            isUser
              ? "bg-primary text-primary-foreground"
              : "bg-card border border-border"
          }`}
        >
          {message.thinking && <ThinkingBlock thinking={message.thinking} />}
          <p className="whitespace-pre-wrap text-sm">
            {message.content}
          </p>
        </div>

        <div className="flex items-center gap-2 mt-1 text-xs text-muted-foreground">
          <span>{formatTime(message.createdAt)}</span>
          {message.tokensUsed && <TokenBadge tokens={message.tokensUsed} />}
        </div>
      </div>
    </div>
  );
}
