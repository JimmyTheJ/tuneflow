import { Repeat, Repeat1, Shuffle } from "lucide-react";
import { usePlayerStore } from "@/stores/playerStore";
import type { RepeatMode } from "@/stores/playerStore";
import { IconButton } from "@/components/ui/IconButton";
import { cn } from "@/lib/cn";

type Props = {
  className?: string;
  compact?: boolean;
  showShuffle?: boolean;
  showRepeat?: boolean;
};

const REPEAT_LABELS: Record<RepeatMode, string> = {
  none: "Repeat off",
  all: "Repeat playlist",
  one: "Repeat track",
};

export function PlayerQueueControls({
  className,
  compact = false,
  showShuffle = true,
  showRepeat = true,
}: Props) {
  const queue = usePlayerStore((s) => s.queue);
  const shuffle = usePlayerStore((s) => s.shuffle);
  const repeatMode = usePlayerStore((s) => s.repeatMode);
  const toggleShuffle = usePlayerStore((s) => s.toggleShuffle);
  const cycleRepeatMode = usePlayerStore((s) => s.cycleRepeatMode);

  const canShuffle = queue.length > 1;
  const repeatActive = repeatMode !== "none";
  const iconClass = compact ? "size-4" : "size-5";

  return (
    <div className={cn("flex items-center gap-1", className)}>
      {showShuffle ? (
        <IconButton
          label={shuffle ? "Shuffle on" : "Shuffle off"}
          active={shuffle}
          size={compact ? "sm" : "md"}
          disabled={!canShuffle}
          onClick={() => toggleShuffle()}
        >
          <Shuffle className={iconClass} />
        </IconButton>
      ) : null}
      {showRepeat ? (
        <IconButton
          label={REPEAT_LABELS[repeatMode]}
          active={repeatActive}
          size={compact ? "sm" : "md"}
          onClick={() => cycleRepeatMode()}
        >
          {repeatMode === "one" ? (
            <Repeat1 className={iconClass} />
          ) : (
            <Repeat className={iconClass} />
          )}
        </IconButton>
      ) : null}
    </div>
  );
}
