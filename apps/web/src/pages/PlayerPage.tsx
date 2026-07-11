import { PlayerProgress } from "@/components/PlayerProgress";
import { PlayerTransport } from "@/components/PlayerTransport";
import { PlayerVideo } from "@/components/PlayerVideo";
import { PlayerVolume } from "@/components/PlayerVolume";
import { StreamModeToggle } from "@/components/StreamModeToggle";
import { TrackThumb } from "@/components/TrackThumb";
import { hasActivePlayback, usePlayerStore } from "@/stores/playerStore";

export function PlayerPage() {
  const current = usePlayerStore((s) => s.current);
  const media = usePlayerStore((s) => s.media);
  const isLoading = usePlayerStore((s) => s.isLoading);
  const streamSelection = usePlayerStore((s) => s.streamSelection);
  const stop = usePlayerStore((s) => s.stop);

  const active = hasActivePlayback({
    current,
    media,
    isLoading,
  });

  if (!active) {
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
      <p className="muted">{current.artist ?? "Unknown artist"}</p>
      <div className="player-page-controls">
        <StreamModeToggle />
        <PlayerTransport size="large" showQueueControls />
        <PlayerProgress className="player-page-progress" />
        <PlayerVolume className="player-page-volume" />
        <button type="button" className="btn-secondary player-stop-btn" onClick={() => stop()}>
          Stop
        </button>
      </div>
    </div>
  );
}
