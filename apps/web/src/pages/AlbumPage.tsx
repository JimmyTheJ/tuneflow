import { Play } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { TrackRowWithActions } from "@/components/TrackRowWithActions";
import { Button } from "@/components/ui/Button";
import { TrackRowSkeleton } from "@/components/ui/Skeleton";
import { useLikedTracks } from "@/hooks/useLikedTracks";
import { api } from "@/lib/api";
import { albumPlayableTracks, catalogTrackToPlayable, formatReleaseYear } from "@/lib/catalogUtils";
import { usePlayerStore } from "@/stores/playerStore";
import type { AlbumDetail, CatalogTrack, Playlist, Track } from "@/types";

export function AlbumPage() {
  const { id } = useParams<{ id: string }>();
  const [album, setAlbum] = useState<AlbumDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [resolving, setResolving] = useState(false);
  const [playlists, setPlaylists] = useState<Playlist[]>([]);
  const resolveStarted = useRef(false);
  const playTrack = usePlayerStore((s) => s.playTrack);
  const { likedVideoIds, refresh: refreshLikedTracks } = useLikedTracks();

  const loadPlaylists = useCallback(async () => {
    try {
      setPlaylists(await api.listPlaylists());
    } catch {
      /* optional */
    }
  }, []);

  const load = useCallback(async () => {
    if (!id) return;
    try {
      setAlbum(await api.getAlbum(id));
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load album");
    }
  }, [id]);

  const resolveTracks = useCallback(async () => {
    if (!id) return;
    setResolving(true);
    try {
      const result = await api.resolveAlbum(id);
      setAlbum((current) =>
        current
          ? {
              ...current,
              tracks: result.tracks,
            }
          : current,
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not resolve tracks");
    } finally {
      setResolving(false);
    }
  }, [id]);

  useEffect(() => {
    void load();
    void loadPlaylists();
    void refreshLikedTracks();
  }, [load, loadPlaylists, refreshLikedTracks]);

  useEffect(() => {
    if (!album || resolveStarted.current) return;
    resolveStarted.current = true;
    void resolveTracks();
  }, [album, resolveTracks]);

  if (error && !album) return <p className="text-danger-fg">{error}</p>;

  if (!album) {
    return (
      <div className="space-y-6">
        <div className="flex gap-6">
          <div className="size-48 shrink-0 rounded-xl bg-highlight" />
          <div className="flex flex-1 flex-col justify-end gap-3">
            <div className="h-4 w-24 rounded bg-highlight" />
            <div className="h-10 w-2/3 rounded bg-highlight" />
          </div>
        </div>
        <div className="space-y-1">
          {Array.from({ length: 8 }).map((_, i) => (
            <TrackRowSkeleton key={i} />
          ))}
        </div>
      </div>
    );
  }

  const playable = albumPlayableTracks(album);
  const playAll = () => {
    if (playable.length === 0) return;
    void playTrack(playable[0], playable);
  };

  const trackToRow = (track: CatalogTrack): Track => ({
    video_id: track.video_id ?? `pending-${track.position}`,
    title: track.title,
    artist: track.artist_name ?? album.artist_name,
    thumbnail_url: track.thumbnail_url ?? album.cover_url,
    duration_sec: track.duration_sec,
    blocked_reason: track.blocked_reason,
  });

  return (
    <div className="space-y-6">
      <div className="relative -mx-4 -mt-6 overflow-hidden rounded-b-2xl md:-mx-8 md:-mt-8">
        <div className="absolute inset-0 bg-gradient-to-b from-accent-dim/80 via-elevated to-base" />
        <div className="relative flex flex-col gap-6 px-4 py-10 sm:flex-row sm:items-end md:px-8">
          {album.cover_url ? (
            <img
              src={album.cover_url}
              alt=""
              className="size-48 shrink-0 rounded-xl object-cover shadow-elevated sm:size-52"
            />
          ) : (
            <div className="flex size-48 shrink-0 items-center justify-center rounded-xl bg-highlight shadow-elevated sm:size-52" />
          )}
          <div className="min-w-0 flex-1 pb-1">
            <p className="m-0 text-xs font-bold uppercase tracking-widest text-text-secondary">Album</p>
            <h1 className="m-0 text-3xl font-bold tracking-tight md:text-4xl">{album.title}</h1>
            <p className="m-0 mt-1 text-sm text-text-secondary">
              {album.artist_mbid ? (
                <Link to={`/artist/${album.artist_mbid}`} className="text-text hover:underline">
                  {album.artist_name}
                </Link>
              ) : (
                album.artist_name
              )}
              {album.release_date ? ` · ${formatReleaseYear(album.release_date)}` : ""}
            </p>
            <p className="m-0 mt-1 text-sm text-text-secondary">
              {album.tracks.length} {album.tracks.length === 1 ? "track" : "tracks"}
              {resolving ? " · Finding playable versions…" : ""}
            </p>
            <div className="mt-5">
              <Button
                size="lg"
                disabled={playable.length === 0}
                onClick={playAll}
                className="!rounded-full gap-2"
              >
                <Play className="size-5 fill-current" />
                Play
              </Button>
            </div>
          </div>
        </div>
      </div>

      {error ? <p className="text-danger-fg">{error}</p> : null}

      <div className="space-y-0.5">
        {album.tracks.map((track) => {
          const playableTrack = catalogTrackToPlayable(track, album.artist_name);
          const rowTrack = trackToRow(track);
          const disabled = !playableTrack || !!track.blocked_reason;

          return (
            <TrackRowWithActions
              key={`${track.position}-${track.title}`}
              track={rowTrack}
              index={track.position}
              playQueue={playable}
              likedVideoIds={likedVideoIds}
              playlists={playlists}
              disabled={disabled}
              subtitle={
                track.blocked_reason
                  ? `Blocked: ${track.blocked_reason}`
                  : !track.resolved
                    ? resolving
                      ? "Finding playable version…"
                      : "Not available on YouTube"
                    : undefined
              }
              onPlay={() => {
                if (!playableTrack) return;
                void playTrack(playableTrack, playable);
              }}
              onLikedChange={() => void refreshLikedTracks()}
              onPlaylistsChange={() => void loadPlaylists()}
            />
          );
        })}
      </div>
    </div>
  );
}
