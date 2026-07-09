import { useCallback, useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { TrackRow } from "@/components/TrackRow";
import { api } from "@/lib/api";
import { usePlayerStore } from "@/stores/playerStore";
import type { PlaylistDetail } from "@/types";

export function PlaylistPage() {
  const { id } = useParams<{ id: string }>();
  const [playlist, setPlaylist] = useState<PlaylistDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const playTrack = usePlayerStore((s) => s.playTrack);

  const load = useCallback(async () => {
    if (!id) return;
    try {
      setPlaylist(await api.getPlaylist(Number(id)));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load playlist");
    }
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  if (error) return <p className="error">{error}</p>;
  if (!playlist) return <p className="muted">Loading…</p>;

  return (
    <div className="page">
      <h1>{playlist.name}</h1>
      <p className="muted">{playlist.tracks.length} tracks</p>
      {playlist.tracks.map((track) => (
        <TrackRow key={track.id} track={track} onClick={() => void playTrack(track, playlist.tracks)} />
      ))}
    </div>
  );
}
