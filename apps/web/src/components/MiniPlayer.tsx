import { Link } from "react-router-dom";
import { usePlayerStore } from "@/stores/playerStore";

export function MiniPlayer() {
  const current = usePlayerStore((s) => s.current);
  const isPlaying = usePlayerStore((s) => s.isPlaying);
  const isLoading = usePlayerStore((s) => s.isLoading);
  const togglePlayback = usePlayerStore((s) => s.togglePlayback);
  const playNext = usePlayerStore((s) => s.playNext);

  if (!current) return null;

  return (
    <div className="mini-player">
      <Link to="/player" className="mini-player-meta">
        <div className="track-title">{current.title}</div>
        <div className="track-subtitle">{current.artist ?? "Unknown artist"}</div>
      </Link>
      <div className="mini-player-controls">
        <button type="button" onClick={() => togglePlayback()} aria-label="Play/Pause">
          {isLoading ? "…" : isPlaying ? "⏸" : "▶"}
        </button>
        <button type="button" onClick={() => void playNext()} aria-label="Next">
          ⏭
        </button>
      </div>
    </div>
  );
}
