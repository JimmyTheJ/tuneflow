import { Link, useLocation } from "react-router-dom";
import { useState } from "react";
import { PlayerProgress } from "@/components/PlayerProgress";
import { PlayerQueueDrawer } from "@/components/PlayerQueueDrawer";
import { PlayerTransport } from "@/components/PlayerTransport";
import { PlayerVolume } from "@/components/PlayerVolume";
import { TrackThumb } from "@/components/TrackThumb";
import { useAuthStore } from "@/stores/authStore";
import { getQueueView, hasActivePlayback, usePlayerStore } from "@/stores/playerStore";

const FULL_WIDTH_ROUTES = new Set(["/login", "/setup"]);

export function MiniPlayer() {
  const location = useLocation();
  const [queueOpen, setQueueOpen] = useState(false);
  const user = useAuthStore((s) => s.user);
  const current = usePlayerStore((s) => s.current);
  const media = usePlayerStore((s) => s.media);
  const isLoading = usePlayerStore((s) => s.isLoading);
  const queue = usePlayerStore((s) => s.queue);
  const shuffle = usePlayerStore((s) => s.shuffle);
  const shuffleOrder = usePlayerStore((s) => s.shuffleOrder);
  const shuffleStep = usePlayerStore((s) => s.shuffleStep);
  const error = usePlayerStore((s) => s.error);
  const clearError = usePlayerStore((s) => s.clearError);
  const stop = usePlayerStore((s) => s.stop);

  const active = hasActivePlayback({ current, media, isLoading });
  if (!active) return null;

  const queueItems = getQueueView({ current, queue, shuffle, shuffleOrder, shuffleStep });
  const upcomingCount = queueItems.filter((item) => item.status === "upcoming").length;

  const fullWidth = !user || FULL_WIDTH_ROUTES.has(location.pathname);
  const playerClass = fullWidth ? "mini-player mini-player-fullwidth" : "mini-player";
  const errorClass = fullWidth ? "mini-player-error mini-player-fullwidth" : "mini-player-error";

  return (
    <>
      <PlayerQueueDrawer open={queueOpen} onClose={() => setQueueOpen(false)} />
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
            {current && queue.length > 0 ? (
              <button
                type="button"
                className="mini-player-queue-btn"
                onClick={() => setQueueOpen(true)}
                aria-label={`Open queue, ${upcomingCount} up next`}
              >
                ☰{upcomingCount > 0 ? ` ${upcomingCount}` : ""}
              </button>
            ) : null}
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
