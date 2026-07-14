import { create } from "zustand";

import { api } from "@/lib/api";
import { hasConfiguredServer } from "@/lib/settings";

type ServerCheck = "pending" | "ok" | "needs-config";

type BootstrapState = {
  serverCheck: ServerCheck;
  needsSetup: boolean | null;
  runServerCheck: () => Promise<void>;
  setServerOk: (needsSetup: boolean) => void;
};

export const useBootstrapStore = create<BootstrapState>((set) => ({
  serverCheck: "pending",
  needsSetup: null,

  runServerCheck: async () => {
    set({ serverCheck: "pending", needsSetup: null });
    const configured = await hasConfiguredServer();
    if (!configured) {
      set({ serverCheck: "needs-config" });
      return;
    }
    try {
      const status = await api.setupStatus();
      set({ serverCheck: "ok", needsSetup: status.needs_setup });
    } catch {
      set({ serverCheck: "needs-config" });
    }
  },

  setServerOk: (needsSetup) => {
    set({ serverCheck: "ok", needsSetup });
  },
}));
