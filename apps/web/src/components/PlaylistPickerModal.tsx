import { Search } from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { api } from "@/lib/api";
import { cn } from "@/lib/cn";
import {
  addTracksToPlaylist,
  filterPlaylists,
  formatBulkAddMessage,
} from "@/lib/playlistUtils";
import type { Playlist, Track } from "@/types";

type Props = {
  visible: boolean;
  title: string;
  tracks: Track[];
  playlists: Playlist[];
  onClose: () => void;
  onComplete: (message: string) => void;
  onPlaylistsChange: () => void;
};

export function PlaylistPickerModal({
  visible,
  title,
  tracks,
  playlists,
  onClose,
  onComplete,
  onPlaylistsChange,
}: Props) {
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!visible) {
      setQuery("");
      setError(null);
      setBusy(false);
    }
  }, [visible]);

  if (!visible) return null;

  const filtered = filterPlaylists(playlists, query);

  const handleSelect = async (playlistId: number, playlistName: string) => {
    if (busy || tracks.length === 0) return;
    setBusy(true);
    setError(null);
    try {
      const result = await addTracksToPlaylist(playlistId, tracks, api.addPlaylistTrack);
      onComplete(formatBulkAddMessage(playlistName, result));
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not add to playlist");
    } finally {
      setBusy(false);
    }
  };

  const handleCreate = async () => {
    if (busy || tracks.length === 0) return;
    setBusy(true);
    setError(null);
    try {
      const playlist = await api.createPlaylist(`Playlist ${playlists.length + 1}`);
      onPlaylistsChange();
      const result = await addTracksToPlaylist(playlist.id, tracks, api.addPlaylistTrack);
      onComplete(formatBulkAddMessage(playlist.name, result));
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create playlist");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-[100] grid place-items-center bg-black/70 p-6 backdrop-blur-sm"
      onClick={busy ? undefined : onClose}
    >
      <div
        className="flex max-h-[min(520px,calc(100vh-32px))] w-full max-w-md flex-col overflow-hidden rounded-2xl border border-border bg-elevated shadow-elevated"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="border-b border-border px-5 py-4">
          <h2 className="m-0 text-xl font-bold tracking-tight">{title}</h2>
          {tracks.length > 1 ? (
            <p className="mt-1 mb-0 text-sm text-text-secondary">
              {tracks.length} tracks
            </p>
          ) : null}
        </div>

        <div className="px-5 py-3">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-text-muted" />
            <Input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search playlists"
              className="pl-10"
              autoFocus
              disabled={busy}
            />
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-2">
          {filtered.length === 0 ? (
            <p className="px-3 py-2 text-sm text-text-muted">
              {playlists.length === 0 ? "No playlists yet" : "No playlists match your search"}
            </p>
          ) : (
            filtered.map((playlist) => (
              <button
                key={playlist.id}
                type="button"
                disabled={busy}
                className={cn(
                  "block w-full rounded-lg border-0 bg-transparent px-3 py-2.5 text-left text-sm text-text",
                  "hover:bg-highlight disabled:cursor-not-allowed disabled:opacity-50",
                )}
                onClick={() => void handleSelect(playlist.id, playlist.name)}
              >
                <span className="font-medium">{playlist.name}</span>
                <span className="ml-2 text-text-muted">{playlist.track_count} tracks</span>
              </button>
            ))
          )}
        </div>

        <div className="border-t border-border px-5 py-4">
          {error ? <p className="mb-3 text-sm text-danger-fg">{error}</p> : null}
          <div className="flex gap-3">
            <Button variant="secondary" className="flex-1" onClick={onClose} disabled={busy}>
              Cancel
            </Button>
            <Button className="flex-1" onClick={() => void handleCreate()} disabled={busy}>
              New playlist
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
