import { canPlayNext, canPlayPrevious, usePlayerStore } from "@/stores/playerStore";
import { PlayerQueueControls } from "@/components/PlayerQueueControls";

type Props = {
  size?: "mini" | "large";
  showQueueControls?: boolean;
};

export function PlayerTransport({ size = "mini", showQueueControls = false }: Props) {
  const canPrevious = usePlayerStore((s) => canPlayPrevious(s));
  const canNext = usePlayerStore((s) => canPlayNext(s));
  const isPlaying = usePlayerStore((s) => s.isPlaying);
  const isLoading = usePlayerStore((s) => s.isLoading);
  const togglePlayback = usePlayerStore((s) => s.togglePlayback);
  const playPrevious = usePlayerStore((s) => s.playPrevious);
  const playNext = usePlayerStore((s) => s.playNext);

  const className = size === "large" ? "player-transport player-transport-large" : "player-transport";

  return (
    <div className={className}>
      {showQueueControls ? <PlayerQueueControls compact={size === "mini"} showRepeat={false} /> : null}
      <button
        type="button"
        className="player-transport-btn"
        onClick={() => void playPrevious()}
        disabled={!canPrevious}
        aria-label="Previous"
      >
        ⏮
      </button>
      <button
        type="button"
        className={`player-transport-btn player-transport-btn-primary${size === "large" ? " player-transport-btn-large" : ""}`}
        onClick={() => togglePlayback()}
        disabled={isLoading}
        aria-label={isPlaying ? "Pause" : "Play"}
      >
        {isLoading ? "…" : isPlaying ? "⏸" : "▶"}
      </button>
      <button
        type="button"
        className="player-transport-btn"
        onClick={() => void playNext()}
        disabled={!canNext}
        aria-label="Next"
      >
        ⏭
      </button>
      {showQueueControls ? (
        <PlayerQueueControls compact={size === "mini"} showShuffle={false} />
      ) : null}
    </div>
  );
}
