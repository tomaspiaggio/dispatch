import { useEffect, useRef, useState, useCallback } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { getConversation, sendMessage } from "@/lib/api";
import { useWebSocket } from "@/lib/websocket";
import MessageBubble from "./MessageBubble";
import MessageInput from "./MessageInput";
import type { Message, Conversation } from "@dispatch/shared";
import { Loader2 } from "lucide-react";

export default function ChatView() {
  const { conversationId } = useParams();
  const navigate = useNavigate();
  const [conversation, setConversation] = useState<Conversation | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(false);
  const [sending, setSending] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const { subscribe } = useWebSocket();

  // Load conversation
  useEffect(() => {
    if (!conversationId) {
      setConversation(null);
      setMessages([]);
      return;
    }

    setLoading(true);
    getConversation(conversationId)
      .then((data) => {
        if (data.conversation) {
          setConversation(data.conversation);
          setMessages(data.messages ?? []);
        }
      })
      .finally(() => setLoading(false));
  }, [conversationId]);

  // Poll for updates every 3 seconds (SSE is best-effort, polling is the fallback)
  useEffect(() => {
    if (!conversationId) return;

    const interval = setInterval(() => {
      getConversation(conversationId).then((data) => {
        if (data.conversation) {
          setConversation(data.conversation);
          setMessages((prev) => {
            const newMessages = data.messages ?? [];
            // Only update if message count changed
            if (newMessages.length !== prev.length) {
              return newMessages;
            }
            return prev;
          });
        }
      }).catch(() => {});
    }, 3000);

    return () => clearInterval(interval);
  }, [conversationId]);

  // Subscribe to real-time SSE updates
  useEffect(() => {
    if (!conversationId) return;

    return subscribe(conversationId, (event) => {
      if (event.type === "new_message" || event.type === "status_update") {
        // Refresh from API to get the full message with all fields
        getConversation(conversationId).then((data) => {
          if (data.messages) {
            setMessages(data.messages);
          }
        }).catch(() => {});
      }
    });
  }, [conversationId, subscribe]);

  // Auto-scroll
  useEffect(() => {
    scrollRef.current?.scrollTo({
      top: scrollRef.current.scrollHeight,
      behavior: "smooth",
    });
  }, [messages]);

  const handleSend = useCallback(
    async (content: string) => {
      setSending(true);

      // Handle /new command — start fresh conversation
      if (content.trim().toLowerCase() === "/new") {
        navigate("/chat");
        setSending(false);
        return;
      }

      try {
        const result = await sendMessage(content, conversationId || undefined);
        const targetId = result.conversationId;
        if (!conversationId) {
          navigate(`/chat/${targetId}`, { replace: true });
        } else {
          setMessages((prev) => [
            ...prev,
            {
              id: crypto.randomUUID(),
              conversationId: targetId,
              role: "user" as const,
              content,
              toolCalls: [],
              thinking: null,
              tokensUsed: null,
              createdAt: new Date().toISOString(),
            },
          ]);
        }
      } finally {
        setSending(false);
      }
    },
    [conversationId, navigate]
  );

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <Loader2 className="animate-spin text-muted-foreground" size={24} />
      </div>
    );
  }

  if (!conversationId) {
    return (
      <div className="flex-1 flex flex-col">
        <div className="flex-1 flex items-center justify-center text-muted-foreground">
          <div className="text-center">
            <p className="text-2xl mb-2">Dispatch</p>
            <p className="text-sm">Start a new conversation</p>
          </div>
        </div>
        <MessageInput onSend={handleSend} disabled={sending} />
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col">
      {/* Header */}
      <div className="px-4 py-3 border-b border-border flex items-center gap-2">
        <span className="font-medium text-sm">
          {conversation?.title ??
            `${conversation?.platform ?? "web"} - ${conversation?.channelId ?? ""}`}
        </span>
        <span className="text-xs text-muted-foreground">
          {messages.length} messages
        </span>
      </div>

      {/* Messages */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto py-4 space-y-1">
        {messages.map((msg) => (
          <MessageBubble key={msg.id} message={msg} />
        ))}
        {sending && (
          <div className="flex items-center gap-2 px-4 py-2 text-sm text-muted-foreground">
            <Loader2 className="animate-spin" size={14} />
            <span>Thinking...</span>
          </div>
        )}
      </div>

      {/* Input */}
      <MessageInput onSend={handleSend} disabled={sending} />
    </div>
  );
}
