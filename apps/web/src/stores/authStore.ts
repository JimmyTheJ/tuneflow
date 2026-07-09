import { create } from "zustand";
import { api } from "@/lib/api";
import { clearAccessToken, setAccessToken } from "@/lib/settings";
import type { User } from "@/types";

type AuthState = {
  user: User | null;
  isReady: boolean;
  hydrate: () => Promise<void>;
  login: (username: string, password: string) => Promise<void>;
  setup: (username: string, password: string, displayName: string) => Promise<void>;
  logout: () => void;
};

export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  isReady: false,

  hydrate: async () => {
    const token = localStorage.getItem("tuneflow.accessToken");
    if (!token) {
      set({ user: null, isReady: true });
      return;
    }
    try {
      set({ user: await api.me(), isReady: true });
    } catch {
      clearAccessToken();
      set({ user: null, isReady: true });
    }
  },

  login: async (username, password) => {
    const res = await api.login(username, password);
    setAccessToken(res.access_token);
    set({ user: res.user });
  },

  setup: async (username, password, displayName) => {
    const res = await api.setup(username, password, displayName);
    setAccessToken(res.access_token);
    set({ user: res.user });
  },

  logout: () => {
    clearAccessToken();
    set({ user: null });
  },
}));
