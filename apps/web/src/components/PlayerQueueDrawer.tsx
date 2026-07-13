import { useEffect } from "react";
import { PlayerQueuePanel } from "@/components/PlayerQueuePanel";
import { cn } from "@/lib/cn";

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
    <div
      className="fixed inset-0 z-[60] flex justify-end bg-black/55"
      onClick={onClose}
      role="presentation"
    >
      <div
        className={cn(
          "h-full w-full max-w-md overflow-y-auto border-l border-border bg-surface p-5 pb-36",
          "shadow-elevated transition-transform duration-200",
          "max-md:mt-auto max-md:h-[min(72vh,100%)] max-md:max-w-none max-md:rounded-t-2xl max-md:border-l-0 max-md:border-t",
        )}
        onClick={(event) => event.stopPropagation()}
        role="dialog"
        aria-label="Playback queue"
      >
        <PlayerQueuePanel onClose={onClose} />
      </div>
    </div>
  );
}
