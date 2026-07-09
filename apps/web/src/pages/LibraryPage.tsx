import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { TrackRow } from "@/components/TrackRow";
import { api } from "@/lib/api";
import { usePlayerStore } from "@/stores/playerStore";
import type { LikeEntry, Playlist } from "@/types";

export function LibraryPage() {
  const [playlists, setPlaylists] = useState<Playlist[]>([]);
  const [likes, setLikes] = useState<LikeEntry[]>([]);
  const [error, setError] = useState<string | null>(null);
  const playTrack = usePlayerStore((s) => s.playTrack);

  const load = useCallback(async () => {
    try {
      const [p, l] = await Promise.all([api.listPlaylists(), api.listLikes()]);
      setPlaylists(p);
      setLikes(l);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load library");
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const createPlaylist = async () => {
    try {
      await api.createPlaylist(`Playlist ${playlists.length + 1}`);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create playlist");
    }
  };

  return (
    <div className="page">
      <div className="page-header">
        <h1>Your library</h1>
        <button type="button" className="btn-secondary" onClick={() => void createPlaylist()}>
          New playlist
        </button>
      </div>
      {error ? <p className="error">{error}</p> : null}
      <h2 className="section-label">Playlists</h2>
      {playlists.map((p) => (
        <Link key={p.id} to={`/playlist/${p.id}`} className="playlist-row">
          <div className="track-title">{p.name}</div>
          <div className="track-subtitle">{p.track_count} tracks</div>
        </Link>
      ))}
      <h2 className="section-label">Liked songs</h2>
      {likes.map((like) => (
        <TrackRow key={like.id} track={like} onClick={() => void playTrack(like, likes)} />
      ))}
    </div>
  );
}
