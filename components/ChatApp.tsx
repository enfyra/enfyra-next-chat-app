"use client";

import { FormEvent, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { RefObject } from "react";
import {
  Bell,
  CheckCheck,
  Clock,
  Hash,
  Info,
  LogOut,
  Menu,
  MessageCircle,
  MessageSquarePlus,
  MessageSquareText,
  Search,
  SendHorizontal,
  ShieldCheck,
  Trash2,
  TriangleAlert,
  UserRoundCheck,
  UsersRound,
  X,
} from "lucide-react";
import { io, type Socket } from "socket.io-client";
import {
  createConversation,
  deleteConversationForUser,
  fetchChatItems,
  fetchConversationMembers,
  fetchMessages,
  getMe,
  idOf,
  logout,
  persistMessageFallback,
  sameId,
  searchUsers,
} from "@/lib/enfyra-api";
import { enfyraConfig } from "@/lib/enfyra-config";
import type {
  ChatListItem,
  ChatMessage,
  ChatUser,
  Conversation,
  ConversationMember,
  DeleteConversationScope,
  DraftConversation,
  NewConversationPayload,
  TypingUser,
} from "@/lib/chat-types";

type SocketState = "connecting" | "connected" | "offline" | "failed";
type ConfirmState = {
  open: boolean;
  title: string;
  message: string;
  details?: string;
  optionLabel?: string;
  confirmText: string;
  cancelText: string;
  destructive?: boolean;
  loading?: boolean;
  onConfirm?: (optionChecked: boolean) => Promise<void> | void;
};

const emptyConversation: Conversation = {
  id: "",
  kind: "dm",
  title: "No conversation",
  members: [],
  unreadCount: 0,
};

export default function ChatApp({ initialConversationId }: { initialConversationId: string }) {
  const [user, setUser] = useState<ChatUser | null>(null);
  const [chatItems, setChatItems] = useState<ChatListItem[]>([]);
  const [activeId, setActiveId] = useState(initialConversationId || "");
  const [draftConversation, setDraftConversation] = useState<DraftConversation | null>(null);
  const [lastActiveConversation, setLastActiveConversation] = useState<Conversation | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [query, setQuery] = useState("");
  const [composerText, setComposerText] = useState("");
  const [socketState, setSocketState] = useState<SocketState>("connecting");
  const [reconnectAttempt, setReconnectAttempt] = useState(0);
  const [reconnectCountdown, setReconnectCountdown] = useState(0);
  const [hasConnectionProblem, setHasConnectionProblem] = useState(false);
  const [conversationsOpen, setConversationsOpen] = useState(false);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [newChatOpen, setNewChatOpen] = useState(false);
  const [newMode, setNewMode] = useState<"dm" | "group">("dm");
  const [userResults, setUserResults] = useState<ChatUser[]>([]);
  const [userSearch, setUserSearch] = useState("");
  const [selectedGroupUsers, setSelectedGroupUsers] = useState<ChatUser[]>([]);
  const [typingUsers, setTypingUsers] = useState<TypingUser[]>([]);
  const [onlineUserIds, setOnlineUserIds] = useState<Set<string>>(new Set());
  const [conversationsLoading, setConversationsLoading] = useState(true);
  const [messagesLoading, setMessagesLoading] = useState(false);
  const [olderMessagesLoading, setOlderMessagesLoading] = useState(false);
  const [hasOlderMessages, setHasOlderMessages] = useState(false);
  const [olderCursor, setOlderCursor] = useState<{ id: string; createdAt: string } | null>(null);
  const [creatingChat, setCreatingChat] = useState(false);
  const [confirmState, setConfirmState] = useState<ConfirmState>({
    open: false,
    title: "",
    message: "",
    confirmText: "Confirm",
    cancelText: "Cancel",
  });

  const socketRef = useRef<Socket | null>(null);
  const socketStateRef = useRef<SocketState>(socketState);
  const activeIdRef = useRef(activeId);
  const userRef = useRef<ChatUser | null>(null);
  const chatItemsRef = useRef<ChatListItem[]>([]);
  const messageBoxRef = useRef<HTMLDivElement | null>(null);
  const pendingNew = useRef(new Map<string, (conversationId: string) => void>());
  const typingTimers = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  const presenceTimers = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  const countdownTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  const reconnectTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const presenceHeartbeat = useRef<ReturnType<typeof setInterval> | null>(null);
  const typingHeartbeat = useRef<ReturnType<typeof setInterval> | null>(null);
  const typingActive = useRef(false);
  const disconnecting = useRef(false);
  const preservingOlderScroll = useRef(false);
  const olderScrollSnapshot = useRef({ height: 0, top: 0 });
  const messageScrollSignature = useRef({ conversationId: "", firstId: "", lastId: "", count: 0, loading: false });
  const nearBottomBeforeRender = useRef(true);
  const messageLoadRun = useRef(0);
  const reconnectLimit = 5;

  useEffect(() => {
    socketStateRef.current = socketState;
  }, [socketState]);

  useEffect(() => {
    activeIdRef.current = activeId;
  }, [activeId]);

  useEffect(() => {
    userRef.current = user;
  }, [user]);

  useEffect(() => {
    chatItemsRef.current = chatItems;
    const active = chatItems.find((item) => sameId(item.conversation.id, activeId))?.conversation;
    if (active) setLastActiveConversation(active);
  }, [chatItems, activeId]);

  const activeConversation = useMemo<Conversation>(() => {
    if (draftConversation && activeId === "draft") {
      return {
        id: "draft",
        kind: "dm" as const,
        title: draftConversation.target.displayName,
        members: [
          ...(user ? [{ id: "draft-self", role: "owner" as const, member: user }] : []),
          { id: "draft-target", role: "member" as const, member: draftConversation.target },
        ],
        unreadCount: 0,
      };
    }
    const active = chatItems.find((item) => sameId(item.conversation.id, activeId))?.conversation;
    if (active) return active;
    if (lastActiveConversation?.id === activeId) return lastActiveConversation;
    if (activeId) {
      return {
        ...emptyConversation,
        id: activeId,
        title: conversationsLoading ? "Loading conversation" : "Conversation unavailable",
      };
    }
    return emptyConversation;
  }, [activeId, chatItems, conversationsLoading, draftConversation, lastActiveConversation, user]);

  const filteredItems = useMemo(() => {
    const term = query.trim().toLowerCase();
    if (!term) return chatItems;
    return chatItems.filter(({ conversation, members }) => {
      const memberText = members.map((item) => `${item.displayName} ${item.email}`).join(" ");
      return `${conversation.title} ${conversation.lastMessageText || ""} ${memberText}`.toLowerCase().includes(term);
    });
  }, [chatItems, query]);

  const visibleTypingUsers = typingUsers.filter((item) => item.conversationId === activeConversation.id);
  const typingLabel = visibleTypingUsers.length === 1
    ? `${visibleTypingUsers[0]?.displayName || "Someone"} is typing`
    : visibleTypingUsers.length > 1
      ? `${visibleTypingUsers.length} people are typing`
      : "";
  const realtimeConnected = socketState === "connected";
  const showReconnectBanner = socketState === "failed";
  const connectionStatusLabel = getConnectionStatusLabel(socketState, reconnectAttempt, reconnectLimit, reconnectCountdown);

  async function refreshConversations(silent = false) {
    const currentUser = userRef.current;
    if (!currentUser?.id) {
      setChatItems([]);
      setConversationsLoading(false);
      return;
    }
    if (!silent) setConversationsLoading(true);
    try {
      const items = await fetchChatItems(currentUser.id);
      setChatItems(items);
      if (activeIdRef.current && activeIdRef.current !== "draft" && !items.some((item) => sameId(item.conversation.id, activeIdRef.current))) {
        clearActiveConversation();
        window.history.replaceState(null, "", "/chat");
      }
    } finally {
      if (!silent) setConversationsLoading(false);
    }
  }

  function clearActiveConversation() {
    setActiveId("");
    setDraftConversation(null);
    setMessages([]);
    setHasOlderMessages(false);
    setOlderCursor(null);
    setMessagesLoading(false);
    setOlderMessagesLoading(false);
    setLastActiveConversation(null);
  }

  async function loadMessages(conversationId: string) {
    const runId = ++messageLoadRun.current;
    if (!conversationId || conversationId === "draft") {
      setMessages([]);
      setHasOlderMessages(false);
      setOlderCursor(null);
      return;
    }
    setMessagesLoading(true);
    setMessages([]);
    setHasOlderMessages(false);
    setOlderCursor(null);
    try {
      const result = await fetchMessages(conversationId);
      if (runId !== messageLoadRun.current) return;
      setMessages(result.messages);
      setHasOlderMessages(result.hasOlder);
      setOlderCursor(result.messages[0] ? { id: result.messages[0].id, createdAt: result.messages[0].createdAt } : null);
      scheduleScrollToBottom();
    } finally {
      if (runId === messageLoadRun.current) setMessagesLoading(false);
    }
  }

  async function loadOlderMessages() {
    if (!activeId || activeId === "draft" || !olderCursor || olderMessagesLoading || !hasOlderMessages) return;
    const box = messageBoxRef.current;
    if (box) {
      preservingOlderScroll.current = true;
      olderScrollSnapshot.current = { height: box.scrollHeight, top: box.scrollTop };
    }
    setOlderMessagesLoading(true);
    try {
      const result = await fetchMessages(activeId, olderCursor);
      setMessages((current) => {
        const next = [...result.messages, ...current];
        const oldest = next[0];
        setOlderCursor(oldest ? { id: oldest.id, createdAt: oldest.createdAt } : null);
        return next;
      });
      setHasOlderMessages(result.hasOlder);
    } finally {
      setOlderMessagesLoading(false);
    }
  }

  async function loadActiveMembers(conversationId: string) {
    if (!conversationId || conversationId === "draft") return;
    const members = await fetchConversationMembers(conversationId).catch(() => []);
    if (!members.length) return;
    setChatItems((current) =>
      current.map((item) =>
        sameId(item.conversation.id, conversationId)
          ? { ...item, members: members.map((row) => row.member), conversation: { ...item.conversation, members } }
          : item,
      ),
    );
  }

  function selectConversation(conversationId: string) {
    setActiveId(conversationId);
    setDraftConversation(null);
    setConversationsOpen(false);
    setChatItems((current) => setItemUnread(current, conversationId, false));
    window.history.replaceState(null, "", conversationId ? `/chat/${conversationId}` : "/chat");
    emitRead(conversationId);
  }

  function startDirectMessage(target: ChatUser) {
    const existing = chatItems.find((item) =>
      item.conversation.kind === "dm" &&
      item.members.some((member) => sameId(member.id, target.id)),
    );
    if (existing) {
      selectConversation(existing.conversation.id);
      setNewChatOpen(false);
      return;
    }
    setDraftConversation({ kind: "dm", target });
    setActiveId("draft");
    setMessages([]);
    setHasOlderMessages(false);
    setOlderCursor(null);
    window.history.replaceState(null, "", "/chat");
    setNewChatOpen(false);
    setConversationsOpen(false);
  }

  async function createGroupChat() {
    if (!user?.id || selectedGroupUsers.length < 2 || creatingChat) return;
    setCreatingChat(true);
    try {
      const memberIds = Array.from(new Set(selectedGroupUsers.map((item) => item.id).filter(Boolean)));
      const title = selectedGroupUsers.map((member) => member.displayName || member.email).join(", ");
      const conversationId = await emitNewConversation({ kind: "group", memberIds, title });
      if (conversationId) {
        await refreshConversations(true);
        selectConversation(conversationId);
      } else {
        const fallbackId = await createConversation({ currentUserId: user.id, kind: "group", title, memberIds });
        await refreshConversations(true);
        if (fallbackId) selectConversation(fallbackId);
      }
      setSelectedGroupUsers([]);
      setNewChatOpen(false);
    } finally {
      setCreatingChat(false);
    }
  }

  function upsertMessage(message: ChatMessage) {
    if (!sameId(message.conversationId, activeIdRef.current)) return;
    const shouldStickToBottom = isNearBottom() || sameId(message.sender.id, userRef.current?.id);
    setMessages((current) => {
      const existingIndex = current.findIndex((item) => item.id === message.id);
      if (existingIndex >= 0) {
        return sortMessages(current.map((item, index) => (index === existingIndex ? { ...item, ...message } : item)));
      }
      const pendingIndex = current.findIndex((item) =>
        item.status === "sending" &&
        sameId(item.conversationId, message.conversationId) &&
        sameId(item.sender.id, message.sender.id) &&
        item.text === message.text,
      );
      if (pendingIndex >= 0) {
        return sortMessages(current.map((item, index) => (index === pendingIndex ? message : item)));
      }
      return sortMessages([...current, message]);
    });
    if (shouldStickToBottom) scheduleScrollToBottom();
  }

  function touchConversationPreview(conversationId: string, text: string, createdAt: string) {
    setChatItems((current) => {
      const index = current.findIndex((item) => sameId(item.conversation.id, conversationId));
      if (index < 0) return current;
      const updated = {
        ...current[index],
        conversation: {
          ...current[index].conversation,
          lastMessageText: text,
          lastMessageAt: createdAt,
        },
      };
      return [updated, ...current.slice(0, index), ...current.slice(index + 1)];
    });
  }

  async function sendMessage(event: FormEvent) {
    event.preventDefault();
    const text = composerText.trim();
    if (!text || !user?.id || socketState !== "connected") return;
    let conversationId = activeId;
    const messageId = `next-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const createdAt = new Date().toISOString();
    setComposerText("");

    if (activeId === "draft" && draftConversation) {
      setCreatingChat(true);
      conversationId = await emitNewConversation({
        kind: "dm",
        memberIds: [draftConversation.target.id],
        text,
        messageId,
      });
      setCreatingChat(false);
      if (conversationId) {
        setDraftConversation(null);
        setActiveId(conversationId);
        window.history.replaceState(null, "", `/chat/${conversationId}`);
        await refreshConversations(true);
        return;
      }
      conversationId = await createConversation({
        currentUserId: user.id,
        kind: "dm",
        title: draftConversation.target.displayName,
        memberIds: [draftConversation.target.id],
      });
      setDraftConversation(null);
      setActiveId(conversationId);
      window.history.replaceState(null, "", `/chat/${conversationId}`);
    }

    if (!conversationId) return;
    const optimistic: ChatMessage = { id: messageId, conversationId, sender: user, text, createdAt, status: "sending" };
    upsertMessage(optimistic);
    touchConversationPreview(conversationId, text, createdAt);
    const emitted = emitMessage(text, messageId, conversationId);
    if (!emitted) {
      try {
        await persistMessageFallback(conversationId, user.id, text, createdAt);
        upsertMessage({ ...optimistic, status: "persisted" });
        await refreshConversations(true);
      } catch {
        upsertMessage({ ...optimistic, status: "failed" });
      }
    }
  }

  function connectSocket() {
    if (socketRef.current) return;
    disconnecting.current = false;
    setSocketState("connecting");
    const socket = io(enfyraConfig.websocketNamespace, {
      path: enfyraConfig.websocketPath,
      withCredentials: true,
      reconnection: false,
      transports: ["polling"],
      upgrade: false,
    });
    socketRef.current = socket;

    socket.on("connect", () => {
      setSocketState("connected");
      setHasConnectionProblem(false);
      setReconnectAttempt(0);
      clearReconnectTimer();
      clearCountdown();
      joinConversationRooms();
      startPresenceHeartbeat();
    });
    socket.on("connect_error", scheduleReconnect);
    socket.io.on("error", scheduleReconnect);
    socket.io.on("close", scheduleReconnect);
    socket.on("disconnect", () => {
      stopPresenceHeartbeat();
      if (!disconnecting.current) scheduleReconnect();
    });
    socket.on("chat:message", handleSocketMessage);
    socket.on("chat:message:sent", handleSocketMessage);
    socket.on("chat:new", (payload: any) => {
      const conversationId = idOf(payload?.conversationId);
      if (!conversationId) return;
      const resolve = payload.requestId ? pendingNew.current.get(payload.requestId) : null;
      if (payload.requestId) pendingNew.current.delete(payload.requestId);
      void refreshConversations(true).then(() => {
        if (!resolve && !sameId(conversationId, activeIdRef.current)) {
          setChatItems((current) => setItemUnread(current, conversationId, true));
        }
        joinConversationRooms();
        resolve?.(conversationId);
      });
    });
    socket.on("chat:deleted", (payload: any) => {
      const conversationId = idOf(payload?.conversationId);
      if (!conversationId) return;
      removeConversation(conversationId);
      void refreshConversations(true).then(joinConversationRooms);
    });
    socket.on("chat:read", (payload: any) => {
      const conversationId = idOf(payload?.conversationId);
      if (sameId(payload?.userId, userRef.current?.id) && conversationId) {
        setChatItems((current) => setItemUnread(current, conversationId, false));
      }
    });
    socket.on("chat:typing", handleTyping);
    socket.on("chat:presence", (payload: any) => markPresence(payload?.userId, payload?.isOnline !== false));
    socket.on("chat:presence:state", (payload: any) => {
      for (const item of payload?.users || []) markPresence(item?.userId, item?.isOnline === true);
    });
    socket.on("chat:joined", () => {
      setSocketState("connected");
      startPresenceHeartbeat();
    });
  }

  function disconnectSocket() {
    disconnecting.current = true;
    clearReconnectTimer();
    socketRef.current?.disconnect();
    stopTypingHeartbeat();
    stopPresenceHeartbeat();
    for (const timer of typingTimers.current.values()) clearTimeout(timer);
    for (const timer of presenceTimers.current.values()) clearTimeout(timer);
    typingTimers.current.clear();
    presenceTimers.current.clear();
    setTypingUsers([]);
    setOnlineUserIds(new Set());
    socketRef.current = null;
    setSocketState("offline");
    setHasConnectionProblem(false);
    clearCountdown();
  }

  function scheduleReconnect() {
    const socket = socketRef.current;
    if (!socket || socket.connected || reconnectTimer.current || socketStateRef.current === "failed") return;
    setHasConnectionProblem(true);
    setReconnectAttempt((current) => {
      if (current >= reconnectLimit) {
        setSocketState("failed");
        socketStateRef.current = "failed";
        clearCountdown();
        return current;
      }
      const next = current + 1;
      const delay = Math.min(1000 * 2 ** Math.max(0, next - 1), 10_000);
      setSocketState("connecting");
      socketStateRef.current = "connecting";
      startCountdown(delay);
      reconnectTimer.current = setTimeout(() => {
        reconnectTimer.current = null;
        if (!socketRef.current || socketRef.current.connected) return;
        socketRef.current.connect();
      }, delay);
      return next;
    });
  }

  function retryRealtime() {
    clearReconnectTimer();
    clearCountdown();
    setReconnectAttempt(0);
    setHasConnectionProblem(true);
    setSocketState("connecting");
    socketStateRef.current = "connecting";
    socketRef.current?.connect();
  }

  function startCountdown(ms: number) {
    clearCountdown();
    setReconnectCountdown(Math.max(1, Math.ceil(ms / 1000)));
    countdownTimer.current = setInterval(() => {
      setReconnectCountdown((value) => {
        const next = Math.max(0, value - 1);
        if (next <= 0) clearCountdown();
        return next;
      });
    }, 1000);
  }

  function clearCountdown() {
    if (countdownTimer.current) {
      clearInterval(countdownTimer.current);
      countdownTimer.current = null;
    }
    setReconnectCountdown(0);
  }

  function clearReconnectTimer() {
    if (reconnectTimer.current) {
      clearTimeout(reconnectTimer.current);
      reconnectTimer.current = null;
    }
  }

  function joinConversationRooms() {
    if (!socketRef.current?.connected || !userRef.current?.id) return;
    socketRef.current.emit("chat:join");
  }

  function emitPresence() {
    if (!socketRef.current?.connected || !userRef.current?.id) return false;
    const userIds = Array.from(new Set(getPresenceUserIds().map(idOf).filter(Boolean))).filter((item) => item !== idOf(userRef.current?.id));
    if (!userIds.length) return false;
    socketRef.current.emit("chat:presence", { userIds });
    return true;
  }

  function startPresenceHeartbeat() {
    emitPresence();
    if (!presenceHeartbeat.current) {
      presenceHeartbeat.current = setInterval(emitPresence, 15_000);
    }
  }

  function stopPresenceHeartbeat() {
    if (presenceHeartbeat.current) {
      clearInterval(presenceHeartbeat.current);
      presenceHeartbeat.current = null;
    }
  }

  function emitRead(conversationId = activeIdRef.current) {
    if (!socketRef.current?.connected || !conversationId || conversationId === "draft") return false;
    socketRef.current.emit("chat:read", { conversationId, readAt: new Date().toISOString() });
    return true;
  }

  function emitMessage(text: string, messageId: string, conversationId = activeIdRef.current) {
    if (!socketRef.current?.connected || !conversationId || conversationId === "draft") return false;
    socketRef.current.emit("chat:message", { conversationId, messageId, text });
    return true;
  }

  function emitNewConversation(payload: NewConversationPayload) {
    if (!socketRef.current?.connected) return Promise.resolve("");
    const requestId = `new-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    return new Promise<string>((resolve) => {
      const timer = window.setTimeout(() => {
        pendingNew.current.delete(requestId);
        resolve("");
      }, 8000);
      pendingNew.current.set(requestId, (conversationId) => {
        window.clearTimeout(timer);
        resolve(conversationId);
      });
      socketRef.current?.emit("chat:new", { ...payload, requestId });
    });
  }

  function emitDeleteConversation(conversationId: string, scope: DeleteConversationScope) {
    if (!socketRef.current?.connected || !conversationId) return Promise.resolve(false);
    return new Promise<boolean>((resolve) => {
      const timer = window.setTimeout(() => resolve(false), 8000);
      socketRef.current?.once("chat:deleted:done", (payload: any) => {
        window.clearTimeout(timer);
        resolve(sameId(payload?.conversationId, conversationId));
      });
      socketRef.current?.emit("chat:delete", { conversationId, scope });
    });
  }

  function handleSocketMessage(message: any) {
    const conversationId = idOf(message?.conversationId);
    const text = message?.text || "";
    const createdAt = message?.createdAt || new Date().toISOString();
    if (!conversationId || !message?.id) return;
    if (!hasConversation(conversationId)) {
      void refreshConversations(true).then(() => {
        touchConversationPreview(conversationId, text, createdAt);
        joinConversationRooms();
      });
    }
    upsertMessage({
      id: idOf(message.id),
      conversationId,
      sender: message.sender || userRef.current || { id: "", email: "", displayName: "Unknown user" },
      text,
      createdAt,
      status: "delivered",
    });
    touchConversationPreview(conversationId, text, createdAt);
    if (sameId(conversationId, activeIdRef.current) || sameId(message?.senderId, userRef.current?.id)) {
      setChatItems((current) => setItemUnread(current, conversationId, false));
      emitRead(conversationId);
    } else {
      setChatItems((current) => setItemUnread(current, conversationId, true));
    }
  }

  function handleTyping(payload: any) {
    const conversationId = idOf(payload?.conversationId);
    const sender = payload?.sender;
    const userId = idOf(sender?.id || payload?.senderId);
    if (!conversationId || !userId || sameId(userId, userRef.current?.id)) return;
    if (!payload.isTyping) {
      removeTypingUser(userId);
      return;
    }
    setTypingUsers((current) => [
      ...current.filter((item) => item.userId !== userId),
      { conversationId, userId, displayName: sender?.displayName || sender?.email || "Someone" },
    ]);
    const existingTimer = typingTimers.current.get(userId);
    if (existingTimer) clearTimeout(existingTimer);
    typingTimers.current.set(userId, setTimeout(() => removeTypingUser(userId), 3500));
  }

  function removeTypingUser(userId: string) {
    const timer = typingTimers.current.get(userId);
    if (timer) clearTimeout(timer);
    typingTimers.current.delete(userId);
    setTypingUsers((current) => current.filter((item) => item.userId !== userId));
  }

  function markPresence(userId: string, isOnline: boolean) {
    const normalized = idOf(userId);
    if (!normalized || sameId(normalized, userRef.current?.id)) return;
    const oldTimer = presenceTimers.current.get(normalized);
    if (oldTimer) clearTimeout(oldTimer);
    setOnlineUserIds((current) => {
      const next = new Set(current);
      if (isOnline) next.add(normalized);
      else next.delete(normalized);
      return next;
    });
    if (isOnline) {
      presenceTimers.current.set(
        normalized,
        setTimeout(() => {
          presenceTimers.current.delete(normalized);
          setOnlineUserIds((current) => {
            const next = new Set(current);
            next.delete(normalized);
            return next;
          });
        }, 45_000),
      );
    }
  }

  function emitTyping(isTyping: boolean) {
    if (!isTyping) {
      if (typingActive.current) sendTyping(false);
      stopTypingHeartbeat();
      return;
    }
    typingActive.current = true;
    sendTyping(true);
    if (!typingHeartbeat.current) {
      typingHeartbeat.current = setInterval(() => {
        if (typingActive.current) sendTyping(true);
      }, 1200);
    }
  }

  function sendTyping(isTyping: boolean) {
    if (!socketRef.current?.connected || !activeIdRef.current || activeIdRef.current === "draft") return;
    socketRef.current.emit("chat:typing", { conversationId: activeIdRef.current, isTyping });
  }

  function stopTypingHeartbeat() {
    if (typingHeartbeat.current) {
      clearInterval(typingHeartbeat.current);
      typingHeartbeat.current = null;
    }
    typingActive.current = false;
  }

  function isNearBottom() {
    const box = messageBoxRef.current;
    if (!box) return true;
    return box.scrollHeight - box.scrollTop - box.clientHeight < 96;
  }

  function scrollMessagesToBottom() {
    const box = messageBoxRef.current;
    if (!box) return;
    box.scrollTop = box.scrollHeight;
    nearBottomBeforeRender.current = true;
  }

  function scheduleScrollToBottom() {
    requestAnimationFrame(() => {
      scrollMessagesToBottom();
      requestAnimationFrame(scrollMessagesToBottom);
    });
  }

  function getPresenceUserIds() {
    const ids = new Set<string>();
    for (const item of chatItemsRef.current) {
      for (const member of item.members) ids.add(member.id);
      for (const member of item.conversation.members) ids.add(member.member.id);
    }
    if (draftConversation?.target.id) ids.add(draftConversation.target.id);
    return Array.from(ids);
  }

  function hasConversation(conversationId: string) {
    return chatItemsRef.current.some((item) => sameId(item.conversation.id, conversationId));
  }

  function removeConversation(conversationId: string) {
    setChatItems((current) => current.filter((item) => !sameId(item.conversation.id, conversationId)));
    if (sameId(activeIdRef.current, conversationId)) {
      const next = chatItemsRef.current.find((item) => !sameId(item.conversation.id, conversationId));
      if (next) selectConversation(next.conversation.id);
      else clearActiveConversation();
    }
  }

  async function requestDeleteConversation(scope: DeleteConversationScope) {
    if (!activeConversation.id || !user?.id) return;
    const isGroup = activeConversation.kind === "group";
    const otherMember = activeConversation.members.find((member) => !sameId(member.member.id, user.id))?.member;
    setConfirmState({
      open: true,
      title: isGroup ? "Leave group chat?" : "Delete this chat?",
      message: isGroup ? "This removes you from the group. The group remains available for other members." : "This removes the conversation from your chat list only.",
      details: isGroup ? "When the last member leaves, the group is cleaned up." : undefined,
      optionLabel: isGroup ? undefined : `Also delete for ${otherMember?.displayName || "the other person"}`,
      confirmText: isGroup ? "Leave group" : "Delete",
      cancelText: "Keep chat",
      destructive: true,
      onConfirm: async (optionChecked) => {
        const deleteScope: DeleteConversationScope = optionChecked && !isGroup ? "everyone" : scope;
        const handledBySocket = await emitDeleteConversation(activeConversation.id, deleteScope);
        if (!handledBySocket) {
          await deleteConversationForUser(activeConversation.id, user.id, deleteScope, activeConversation.kind);
          removeConversation(activeConversation.id);
        }
        setDetailsOpen(false);
        await refreshConversations(true);
      },
    });
  }

  function requestLogout() {
    setConfirmState({
      open: true,
      title: "Sign out?",
      message: "This will end the current chat session on this browser.",
      confirmText: "Sign out",
      cancelText: "Stay",
      onConfirm: async () => {
        await logout();
        window.location.href = "/login";
      },
    });
  }

  useEffect(() => {
    let alive = true;
    getMe()
      .then(async (me) => {
        if (!alive) return;
        if (!me?.id) {
          window.location.href = "/login";
          return;
        }
        setUser(me);
        userRef.current = me;
        const items = await fetchChatItems(me.id);
        if (!alive) return;
        setChatItems(items);
        setConversationsLoading(false);
        if (initialConversationId && items.some((item) => sameId(item.conversation.id, initialConversationId))) {
          setActiveId(initialConversationId);
        }
        connectSocket();
      })
      .catch(() => {
        window.location.href = "/login";
      });
    return () => {
      alive = false;
      disconnectSocket();
    };
  }, []);

  useEffect(() => {
    if (activeId === "draft") {
      setMessagesLoading(false);
      return;
    }
    void loadMessages(activeId);
    void loadActiveMembers(activeId);
    if (activeId) emitRead(activeId);
  }, [activeId]);

  useLayoutEffect(() => {
    const box = messageBoxRef.current;
    const current = {
      conversationId: activeId,
      firstId: messages[0]?.id || "",
      lastId: messages.at(-1)?.id || "",
      count: messages.length,
      loading: messagesLoading,
    };
    const previous = messageScrollSignature.current;
    messageScrollSignature.current = current;

    if (!box) return;

    if (preservingOlderScroll.current) {
      box.scrollTop = olderScrollSnapshot.current.top + (box.scrollHeight - olderScrollSnapshot.current.height);
      preservingOlderScroll.current = false;
      nearBottomBeforeRender.current = isNearBottom();
      return;
    }

    const conversationChanged = current.conversationId !== previous.conversationId;
    const finishedLoading = previous.loading && !current.loading;
    const appendedMessage = current.conversationId === previous.conversationId && current.lastId && current.lastId !== previous.lastId;

    if (conversationChanged || finishedLoading || (appendedMessage && nearBottomBeforeRender.current)) {
      scrollMessagesToBottom();
      requestAnimationFrame(scrollMessagesToBottom);
    }

    nearBottomBeforeRender.current = isNearBottom();
  }, [activeId, messages, messagesLoading]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      searchUsers(userSearch, user?.id).then(setUserResults).catch(() => setUserResults([]));
    }, 250);
    return () => window.clearTimeout(timer);
  }, [userSearch, user?.id]);

  return (
    <main className="page-shell chat-page">
      <div className="app-grid-bg" />
      <header className="app-header">
        <div className="chat-header app-shell-container">
          <a className="brand" href="/chat">
            <span className="brand-mark"><MessageSquareText size={19} /></span>
            <span>Enfyra Next Chat</span>
            <span className="brand-powered">Powered by Enfyra</span>
          </a>
          <div className="header-actions">
            <button className="icon-button mobile-conversations-trigger" onClick={() => setConversationsOpen(true)} aria-label="Open conversations">
              <Menu size={18} />
            </button>
            <button className="icon-button header-new-conversation" onClick={() => setNewChatOpen(true)} aria-label="New conversation">
              <MessageSquarePlus size={18} />
            </button>
            <span className={`connection-pill ${socketState}`}>
              <span className={`status-dot ${socketState}`} />
              {connectionStatusLabel}
            </span>
            <a className="text-button docs-link" href="/how-it-works">
              <ShieldCheck size={17} />
              How it works
            </a>
            <button className="icon-button" onClick={requestLogout} aria-label="Logout">
              <LogOut size={18} />
            </button>
          </div>
        </div>
      </header>

      {showReconnectBanner ? (
        <div className="disconnect-banner" role="status" aria-live="polite">
          <div className="disconnect-copy">
            <span className="disconnect-pulse" />
            <p>Realtime connection failed after {reconnectLimit} retries. Chat is disabled until you reconnect.</p>
          </div>
          <button className="disconnect-retry" onClick={retryRealtime}>Retry now</button>
        </div>
      ) : null}

      <section className="chat-shell app-shell-container">
        <div className="desktop-conversation-list">
          <ConversationList
            items={filteredItems}
            activeId={activeId}
            loading={conversationsLoading && chatItems.length === 0}
            currentUserId={user?.id}
            onlineUserIds={onlineUserIds}
            showCreator
            query={query}
            setQuery={setQuery}
            onNew={() => setNewChatOpen(true)}
            onSelect={selectConversation}
          />
        </div>
        <MessageThread
          conversation={activeConversation}
          messages={messages}
          ownUserId={user?.id}
          loading={messagesLoading || (conversationsLoading && activeId !== "draft")}
          loadingOlder={olderMessagesLoading}
          hasOlder={hasOlderMessages}
          composerDisabled={!realtimeConnected}
          composerText={composerText}
          setComposerText={setComposerText}
          typingLabel={typingLabel}
          messageBoxRef={messageBoxRef}
          onMessagesScroll={() => { nearBottomBeforeRender.current = isNearBottom(); }}
          onSend={sendMessage}
          onTyping={emitTyping}
          onLoadOlder={loadOlderMessages}
          onOpenDetails={() => setDetailsOpen(true)}
        />
      </section>

      {conversationsOpen ? (
        <div className="drawer-layer">
          <button className="drawer-scrim" onClick={() => setConversationsOpen(false)} aria-label="Close conversations" />
          <ConversationList
            className="mobile-conversation-drawer"
            items={filteredItems}
            activeId={activeId}
            loading={conversationsLoading && chatItems.length === 0}
            currentUserId={user?.id}
            onlineUserIds={onlineUserIds}
            query={query}
            setQuery={setQuery}
            onNew={() => {
              setNewChatOpen(true);
              setConversationsOpen(false);
            }}
            onSelect={selectConversation}
          />
        </div>
      ) : null}

      {detailsOpen ? (
        <div className="drawer-layer right">
          <button className="drawer-scrim" onClick={() => setDetailsOpen(false)} aria-label="Close details" />
          <aside className="details-drawer panel">
            <header className="drawer-header">
              <div>
                <p className="eyebrow">Conversation data</p>
                <h2>{activeConversation.title}</h2>
                <span>{activeConversation.members.length} members</span>
              </div>
              <button className="icon-button" onClick={() => setDetailsOpen(false)} aria-label="Close details">
                <X size={18} />
              </button>
            </header>
            <MemberPanel conversation={activeConversation} currentUserId={user?.id} onlineUserIds={onlineUserIds} />
            {activeConversation.id ? (
              <button className="drawer-delete" onClick={() => requestDeleteConversation("self")}>
                <Trash2 size={16} />
                {activeConversation.kind === "group" ? "Leave group" : "Delete conversation"}
              </button>
            ) : null}
          </aside>
        </div>
      ) : null}

      {newChatOpen ? (
        <NewConversationModal
          mode={newMode}
          setMode={setNewMode}
          userSearch={userSearch}
          setUserSearch={setUserSearch}
          userResults={userResults}
          selectedGroupUsers={selectedGroupUsers}
          setSelectedGroupUsers={setSelectedGroupUsers}
          creatingChat={creatingChat}
          onClose={() => setNewChatOpen(false)}
          onStartDm={startDirectMessage}
          onCreateGroup={createGroupChat}
        />
      ) : null}

      <ConfirmDialog state={confirmState} setState={setConfirmState} />
    </main>
  );
}

function ConversationList(props: {
  items: ChatListItem[];
  activeId: string;
  loading?: boolean;
  currentUserId?: string;
  onlineUserIds: Set<string>;
  showCreator?: boolean;
  query: string;
  setQuery: (value: string) => void;
  onNew: () => void;
  onSelect: (id: string) => void;
  className?: string;
}) {
  return (
    <aside className={`conversation-list panel ${props.className || ""}`}>
      <div className="list-header">
        <div>
          <p className="eyebrow">My chats</p>
          <h2>Conversations</h2>
        </div>
      </div>
      <label className="search-wrap">
        <Search size={17} />
        <input value={props.query} onChange={(event) => props.setQuery(event.target.value)} placeholder="Search conversations" />
      </label>
      {props.showCreator ? (
        <button className="embedded-new-conversation" onClick={props.onNew}>
          <MessageSquarePlus size={17} />
          New conversation
        </button>
      ) : null}
      <div className="conversation-scroll">
        {props.loading ? <p className="muted">Loading conversations...</p> : null}
        {!props.loading && props.items.map((item) => (
          <button key={item.conversation.id} className={`conversation-row ${sameId(item.conversation.id, props.activeId) ? "active" : ""}`} onClick={() => props.onSelect(item.conversation.id)}>
            <span className="avatar-wrap">
              <span className="avatar">{item.conversation.kind === "group" ? <Hash size={17} /> : <MessageCircle size={17} />}</span>
              {item.members.some((member) => !sameId(member.id, props.currentUserId) && props.onlineUserIds.has(member.id)) ? <span className="online-dot" /> : null}
            </span>
            <span className="row-main">
              <strong>{item.conversation.title}</strong>
              <small>{item.conversation.lastMessageText || "No messages yet"}</small>
            </span>
            {item.conversation.lastMessageAt ? <span className="conversation-time">{formatTime(item.conversation.lastMessageAt)}</span> : null}
            {item.unreadCount ? <span className="unread-dot" /> : null}
          </button>
        ))}
        {!props.loading && props.items.length === 0 ? <p className="empty-state">No conversations match this search.</p> : null}
      </div>
    </aside>
  );
}

function MessageThread(props: {
  conversation: Conversation;
  messages: ChatMessage[];
  ownUserId?: string;
  loading?: boolean;
  loadingOlder?: boolean;
  hasOlder?: boolean;
  composerDisabled?: boolean;
  composerText: string;
  setComposerText: (value: string) => void;
  typingLabel: string;
  messageBoxRef: RefObject<HTMLDivElement | null>;
  onMessagesScroll: () => void;
  onSend: (event: FormEvent) => void;
  onTyping: (isTyping: boolean) => void;
  onLoadOlder: () => void;
  onOpenDetails: () => void;
}) {
  const groups = groupMessages(props.messages, props.ownUserId);
  const hasConversation = Boolean(props.conversation.id);
  return (
    <section className="thread panel">
      <header className="thread-header">
        <div className={`thread-title ${props.typingLabel ? "has-typing" : ""} ${!hasConversation ? "empty" : ""}`}>
          <h1>{props.conversation.title}</h1>
          <p className={`thread-status ${props.typingLabel ? "active" : ""}`}>
            {props.typingLabel ? <><span>{props.typingLabel}</span><span className="typing-dots"><span /><span /><span /></span></> : null}
          </p>
        </div>
        {hasConversation ? (
          <div className="thread-actions">
            {props.conversation.members.length ? <span className="member-count">{props.conversation.members.length} members</span> : null}
            <button className="text-button data-button" onClick={props.onOpenDetails}>
              <Info size={15} />
              Data
            </button>
          </div>
        ) : null}
      </header>
      <div className="rls-banner">
        <MessageCircle size={18} />
        <span>Messages are delivered live and remain available after reload.</span>
      </div>
      <div ref={props.messageBoxRef} className="messages" onScroll={props.onMessagesScroll}>
        {props.loading ? <p className="muted center">Loading messages...</p> : null}
        {!props.loading && !hasConversation ? (
          <div className="thread-empty-state">
            <MessageCircle size={28} />
            <h2>Select a conversation</h2>
            <p>Choose a chat from the conversation list or start a new DM/group.</p>
          </div>
        ) : null}
        {!props.loading && hasConversation ? (
          <>
            {props.hasOlder ? <button className="load-older" disabled={props.loadingOlder} onClick={props.onLoadOlder}>{props.loadingOlder ? "Loading..." : "Load older messages"}</button> : null}
            {groups.map((group) => (
              <div key={group.key} className={`message-group ${group.own ? "own" : ""}`}>
                {!group.own ? <div className="bubble-author">{group.senderName}</div> : null}
                {group.messages.map((message, index) => (
                  <MessageBubble key={message.id} message={message} own={group.own} position={bubblePosition(index, group.messages.length)} showMeta={index === group.messages.length - 1} />
                ))}
              </div>
            ))}
          </>
        ) : null}
      </div>
      <form className="composer" onSubmit={props.onSend}>
        <input
          value={props.composerText}
          onChange={(event) => props.setComposerText(event.target.value)}
          onFocus={() => props.onTyping(true)}
          onBlur={() => props.onTyping(false)}
          placeholder={hasConversation ? "Message this room" : "Select a conversation first"}
          disabled={!hasConversation || props.composerDisabled}
        />
        <button disabled={!hasConversation || props.composerDisabled} aria-label="Send message">
          <SendHorizontal size={18} />
        </button>
      </form>
    </section>
  );
}

function MessageBubble({ message, own, position, showMeta }: { message: ChatMessage; own: boolean; position: string; showMeta: boolean }) {
  const statusIcon = message.status === "sending"
    ? <Clock size={13} />
    : message.status === "failed"
      ? <TriangleAlert size={13} />
      : <CheckCheck size={13} />;

  return (
    <div className={`bubble-wrap ${own ? "own" : ""}`}>
      <div className={`bubble ${own ? "own" : ""} ${position}`}>{message.text}</div>
      {showMeta ? <small className="message-meta">{formatTime(message.createdAt)} {statusIcon}</small> : null}
    </div>
  );
}

function MemberPanel({ conversation, currentUserId, onlineUserIds }: { conversation: Conversation; currentUserId?: string; onlineUserIds: Set<string> }) {
  return (
    <aside className="member-panel">
      <section>
        <p className="eyebrow">Members</p>
        <div className="member-list">
          {conversation.members.map((member) => {
            const online = !sameId(member.member.id, currentUserId) && onlineUserIds.has(member.member.id);
            return (
              <div className="member-row" key={member.id}>
                <span className={`member-avatar ${online ? "online" : ""}`}>{member.member.displayName.slice(0, 1)}</span>
                <span className="member-copy">
                  <strong>{member.member.displayName}</strong>
                  <span>{online ? "online" : member.role} · {member.member.email}</span>
                </span>
              </div>
            );
          })}
        </div>
      </section>
      <section className="boundary">
        <p className="eyebrow">Chat data</p>
        <div className="boundary-list">
          <div className="boundary-row"><span className="boundary-icon"><ShieldCheck size={17} /></span><span>Only members can see this chat</span></div>
          <div className="boundary-row"><span className="boundary-icon"><MessageSquareText size={17} /></span><span>Messages sync across open devices</span></div>
          <div className="boundary-row"><span className="boundary-icon"><Bell size={17} /></span><span>Offline users catch up from history</span></div>
          <div className="boundary-row"><span className="boundary-icon"><UserRoundCheck size={17} /></span><span>People come from Enfyra users</span></div>
        </div>
      </section>
    </aside>
  );
}

function NewConversationModal(props: {
  mode: "dm" | "group";
  setMode: (mode: "dm" | "group") => void;
  userSearch: string;
  setUserSearch: (value: string) => void;
  userResults: ChatUser[];
  selectedGroupUsers: ChatUser[];
  setSelectedGroupUsers: (value: ChatUser[] | ((current: ChatUser[]) => ChatUser[])) => void;
  creatingChat: boolean;
  onClose: () => void;
  onStartDm: (user: ChatUser) => void;
  onCreateGroup: () => void;
}) {
  return (
    <div className="modal-layer">
      <button className="modal-scrim" onClick={props.onClose} aria-label="Close new conversation" />
      <section className="new-chat-modal panel">
        <header>
          <div>
            <p className="eyebrow">Powered by Enfyra users</p>
            <h2>New conversation</h2>
          </div>
          <button className="icon-button" onClick={props.onClose}><X size={18} /></button>
        </header>
        <div className="segmented">
          <button className={props.mode === "dm" ? "active" : ""} onClick={() => props.setMode("dm")}>DM</button>
          <button className={props.mode === "group" ? "active" : ""} onClick={() => props.setMode("group")}>Group</button>
        </div>
        <label className="search-wrap">
          <Search size={17} />
          <input value={props.userSearch} onChange={(event) => props.setUserSearch(event.target.value)} placeholder="Search people" autoFocus />
        </label>
        {props.mode === "group" && props.selectedGroupUsers.length ? (
          <div className="chips">
            {props.selectedGroupUsers.map((member) => (
              <button key={member.id} onClick={() => props.setSelectedGroupUsers((current) => current.filter((item) => item.id !== member.id))}>
                {member.displayName} <X size={13} />
              </button>
            ))}
          </div>
        ) : null}
        <div className="user-results">
          {props.userResults.map((item) => (
            <div className="user-row" key={item.id}>
              <span className="user-avatar">{item.displayName.slice(0, 1).toUpperCase()}</span>
              <span>
                <strong>{item.displayName}</strong>
                <small>{item.email}</small>
              </span>
              {props.mode === "dm" ? (
                <button onClick={() => props.onStartDm(item)}>Message</button>
              ) : (
                <button onClick={() => props.setSelectedGroupUsers((current) => current.some((member) => member.id === item.id) ? current : [...current, item])}>Add</button>
              )}
            </div>
          ))}
        </div>
        {props.mode === "group" ? (
          <button className="primary-button full" disabled={props.selectedGroupUsers.length < 2 || props.creatingChat} onClick={props.onCreateGroup}>
            <UsersRound size={17} />
            {props.creatingChat ? "Creating..." : "Create group"}
          </button>
        ) : null}
      </section>
    </div>
  );
}

function ConfirmDialog({ state, setState }: { state: ConfirmState; setState: (value: ConfirmState | ((current: ConfirmState) => ConfirmState)) => void }) {
  const [optionChecked, setOptionChecked] = useState(false);
  if (!state.open) return null;
  return (
    <div className="modal-layer confirm-layer">
      <button className="modal-scrim" onClick={() => setState((current) => ({ ...current, open: false }))} aria-label="Cancel" />
      <section className="confirm-modal panel">
        <h2>{state.title}</h2>
        <p>{state.message}</p>
        {state.details ? <small>{state.details}</small> : null}
        {state.optionLabel ? (
          <label className="confirm-option">
            <input type="checkbox" checked={optionChecked} onChange={(event) => setOptionChecked(event.target.checked)} />
            {state.optionLabel}
          </label>
        ) : null}
        <div className="confirm-actions">
          <button className="text-button" disabled={state.loading} onClick={() => setState((current) => ({ ...current, open: false }))}>{state.cancelText}</button>
          <button
            className={`primary-button ${state.destructive ? "danger" : ""}`}
            disabled={state.loading}
            onClick={async () => {
              setState((current) => ({ ...current, loading: true }));
              try {
                await state.onConfirm?.(optionChecked);
                setState((current) => ({ ...current, open: false, loading: false }));
              } catch {
                setState((current) => ({ ...current, loading: false }));
              }
            }}
          >
            {state.loading ? "Working..." : state.confirmText}
          </button>
        </div>
      </section>
    </div>
  );
}

function sortMessages(messages: ChatMessage[]) {
  return [...messages].sort((a, b) => (a.createdAt || "").localeCompare(b.createdAt || "") || (a.id || "").localeCompare(b.id || ""));
}

function setItemUnread(items: ChatListItem[], conversationId: string, unread: boolean) {
  const unreadCount = unread ? 1 : 0;
  return items.map((item) =>
    sameId(item.conversation.id, conversationId)
      ? { ...item, unreadCount, conversation: { ...item.conversation, unreadCount } }
      : item,
  );
}

function groupMessages(messages: ChatMessage[], ownUserId?: string) {
  const groups: Array<{ key: string; senderId: string; senderName: string; own: boolean; messages: ChatMessage[] }> = [];
  for (const message of messages) {
    const senderId = message.sender.id;
    const own = sameId(senderId, ownUserId);
    const previous = groups.at(-1);
    if (previous && previous.senderId === senderId) {
      previous.messages.push(message);
      continue;
    }
    groups.push({
      key: `${senderId}-${message.id}`,
      senderId,
      senderName: message.sender.displayName || message.sender.email || "Someone",
      own,
      messages: [message],
    });
  }
  return groups;
}

function bubblePosition(index: number, total: number) {
  if (total === 1) return "single";
  if (index === 0) return "first";
  if (index === total - 1) return "last";
  return "middle";
}

function getConnectionStatusLabel(state: SocketState, attempt: number, limit: number, countdown: number) {
  if (state === "connected") return "Realtime · connected";
  if (state === "failed") return `Realtime · failed · retry ${attempt}/${limit}`;
  if (state === "offline") return "Realtime · offline";
  const retry = attempt ? ` · retry ${attempt}/${limit}` : "";
  const timer = countdown ? ` · ${countdown}s` : "";
  return `Realtime · connecting${retry}${timer}`;
}

function formatTime(value: string) {
  return new Intl.DateTimeFormat("en", { hour: "2-digit", minute: "2-digit" }).format(new Date(value));
}
