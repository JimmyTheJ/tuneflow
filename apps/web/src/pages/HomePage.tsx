import { useCallback, useEffect, useState } from "react";
import { TrackRow } from "@/components/TrackRow";
import { api } from "@/lib/api";
import { usePlayerStore } from "@/stores/playerStore";
import type { PlayHistoryEntry } from "@/types";

export function HomePage() {
  const [history, setHistory] = useState<PlayHistoryEntry[]>([]);
  const [error, setError] = useState<string | null>(null);
  const playTrack = usePlayerStore((s) => s.playTrack);

  const load = useCallback(async () => {
    try {
      setHistory(await api.listHistory());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load history");
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="page">
      <h1>Recently played</h1>
      {error ? <p className="error">{error}</p> : null}
      {history.length === 0 ? (
        <p className="muted">Play something from Search to build your history.</p>
      ) : (
        history.map((item) => (
          <TrackRow key={item.id} track={item} onClick={() => void playTrack(item, history)} />
        ))
      )}
    </div>
  );
}
