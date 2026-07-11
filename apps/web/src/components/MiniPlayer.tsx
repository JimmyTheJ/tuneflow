import { Link, useLocation } from "react-router-dom";
import { PlayerProgress } from "@/components/PlayerProgress";
import { PlayerTransport } from "@/components/PlayerTransport";
import { PlayerVolume } from "@/components/PlayerVolume";
import { TrackThumb } from "@/components/TrackThumb";
import { useAuthStore } from "@/stores/authStore";
import { hasActivePlayback, usePlayerStore } from "@/stores/playerStore";

const FULL_WIDTH_ROUTES = new Set(["/login", "/setup"]);

export function MiniPlayer() {
  const location = useLocation();
  const user = useAuthStore((s) => s.user);
  const current = usePlayerStore((s) => s.current);
  const media = usePlayerStore((s) => s.media);
  const isLoading = usePlayerStore((s) => s.isLoading);
  const error = usePlayerStore((s) => s.error);
  const clearError = usePlayerStore((s) => s.clearError);
  const stop = usePlayerStore((s) => s.stop);

  const active = hasActivePlayback({ current, media, isLoading });
  if (!active) return null;

  const fullWidth = !user || FULL_WIDTH_ROUTES.has(location.pathname);
  const playerClass = fullWidth ? "mini-player mini-player-fullwidth" : "mini-player";
  const errorClass = fullWidth ? "mini-player-error mini-player-fullwidth" : "mini-player-error";

  return (
    <>
      {error ? (
        <div className={errorClass}>
          <span>{error}</span>
          <button type="button" onClick={() => clearError()} aria-label="Dismiss">
            ✕
          </button>
        </div>
      ) : null}
      <div className={playerClass}>
        <div className="mini-player-top">
          <Link to="/player" className="mini-player-meta">
            {current ? (
              <>
                <TrackThumb
                  videoId={current.video_id}
                  className="mini-player-thumb"
                  fallbackClassName="mini-player-thumb mini-player-thumb-fallback"
                />
                <div className="mini-player-text">
                  <div className="track-title">{current.title}</div>
                  <div className="track-subtitle">{current.artist ?? "Unknown artist"}</div>
                </div>
              </>
            ) : (
              <div className="mini-player-text">
                <div className="track-title">Playback active</div>
                <div className="track-subtitle">Open Now Playing for controls</div>
              </div>
            )}
          </Link>
          <div className="mini-player-actions">
            <PlayerTransport showQueueControls={Boolean(current)} />
            <button type="button" className="mini-player-stop" onClick={() => stop()} aria-label="Stop">
              ✕
            </button>
          </div>
        </div>
        {current ? <PlayerProgress className="mini-player-progress" /> : null}
        <PlayerVolume className="mini-player-volume" compact />
      </div>
    </>
  );
}
