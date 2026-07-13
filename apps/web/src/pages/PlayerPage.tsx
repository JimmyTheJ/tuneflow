import { useEffect, useState } from "react";
import { LikeButton } from "@/components/LikeButton";
import { PlayerProgress } from "@/components/PlayerProgress";
import { PlayerQueuePanel } from "@/components/PlayerQueuePanel";
import { PlayerTransport } from "@/components/PlayerTransport";
import { PlayerVideo } from "@/components/PlayerVideo";
import { PlayerVolume } from "@/components/PlayerVolume";
import { StreamModeToggle } from "@/components/StreamModeToggle";
import { TrackThumb } from "@/components/TrackThumb";
import {
  hasActivePlayback,
  hasOrphanedPlayback,
  usePlayerStore,
} from "@/stores/playerStore";

export function PlayerPage() {
  const current = usePlayerStore((s) => s.current);
  const media = usePlayerStore((s) => s.media);
  const isLoading = usePlayerStore((s) => s.isLoading);
  const streamSelection = usePlayerStore((s) => s.streamSelection);
  const queue = usePlayerStore((s) => s.queue);
  const stop = usePlayerStore((s) => s.stop);
  const recoverSession = usePlayerStore((s) => s.recoverSession);
  const stopOrphanedPlayback = usePlayerStore((s) => s.stopOrphanedPlayback);
  const [orphaned, setOrphaned] = useState(false);

  useEffect(() => {
    const recovered = recoverSession();
    if (!recovered) {
      setOrphaned(hasOrphanedPlayback(usePlayerStore.getState()));
    }
  }, [recoverSession]);

  const active = hasActivePlayback({
    current,
    media,
    isLoading,
  });

  if (!active) {
    if (orphaned) {
      return (
        <div className="page">
          <h1>Playback disconnected</h1>
          <p className="muted">
            Audio is still playing in this tab, but the player state was lost — often after a dev hot reload.
          </p>
          <div className="player-page-controls">
            <button
              type="button"
              className="btn-primary"
              onClick={() => {
                const recovered = recoverSession();
                if (recovered) {
                  setOrphaned(false);
                  return;
                }
                setOrphaned(hasOrphanedPlayback(usePlayerStore.getState()));
              }}
            >
              Reconnect playback
            </button>
            <button
              type="button"
              className="btn-secondary player-stop-btn"
              onClick={() => {
                stopOrphanedPlayback();
                setOrphaned(false);
              }}
            >
              Stop audio
            </button>
          </div>
        </div>
      );
    }

    return (
      <div className="page">
        <p className="muted">Nothing playing</p>
      </div>
    );
  }

  if (!current) {
    return (
      <div className="page player-page">
        <h1>Playback active</h1>
        <p className="muted">Controls for audio that is still playing in this tab.</p>
        <div className="player-page-controls">
          <PlayerTransport size="large" />
          <button type="button" className="btn-secondary player-stop-btn" onClick={() => stop()}>
            Stop
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="page player-page">
      {streamSelection.video ? (
        <PlayerVideo className="player-video" />
      ) : (
        <TrackThumb
          videoId={current.video_id}
          className="player-art"
          fallbackClassName="player-art player-art-fallback"
        />
      )}
      <h1>{current.title}</h1>
      <div className="player-page-title-row">
        <p className="muted player-page-artist">{current.artist ?? "Unknown artist"}</p>
        <LikeButton track={current} size="lg" />
      </div>
      <div className="player-page-controls">
        <StreamModeToggle />
        <PlayerTransport size="large" showQueueControls />
        <PlayerProgress className="player-page-progress" />
        <PlayerVolume className="player-page-volume" />
        <button type="button" className="btn-secondary player-stop-btn" onClick={() => stop()}>
          Stop
        </button>
      </div>
      {queue.length > 0 ? <PlayerQueuePanel className="player-page-queue" /> : null}
    </div>
  );
}
