import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { getConversations } from "@/lib/api";
import { useWebSocket } from "@/lib/websocket";
import { formatDate, platformIcon } from "@/lib/utils";
import type { Conversation } from "@dispatch/shared";
import { MessageSquare, Plus } from "lucide-react";

export default function Sidebar() {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const { conversationId } = useParams();
  const navigate = useNavigate();
  const { subscribe } = useWebSocket();

  // Load + poll conversation list every 5s
  useEffect(() => {
    const load = () =>
      getConversations()
        .then((data) => setConversations(data.conversations))
        .catch(() => {});
    load();
    const interval = setInterval(load, 5000);
    return () => clearInterval(interval);
  }, []);

  return (
    <div className="w-72 h-full bg-card border-r border-border flex flex-col">
      <div className="p-4 border-b border-border flex items-center justify-between">
        <h1 className="text-lg font-semibold">Dispatch</h1>
        <button
          onClick={() => navigate("/chat")}
          className="p-2 rounded-md hover:bg-accent transition-colors"
          title="New chat"
        >
          <Plus size={18} />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto">
        {conversations.length === 0 && (
          <div className="p-4 text-muted-foreground text-sm text-center">
            No conversations yet
          </div>
        )}
        {conversations.map((conv) => (
          <button
            key={conv.id}
            onClick={() => navigate(`/chat/${conv.id}`)}
            className={`w-full text-left p-3 border-b border-border/50 hover:bg-accent transition-colors ${
              conversationId === conv.id ? "bg-accent" : ""
            }`}
          >
            <div className="flex items-center gap-2">
              <span className="text-muted-foreground text-xs font-mono">
                {platformIcon(conv.platform)}
              </span>
              <span className="text-sm truncate flex-1">
                {conv.title ?? `${conv.platform} - ${conv.channelId}`}
              </span>
            </div>
            <div className="text-xs text-muted-foreground mt-1">
              {formatDate(conv.updatedAt)}
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}
