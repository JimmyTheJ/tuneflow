import { usePlayerStore } from "@/stores/playerStore";

export function PlayerPage() {
  const current = usePlayerStore((s) => s.current);
  const isPlaying = usePlayerStore((s) => s.isPlaying);
  const isLoading = usePlayerStore((s) => s.isLoading);
  const togglePlayback = usePlayerStore((s) => s.togglePlayback);
  const playNext = usePlayerStore((s) => s.playNext);
  const stop = usePlayerStore((s) => s.stop);

  if (!current) return <div className="page"><p className="muted">Nothing playing</p></div>;

  return (
    <div className="page player-page">
      {current.thumbnail_url ? (
        <img src={current.thumbnail_url} alt="" className="player-art" />
      ) : (
        <div className="player-art player-art-fallback" />
      )}
      <h1>{current.title}</h1>
      <p className="muted">{current.artist ?? "Unknown artist"}</p>
      <div className="player-controls">
        <button type="button" onClick={() => stop()}>Stop</button>
        <button type="button" className="btn-primary btn-lg" onClick={() => togglePlayback()}>
          {isLoading ? "…" : isPlaying ? "Pause" : "Play"}
        </button>
        <button type="button" onClick={() => void playNext()}>Next</button>
      </div>
    </div>
  );
}
