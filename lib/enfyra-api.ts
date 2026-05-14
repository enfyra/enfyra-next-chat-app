import type {
  ChatListItem,
  ChatMessage,
  ChatUser,
  Conversation,
  ConversationMember,
  DeleteConversationScope,
} from "./chat-types";

const LOAD_ALL_LIMIT = 0;
export const MESSAGE_PAGE_SIZE = 20;

type FetchOptions = RequestInit & {
  query?: Record<string, string | number | boolean | undefined>;
};

export async function enfyraFetch<T>(path: string, options: FetchOptions = {}): Promise<T> {
  const url = new URL(`/enfyra${path}`, window.location.origin);
  for (const [key, value] of Object.entries(options.query || {})) {
    if (value !== undefined) url.searchParams.set(key, String(value));
  }

  const response = await fetch(url, {
    ...options,
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      ...options.headers,
    },
  });

  if (!response.ok) {
    if (response.status === 401) window.location.href = "/login";
    const message = await response.text().catch(() => response.statusText);
    throw new Error(message || response.statusText);
  }

  const text = await response.text();
  return (text ? JSON.parse(text) : null) as T;
}

export function rowsOf<T>(response: any): T[] {
  if (Array.isArray(response)) return response;
  if (Array.isArray(response?.data)) return response.data;
  return [];
}

export function firstRowOf<T>(response: any): T | null {
  return rowsOf<T>(response)[0] || response?.data || response || null;
}

export function filterCountOf(response: any): number | null {
  return typeof response?.meta?.filterCount === "number" ? response.meta.filterCount : null;
}

export function idOf(value: unknown): string {
  return value == null ? "" : `${value}`;
}

export function sameId(left: unknown, right: unknown): boolean {
  return left != null && right != null && `${left}` === `${right}`;
}

export function mapUser(value: any): ChatUser {
  return {
    id: idOf(value?.id),
    email: value?.email || "",
    displayName: value?.displayName || value?.email || "Unknown user",
    avatarUrl: value?.avatarUrl || null,
    statusText: value?.statusText || null,
    lastSeenAt: value?.lastSeenAt || value?.updatedAt || null,
  };
}

export function mapMember(value: any): ConversationMember {
  return {
    id: idOf(value?.id),
    role: value?.role === "owner" ? "owner" : "member",
    member: mapUser(value?.member || {}),
    lastReadAt: value?.lastReadAt || null,
  };
}

export function mapConversation(value: any, members: ConversationMember[] = []): Conversation {
  const conversationId = idOf(value?.id);
  const lastMessage = value?.lastMessage?.id ? mapMessage(value.lastMessage, conversationId) : null;
  return {
    id: conversationId,
    kind: value?.kind === "group" ? "group" : "dm",
    title: value?.title || "Untitled chat",
    description: value?.description || null,
    members,
    lastMessage,
    lastMessageText: lastMessage?.text || null,
    lastMessageAt: lastMessage?.createdAt || null,
    unreadCount: 0,
  };
}

export function mapMessage(value: any, conversationId: string): ChatMessage {
  return {
    id: idOf(value?.id),
    conversationId,
    sender: mapUser(value?.sender || {}),
    text: value?.text || "",
    createdAt: value?.createdAt || new Date().toISOString(),
    status: value?.persistStatus === "failed" ? "failed" : "persisted",
  };
}

export async function getMe(): Promise<ChatUser | null> {
  const response = await enfyraFetch("/me", {
    query: { fields: "id,email,displayName,avatarUrl,statusText,lastSeenAt" },
  });
  const row = firstRowOf<any>(response);
  return row?.id ? mapUser(row) : null;
}

export async function loginWithPassword(email: string, password: string): Promise<ChatUser | null> {
  await enfyraFetch("/login", {
    method: "POST",
    body: JSON.stringify({ email, password, remember: true }),
  });
  return getMe();
}

export async function logout() {
  await enfyraFetch("/logout", { method: "POST" }).catch(() => null);
}

export async function searchUsers(query: string, currentUserId?: string): Promise<ChatUser[]> {
  const normalized = query.trim();
  const filterClauses = [
    ...(currentUserId ? [{ id: { _neq: currentUserId } }] : []),
    ...(normalized
      ? [
          {
            _or: [
              { email: { _contains: normalized } },
              { displayName: { _contains: normalized } },
            ],
          },
        ]
      : []),
  ];
  const response = await enfyraFetch("/user_definition", {
    query: {
      ...(filterClauses.length ? { filter: JSON.stringify({ _and: filterClauses }) } : {}),
      limit: 20,
    },
  });
  return rowsOf<any>(response).map(mapUser).filter((user) => user.id && user.id !== currentUserId);
}

export async function fetchUnreadConversationIds(userId: string): Promise<Set<string>> {
  const response = await enfyraFetch("/chat_message_read", {
    query: {
      filter: JSON.stringify({
        member: { id: { _eq: userId } },
        isRead: { _eq: false },
      }),
      fields: "conversation",
      limit: LOAD_ALL_LIMIT,
    },
  }).catch(() => null);
  return new Set(rowsOf<any>(response).map((row) => idOf(row.conversation?.id || row.conversation)).filter(Boolean));
}

export async function fetchConversationMembers(conversationId: string): Promise<ConversationMember[]> {
  const response = await enfyraFetch("/chat_conversation_member", {
    query: {
      filter: JSON.stringify({ conversation: { id: { _eq: conversationId } } }),
      deep: JSON.stringify({ member: {} }),
      limit: LOAD_ALL_LIMIT,
    },
  });
  return rowsOf<any>(response).map(mapMember).filter((member) => member.id && member.member.id);
}

async function fetchRlsConversations(userId: string): Promise<ChatListItem[]> {
  const [response, unreadConversationIds] = await Promise.all([
    enfyraFetch("/chat_conversation", {
      query: {
        fields: "id,kind,title,description,updatedAt,lastMessage.id,lastMessage.text,lastMessage.createdAt,lastMessage.persistStatus,lastMessage.sender.id,lastMessage.sender.email,lastMessage.sender.displayName,lastMessage.sender.avatarUrl,lastMessage.sender.statusText",
        limit: LOAD_ALL_LIMIT,
      },
    }),
    fetchUnreadConversationIds(userId),
  ]);
  return rowsOf<any>(response)
    .map((row): ChatListItem | null => {
      const conversationId = idOf(row?.id);
      if (!conversationId) return null;
      const unreadCount = unreadConversationIds.has(conversationId) ? 1 : 0;
      const conversation = mapConversation(row, []);
      conversation.unreadCount = unreadCount;
      return {
        conversation,
        membership: mapMember({ member: { id: userId } }),
        members: [],
        unreadCount,
      };
    })
    .filter(Boolean)
    .sort((a, b) => (b!.conversation.lastMessageAt || "").localeCompare(a!.conversation.lastMessageAt || "")) as ChatListItem[];
}

export async function fetchChatItems(userId: string): Promise<ChatListItem[]> {
  return fetchRlsConversations(userId);
}

export async function fetchMessages(conversationId: string, cursor?: { id: string; createdAt: string }) {
  const filter: any = {
    conversation: { id: { _eq: conversationId } },
  };
  if (cursor) {
    filter._or = [
      { createdAt: { _lt: cursor.createdAt } },
      { createdAt: { _eq: cursor.createdAt }, id: { _lt: cursor.id } },
    ];
  }

  const response = await enfyraFetch("/chat_message", {
    query: {
      filter: JSON.stringify(filter),
      deep: JSON.stringify({ sender: {} }),
      sort: "-createdAt,-id",
      limit: MESSAGE_PAGE_SIZE,
      meta: "filterCount",
    },
  });
  const rows = rowsOf<any>(response);
  return {
    messages: rows.map((row) => mapMessage(row, conversationId)).reverse(),
    hasOlder: (filterCountOf(response) ?? rows.length) > rows.length,
  };
}

export async function createConversation(payload: {
  currentUserId: string;
  kind: "dm" | "group";
  title: string;
  memberIds: string[];
}) {
  const response = await enfyraFetch("/chat_conversation", {
    method: "POST",
    body: JSON.stringify({
      kind: payload.kind,
      title: payload.title,
      description: null,
      createdBy: { id: payload.currentUserId },
    }),
  });
  const conversation = firstRowOf<any>(response);
  const conversationId = idOf(conversation?.id);
  if (!conversationId) return "";
  await Promise.all([
    createMembership(conversationId, payload.currentUserId, "owner"),
    ...payload.memberIds.map((memberId) => createMembership(conversationId, memberId, "member")),
  ]);
  return conversationId;
}

export function createMembership(conversationId: string, memberId: string, role: "owner" | "member") {
  return enfyraFetch("/chat_conversation_member", {
    method: "POST",
    body: JSON.stringify({
      role,
      joinedAt: new Date().toISOString(),
      conversation: { id: conversationId },
      member: { id: memberId },
    }),
  });
}

export async function persistMessageFallback(conversationId: string, senderId: string, text: string, createdAt: string) {
  const response = await enfyraFetch("/chat_message", {
    method: "POST",
    body: JSON.stringify({
      text,
      persistStatus: "persisted",
      conversation: { id: conversationId },
      sender: { id: senderId },
    }),
  });
  const persisted = firstRowOf<any>(response);
  const persistedId = idOf(persisted?.id);
  const persistedAt = persisted?.createdAt || createdAt;
  if (!persistedId) return;
  await enfyraFetch(`/chat_conversation/${conversationId}`, {
    method: "PATCH",
    body: JSON.stringify({
      lastMessage: { id: persistedId },
      updatedAt: persistedAt,
    }),
  });
}

export async function deleteConversationForUser(conversationId: string, currentUserId: string, scope: DeleteConversationScope, kind: "dm" | "group") {
  const memberships = await fetchConversationMembers(conversationId);
  const targetMemberships =
    scope === "everyone" && kind === "dm"
      ? memberships
      : memberships.filter((membership) => sameId(membership.member.id, currentUserId));

  await Promise.all(targetMemberships.map((membership) => enfyraFetch(`/chat_conversation_member/${membership.id}`, { method: "DELETE" })));

  const remaining = await fetchConversationMembers(conversationId).catch(() => []);
  if (remaining.length === 0) {
    await enfyraFetch(`/chat_conversation/${conversationId}`, { method: "DELETE" }).catch(() => null);
  }
}
