import { create } from "zustand";

import { api } from "@/lib/api";
import { clearAccessToken, getAccessToken, setAccessToken } from "@/lib/settings";
import type { User } from "@/types";

type AuthState = {
  user: User | null;
  isReady: boolean;
  hydrate: () => Promise<void>;
  login: (householdSlug: string, username: string, password: string) => Promise<void>;
  setup: (username: string, password: string, displayName: string) => Promise<void>;
  logout: () => Promise<void>;
  refreshMe: () => Promise<void>;
};

export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  isReady: false,

  hydrate: async () => {
    const token = await getAccessToken();
    if (!token) {
      set({ user: null, isReady: true });
      return;
    }
    try {
      const user = await api.me();
      set({ user, isReady: true });
    } catch {
      await clearAccessToken();
      set({ user: null, isReady: true });
    }
  },

  login: async (householdSlug, username, password) => {
    const response = await api.login(householdSlug, username, password);
    await setAccessToken(response.access_token);
    set({ user: response.user });
  },

  setup: async (username, password, displayName) => {
    const response = await api.setup(username, password, displayName);
    await setAccessToken(response.access_token);
    set({ user: response.user });
  },

  logout: async () => {
    await clearAccessToken();
    set({ user: null });
  },

  refreshMe: async () => {
    const user = await api.me();
    set({ user });
  },
}));
