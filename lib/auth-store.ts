"use client";

import { create } from "zustand";
import type { ChatUser } from "@/lib/chat-types";
import { getMe } from "@/lib/enfyra-api";

type AuthStatus = "loading" | "authenticated" | "anonymous";

type AuthState = {
  user: ChatUser | null;
  status: AuthStatus;
  checked: boolean;
  ensureUser: () => Promise<ChatUser | null>;
  setUser: (user: ChatUser | null) => void;
  clearUser: () => void;
};

let authRequest: Promise<ChatUser | null> | null = null;

export const useAuthStore = create<AuthState>((set, get) => ({
  user: null,
  status: "loading",
  checked: false,
  ensureUser: async () => {
    const state = get();
    if (state.checked) return state.user;
    if (authRequest) return authRequest;

    set({ status: "loading" });
    authRequest = getMe()
      .then((user) => {
        set({
          user,
          status: user?.id ? "authenticated" : "anonymous",
          checked: true,
        });
        return user;
      })
      .catch(() => {
        set({ user: null, status: "anonymous", checked: true });
        return null;
      })
      .finally(() => {
        authRequest = null;
      });

    return authRequest;
  },
  setUser: (user) => {
    set({
      user,
      status: user?.id ? "authenticated" : "anonymous",
      checked: true,
    });
  },
  clearUser: () => {
    set({ user: null, status: "anonymous", checked: true });
  },
}));
