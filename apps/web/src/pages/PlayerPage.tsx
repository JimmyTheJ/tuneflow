import { PlayerProgress } from "@/components/PlayerProgress";
import { PlayerTransport } from "@/components/PlayerTransport";
import { TrackThumb } from "@/components/TrackThumb";
import { usePlayerStore } from "@/stores/playerStore";

export function PlayerPage() {
  const current = usePlayerStore((s) => s.current);
  const stop = usePlayerStore((s) => s.stop);

  if (!current) {
    return (
      <div className="page">
        <p className="muted">Nothing playing</p>
      </div>
    );
  }

  return (
    <div className="page player-page">
      <TrackThumb
        videoId={current.video_id}
        className="player-art"
        fallbackClassName="player-art player-art-fallback"
      />
      <h1>{current.title}</h1>
      <p className="muted">{current.artist ?? "Unknown artist"}</p>
      <div className="player-page-controls">
        <PlayerTransport size="large" />
        <PlayerProgress className="player-page-progress" />
        <button type="button" className="btn-secondary player-stop-btn" onClick={() => stop()}>
          Stop
        </button>
      </div>
    </div>
  );
}
