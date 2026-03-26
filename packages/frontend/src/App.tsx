import React, { useState, useEffect, useCallback } from "react";
import { Box, Text, useApp, useInput, useStdout } from "ink";
import TextInput from "ink-text-input";
import Spinner from "ink-spinner";
import { getConversations, getConversation, sendMessage } from "./api.js";
import type { Message, Conversation } from "@dispatch/shared";

// Format timestamp
function ts(dateStr: string) {
  return new Date(dateStr).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });
}

// Render a single message
function MessageLine({ msg }: { msg: Message }) {
  if (msg.role === "status") {
    return (
      <Text dimColor italic>
        {"  "}⏳ {msg.content} <Text dimColor>({ts(msg.createdAt)})</Text>
      </Text>
    );
  }

  if (msg.role === "tool") {
    const calls = Array.isArray(msg.toolCalls) ? msg.toolCalls : [];
    if (calls.length === 0) return null;
    return (
      <Box flexDirection="column">
        {calls.map((tc: any, i: number) => (
          <Text key={i} dimColor>
            {"  "}🔧 {tc.name ?? tc.toolName}({JSON.stringify(tc.args ?? tc.input ?? {}).slice(0, 80)})
            {tc.status === "error" ? " ❌" : " ✓"}
          </Text>
        ))}
      </Box>
    );
  }

  const isUser = msg.role === "user";
  const tokens = msg.tokensUsed as any;
  const tokenStr = tokens?.total ? ` [${tokens.total}tok]` : "";

  return (
    <Box flexDirection="column">
      <Box>
        <Text bold color={isUser ? "cyan" : "green"}>
          {isUser ? "You" : "Dispatch"}
        </Text>
        <Text dimColor> {ts(msg.createdAt)}{tokenStr}</Text>
      </Box>
      <Text wrap="wrap">{"  "}{msg.content ?? ""}</Text>
    </Box>
  );
}

// Conversation list sidebar
function ConversationList({
  conversations,
  selected,
  onSelect,
}: {
  conversations: Conversation[];
  selected: string | null;
  onSelect: (id: string) => void;
}) {
  if (conversations.length === 0) {
    return <Text dimColor>No conversations yet</Text>;
  }

  return (
    <Box flexDirection="column">
      {conversations.slice(0, 15).map((c) => {
        const active = c.id === selected;
        const icon = c.platform === "telegram" ? "@" : c.platform === "slack" ? "#" : ">";
        const label = c.title ?? `${c.platform}`;
        return (
          <Text
            key={c.id}
            bold={active}
            color={active ? "cyan" : undefined}
            dimColor={!active}
          >
            {active ? "▸" : " "} {icon} {label}
          </Text>
        );
      })}
    </Box>
  );
}

export default function App() {
  const { exit } = useApp();
  const { stdout } = useStdout();
  const termHeight = stdout?.rows ?? 24;

  const [mode, setMode] = useState<"chat" | "list">("chat");
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [listIdx, setListIdx] = useState(0);

  // Load conversations
  const loadConversations = useCallback(async () => {
    try {
      const data = await getConversations();
      setConversations(data.conversations ?? []);
    } catch {}
  }, []);

  // Load messages for current conversation
  const loadMessages = useCallback(async () => {
    if (!conversationId) return;
    try {
      const data = await getConversation(conversationId);
      setMessages(data.messages ?? []);
    } catch {}
  }, [conversationId]);

  // Initial load + polling
  useEffect(() => {
    loadConversations();
    const i = setInterval(loadConversations, 5000);
    return () => clearInterval(i);
  }, [loadConversations]);

  useEffect(() => {
    loadMessages();
    const i = setInterval(loadMessages, 2000);
    return () => clearInterval(i);
  }, [loadMessages]);

  // Handle sending
  const handleSubmit = useCallback(
    async (value: string) => {
      const text = value.trim();
      if (!text) return;

      // Commands
      if (text === "/quit" || text === "/exit") {
        exit();
        return;
      }
      if (text === "/new") {
        setConversationId(null);
        setMessages([]);
        setInput("");
        return;
      }
      if (text === "/list") {
        setMode("list");
        setInput("");
        return;
      }

      setSending(true);
      setInput("");
      try {
        const result = await sendMessage(text, conversationId ?? undefined);
        if (!conversationId) {
          setConversationId(result.conversationId);
        }
      } catch (err: any) {
        setMessages((prev) => [
          ...prev,
          {
            id: crypto.randomUUID(),
            conversationId: conversationId ?? "",
            role: "status",
            content: `Error: ${err.message}`,
            toolCalls: [],
            thinking: null,
            tokensUsed: null,
            createdAt: new Date().toISOString(),
          },
        ]);
      } finally {
        setSending(false);
      }
    },
    [conversationId, exit]
  );

  // Keyboard shortcuts
  useInput((ch, key) => {
    if (key.ctrl && ch === "c") {
      exit();
      return;
    }

    if (mode === "list") {
      if (key.upArrow) setListIdx((i) => Math.max(0, i - 1));
      if (key.downArrow) setListIdx((i) => Math.min(conversations.length - 1, i + 1));
      if (key.return) {
        const c = conversations[listIdx];
        if (c) {
          setConversationId(c.id);
          setMode("chat");
        }
      }
      if (key.escape) setMode("chat");
    }
  });

  // List mode
  if (mode === "list") {
    return (
      <Box flexDirection="column" height={termHeight}>
        <Box borderStyle="single" borderColor="cyan" paddingX={1}>
          <Text bold color="cyan">Dispatch</Text>
          <Text dimColor> — conversations (↑↓ select, Enter open, Esc back)</Text>
        </Box>
        <Box flexDirection="column" paddingX={1} flexGrow={1}>
          {conversations.length === 0 ? (
            <Text dimColor>No conversations yet. Start typing!</Text>
          ) : (
            conversations.slice(0, termHeight - 4).map((c, i) => {
              const active = i === listIdx;
              const icon = c.platform === "telegram" ? "@" : c.platform === "slack" ? "#" : ">";
              return (
                <Text key={c.id} bold={active} color={active ? "cyan" : undefined} dimColor={!active}>
                  {active ? "▸ " : "  "}{icon} {c.title ?? c.platform} — {c.channelId?.slice(0, 12)}
                </Text>
              );
            })
          )}
        </Box>
      </Box>
    );
  }

  // Chat mode
  const visibleMessages = messages.slice(-(termHeight - 6));

  return (
    <Box flexDirection="column" height={termHeight}>
      {/* Header */}
      <Box borderStyle="single" borderColor="cyan" paddingX={1} justifyContent="space-between">
        <Box>
          <Text bold color="cyan">Dispatch</Text>
          {conversationId ? (
            <Text dimColor> — {conversations.find((c) => c.id === conversationId)?.platform ?? "web"}</Text>
          ) : (
            <Text dimColor> — new conversation</Text>
          )}
        </Box>
        <Text dimColor>{messages.length} msgs | /list /new /quit</Text>
      </Box>

      {/* Messages */}
      <Box flexDirection="column" flexGrow={1} paddingX={1} overflowY="hidden">
        {visibleMessages.length === 0 && !sending && (
          <Box flexGrow={1} justifyContent="center" alignItems="center">
            <Text dimColor>Start typing to chat with Dispatch</Text>
          </Box>
        )}
        {visibleMessages.map((msg) => (
          <MessageLine key={msg.id} msg={msg} />
        ))}
        {sending && (
          <Text dimColor>
            {"  "}<Spinner type="dots" /> Thinking...
          </Text>
        )}
      </Box>

      {/* Input */}
      <Box borderStyle="single" borderColor={sending ? "yellow" : "white"} paddingX={1}>
        <Text bold color="cyan">{">"} </Text>
        <TextInput
          value={input}
          onChange={setInput}
          onSubmit={handleSubmit}
          placeholder="Send a message..."
        />
      </Box>
    </Box>
  );
}
