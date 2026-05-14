import ChatApp from "@/components/ChatApp";

export default async function ChatPage({ params }: { params: Promise<{ conversationId?: string[] }> }) {
  const resolvedParams = await params;
  return <ChatApp initialConversationId={resolvedParams.conversationId?.[0] || ""} />;
}
