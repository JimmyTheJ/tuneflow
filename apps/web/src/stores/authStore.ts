import { create } from "zustand";
import { api } from "@/lib/api";
import { clearAccessToken, setAccessToken } from "@/lib/settings";
import { useEqStore } from "@/stores/eqStore";
import { usePlayerStore } from "@/stores/playerStore";
import type { User } from "@/types";

type AuthState = {
  user: User | null;
  isReady: boolean;
  hydrate: () => Promise<void>;
  login: (householdSlug: string, username: string, password: string) => Promise<void>;
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
      const user = await api.me();
      set({ user, isReady: true });
      void useEqStore.getState().load();
    } catch {
      clearAccessToken();
      useEqStore.getState().reset();
      set({ user: null, isReady: true });
    }
  },

  login: async (householdSlug, username, password) => {
    const res = await api.login(householdSlug, username, password);
    setAccessToken(res.access_token);
    set({ user: res.user });
    void useEqStore.getState().load();
  },

  setup: async (username, password, displayName) => {
    const res = await api.setup(username, password, displayName);
    setAccessToken(res.access_token);
    set({ user: res.user });
    void useEqStore.getState().load();
  },

  logout: () => {
    usePlayerStore.getState().stop();
    useEqStore.getState().reset();
    clearAccessToken();
    set({ user: null });
  },
}));
