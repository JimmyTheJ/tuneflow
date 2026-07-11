import { useEffect } from "react";
import { PlayerQueuePanel } from "@/components/PlayerQueuePanel";

type Props = {
  open: boolean;
  onClose: () => void;
};

export function PlayerQueueDrawer({ open, onClose }: Props) {
  useEffect(() => {
    if (!open) return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="player-queue-overlay" onClick={onClose} role="presentation">
      <div
        className="player-queue-drawer"
        onClick={(event) => event.stopPropagation()}
        role="dialog"
        aria-label="Playback queue"
      >
        <PlayerQueuePanel onClose={onClose} />
      </div>
    </div>
  );
}
