import { Link } from "react-router-dom";
import { PlayerProgress } from "@/components/PlayerProgress";
import { PlayerTransport } from "@/components/PlayerTransport";
import { TrackThumb } from "@/components/TrackThumb";
import { usePlayerStore } from "@/stores/playerStore";

export function MiniPlayer() {
  const current = usePlayerStore((s) => s.current);
  const error = usePlayerStore((s) => s.error);
  const clearError = usePlayerStore((s) => s.clearError);

  if (!current) return null;

  return (
    <>
      {error ? (
        <div className="mini-player-error">
          <span>{error}</span>
          <button type="button" onClick={() => clearError()} aria-label="Dismiss">
            ✕
          </button>
        </div>
      ) : null}
      <div className="mini-player">
        <div className="mini-player-top">
          <Link to="/player" className="mini-player-meta">
            <TrackThumb
              videoId={current.video_id}
              className="mini-player-thumb"
              fallbackClassName="mini-player-thumb mini-player-thumb-fallback"
            />
            <div className="mini-player-text">
              <div className="track-title">{current.title}</div>
              <div className="track-subtitle">{current.artist ?? "Unknown artist"}</div>
            </div>
          </Link>
          <PlayerTransport />
        </div>
        <PlayerProgress className="mini-player-progress" />
      </div>
    </>
  );
}
