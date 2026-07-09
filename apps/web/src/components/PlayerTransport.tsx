import { usePlayerStore } from "@/stores/playerStore";

type Props = {
  size?: "mini" | "large";
};

export function PlayerTransport({ size = "mini" }: Props) {
  const current = usePlayerStore((s) => s.current);
  const queue = usePlayerStore((s) => s.queue);
  const positionSec = usePlayerStore((s) => s.positionSec);
  const isPlaying = usePlayerStore((s) => s.isPlaying);
  const isLoading = usePlayerStore((s) => s.isLoading);
  const togglePlayback = usePlayerStore((s) => s.togglePlayback);
  const playPrevious = usePlayerStore((s) => s.playPrevious);
  const playNext = usePlayerStore((s) => s.playNext);

  const index = current ? queue.findIndex((t) => t.video_id === current.video_id) : -1;
  const canPrevious = !!current && (positionSec > 3 || index > 0);
  const canNext = !!current && index >= 0 && index < queue.length - 1;

  const className = size === "large" ? "player-transport player-transport-large" : "player-transport";

  return (
    <div className={className}>
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
    </div>
  );
}
