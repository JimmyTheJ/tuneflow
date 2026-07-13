import { Play } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { PlaylistDownloadButton } from "@/components/PlaylistDownloadButton";
import { TrackRow } from "@/components/TrackRow";
import { TrackThumb } from "@/components/TrackThumb";
import { Button } from "@/components/ui/Button";
import { Skeleton, TrackRowSkeleton } from "@/components/ui/Skeleton";
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

  if (error) return <p className="text-danger-fg">{error}</p>;

  if (!playlist) {
    return (
      <div className="space-y-6">
        <div className="flex gap-6">
          <Skeleton className="size-48 shrink-0 rounded-xl" />
          <div className="flex flex-1 flex-col justify-end gap-3">
            <Skeleton className="h-4 w-24" />
            <Skeleton className="h-10 w-2/3" />
            <Skeleton className="h-4 w-32" />
          </div>
        </div>
        <div className="space-y-1">
          {Array.from({ length: 6 }).map((_, i) => (
            <TrackRowSkeleton key={i} />
          ))}
        </div>
      </div>
    );
  }

  const coverId = playlist.tracks[0]?.video_id;
  const playAll = () => {
    if (playlist.tracks.length === 0) return;
    void playTrack(playlist.tracks[0], playlist.tracks);
  };

  return (
    <div className="space-y-6">
      <div className="relative -mx-4 -mt-6 overflow-hidden rounded-b-2xl md:-mx-8 md:-mt-8">
        <div className="absolute inset-0 bg-gradient-to-b from-accent-dim/80 via-elevated to-base" />
        <div className="relative flex flex-col gap-6 px-4 py-10 sm:flex-row sm:items-end md:px-8">
          {coverId ? (
            <TrackThumb
              videoId={coverId}
              className="size-48 shrink-0 rounded-xl shadow-elevated sm:size-52"
              fallbackClassName="size-48 shrink-0 rounded-xl shadow-elevated sm:size-52"
            />
          ) : (
            <div className="flex size-48 shrink-0 items-center justify-center rounded-xl bg-highlight shadow-elevated sm:size-52" />
          )}
          <div className="min-w-0 flex-1 pb-1">
            <p className="m-0 text-xs font-bold uppercase tracking-widest text-text-secondary">
              Playlist
            </p>
            <h1 className="mt-2 mb-2 text-4xl font-extrabold tracking-tight md:text-5xl">
              {playlist.name}
            </h1>
            <p className="m-0 text-sm text-text-secondary">
              {playlist.tracks.length} {playlist.tracks.length === 1 ? "track" : "tracks"}
            </p>
            <div className="mt-5 flex flex-wrap items-start gap-3">
              <Button
                size="lg"
                disabled={playlist.tracks.length === 0}
                onClick={playAll}
                className="!rounded-full gap-2"
              >
                <Play className="size-5 fill-current" />
                Play
              </Button>
              <PlaylistDownloadButton playlist={playlist} />
            </div>
          </div>
        </div>
      </div>

      <div className="space-y-0.5">
        {playlist.tracks.map((track, i) => (
          <TrackRow
            key={track.id}
            track={track}
            index={i + 1}
            onClick={() => void playTrack(track, playlist.tracks)}
          />
        ))}
      </div>
    </div>
  );
}
