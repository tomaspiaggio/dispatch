import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  useCallback,
  type ReactNode,
} from "react";
import type { WsEvent } from "@dispatch/shared";

interface WebSocketContextType {
  lastEvent: WsEvent | null;
  isConnected: boolean;
  subscribe: (conversationId: string, callback: (event: WsEvent) => void) => () => void;
}

const WebSocketContext = createContext<WebSocketContextType>({
  lastEvent: null,
  isConnected: false,
  subscribe: () => () => {},
});

export function WebSocketProvider({ children }: { children: ReactNode }) {
  const [isConnected, setIsConnected] = useState(false);
  const [lastEvent, setLastEvent] = useState<WsEvent | null>(null);
  const subscribersRef = useRef<Map<string, Set<(event: WsEvent) => void>>>(new Map());
  const eventSourceRef = useRef<EventSource | null>(null);

  useEffect(() => {
    function connect() {
      const es = new EventSource("/sse/events");

      es.onopen = () => setIsConnected(true);
      es.onerror = () => {
        setIsConnected(false);
        es.close();
        // Reconnect after 2 seconds
        setTimeout(connect, 2000);
      };

      es.addEventListener("message", (event) => {
        if (!event.data) return;
        try {
          const data = JSON.parse(event.data) as WsEvent;
          setLastEvent(data);

          // Notify subscribers for this conversation
          const subs = subscribersRef.current.get(data.conversationId);
          if (subs) {
            for (const cb of subs) cb(data);
          }
          // Also notify "all" subscribers
          const allSubs = subscribersRef.current.get("*");
          if (allSubs) {
            for (const cb of allSubs) cb(data);
          }
        } catch {
          // Ignore invalid messages
        }
      });

      eventSourceRef.current = es;
    }

    connect();
    return () => eventSourceRef.current?.close();
  }, []);

  const subscribe = useCallback(
    (conversationId: string, callback: (event: WsEvent) => void) => {
      if (!subscribersRef.current.has(conversationId)) {
        subscribersRef.current.set(conversationId, new Set());
      }
      subscribersRef.current.get(conversationId)!.add(callback);

      return () => {
        subscribersRef.current.get(conversationId)?.delete(callback);
      };
    },
    []
  );

  return (
    <WebSocketContext.Provider value={{ lastEvent, isConnected, subscribe }}>
      {children}
    </WebSocketContext.Provider>
  );
}

export function useWebSocket() {
  return useContext(WebSocketContext);
}
