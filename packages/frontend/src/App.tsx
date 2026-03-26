import { Routes, Route, Navigate } from "react-router-dom";
import { WebSocketProvider } from "./lib/websocket";
import ChatPage from "./pages/ChatPage";

export default function App() {
  return (
    <WebSocketProvider>
      <Routes>
        <Route path="/" element={<Navigate to="/chat" replace />} />
        <Route path="/chat" element={<ChatPage />} />
        <Route path="/chat/:conversationId" element={<ChatPage />} />
      </Routes>
    </WebSocketProvider>
  );
}
