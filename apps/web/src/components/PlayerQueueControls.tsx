import { usePlayerStore } from "@/stores/playerStore";
import type { RepeatMode } from "@/stores/playerStore";

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

  return (
    <div className={className ? `player-queue-controls ${className}` : "player-queue-controls"}>
      {showShuffle ? (
        <button
          type="button"
          className={`player-mode-btn${shuffle ? " player-mode-btn-active" : ""}${compact ? " player-mode-btn-compact" : ""}`}
          onClick={() => toggleShuffle()}
          disabled={!canShuffle}
          aria-label={shuffle ? "Shuffle on" : "Shuffle off"}
          aria-pressed={shuffle}
        >
          🔀
        </button>
      ) : null}
      {showRepeat ? (
        <button
          type="button"
          className={`player-mode-btn${repeatActive ? " player-mode-btn-active" : ""}${compact ? " player-mode-btn-compact" : ""}${repeatMode === "one" ? " player-mode-btn-repeat-one" : ""}`}
          onClick={() => cycleRepeatMode()}
          aria-label={REPEAT_LABELS[repeatMode]}
          aria-pressed={repeatActive}
        >
          {repeatMode === "one" ? "🔂" : "🔁"}
        </button>
      ) : null}
    </div>
  );
}
