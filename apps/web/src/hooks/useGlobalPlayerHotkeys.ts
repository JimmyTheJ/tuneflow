import { useEffect, useRef } from "react";
import { useLocation } from "react-router-dom";
import { hasBlockingModifier, shouldIgnoreKeyboardShortcuts } from "@/lib/keyboard";
import { hasActivePlayback, usePlayerStore } from "@/stores/playerStore";
import { usePlayerUiStore } from "@/stores/playerUiStore";

const SEEK_STEP_SEC = 10;
const VOLUME_STEP = 0.05;

export function useGlobalPlayerHotkeys() {
  const location = useLocation();
  const volumeBeforeMute = useRef<number | null>(null);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (shouldIgnoreKeyboardShortcuts(event.target) || hasBlockingModifier(event)) {
        return;
      }

      const state = usePlayerStore.getState();
      if (!hasActivePlayback(state)) return;

      const key = event.key;

      if (key === " ") {
        event.preventDefault();
        state.togglePlayback();
        return;
      }

      if (key === "ArrowLeft") {
        event.preventDefault();
        if (event.shiftKey) {
          void state.playPrevious();
          return;
        }
        state.seek(state.positionSec - SEEK_STEP_SEC);
        return;
      }

      if (key === "ArrowRight") {
        event.preventDefault();
        if (event.shiftKey) {
          void state.playNext();
          return;
        }
        state.seek(state.positionSec + SEEK_STEP_SEC);
        return;
      }

      if (key === "ArrowUp") {
        event.preventDefault();
        state.setVolume(Math.min(1, state.volume + VOLUME_STEP));
        if (state.volume + VOLUME_STEP > 0) {
          volumeBeforeMute.current = Math.min(1, state.volume + VOLUME_STEP);
        }
        return;
      }

      if (key === "ArrowDown") {
        event.preventDefault();
        const next = Math.max(0, state.volume - VOLUME_STEP);
        if (next > 0) {
          volumeBeforeMute.current = next;
        }
        state.setVolume(next);
        return;
      }

      if (key === "m" || key === "M") {
        event.preventDefault();
        if (state.volume > 0) {
          volumeBeforeMute.current = state.volume;
          state.setVolume(0);
        } else {
          state.setVolume(volumeBeforeMute.current ?? 0.5);
          volumeBeforeMute.current = null;
        }
        return;
      }

      if ((key === "q" || key === "Q") && location.pathname !== "/player") {
        event.preventDefault();
        usePlayerUiStore.getState().toggleQueueDrawer();
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [location.pathname]);
}
