import Sidebar from "@/components/layout/Sidebar";
import ChatView from "@/components/chat/ChatView";

export default function ChatPage() {
  return (
    <div className="h-screen flex">
      <Sidebar />
      <ChatView />
    </div>
  );
}
