import { useEffect } from "react";
import { useLikedTracks } from "@/hooks/useLikedTracks";
import { hasBlockingModifier, shouldIgnoreKeyboardShortcuts } from "@/lib/keyboard";
import { hasActivePlayback, usePlayerStore } from "@/stores/playerStore";

export function usePlayerPageHotkeys() {
  const { toggleLike } = useLikedTracks();

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (shouldIgnoreKeyboardShortcuts(event.target) || hasBlockingModifier(event)) {
        return;
      }

      const state = usePlayerStore.getState();
      if (!hasActivePlayback(state)) return;

      const key = event.key;

      if ((key === "l" || key === "L") && state.current) {
        event.preventDefault();
        void toggleLike(state.current);
        return;
      }

      if (key === "v" || key === "V") {
        if (!state.stream?.has_video) return;
        event.preventDefault();
        void state.setStreamSelection({ video: !state.streamSelection.video });
        return;
      }

      if (key === "s" || key === "S") {
        event.preventDefault();
        state.toggleShuffle();
        return;
      }

      if (key === "r" || key === "R") {
        event.preventDefault();
        state.cycleRepeatMode();
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [toggleLike]);
}
