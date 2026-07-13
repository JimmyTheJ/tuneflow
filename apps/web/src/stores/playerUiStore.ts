import { create } from "zustand";

type PlayerUiState = {
  queueDrawerOpen: boolean;
  setQueueDrawerOpen: (open: boolean) => void;
  toggleQueueDrawer: () => void;
};

export const usePlayerUiStore = create<PlayerUiState>((set) => ({
  queueDrawerOpen: false,
  setQueueDrawerOpen: (open) => set({ queueDrawerOpen: open }),
  toggleQueueDrawer: () => set((state) => ({ queueDrawerOpen: !state.queueDrawerOpen })),
}));
