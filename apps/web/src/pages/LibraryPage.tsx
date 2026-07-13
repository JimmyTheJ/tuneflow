import { Heart, Plus } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { MediaCard } from "@/components/MediaCard";
import { TrackRow } from "@/components/TrackRow";
import { Button } from "@/components/ui/Button";
import { SectionHeader } from "@/components/ui/SectionHeader";
import { MediaCardSkeleton, TrackRowSkeleton } from "@/components/ui/Skeleton";
import { api } from "@/lib/api";
import { usePlayerStore } from "@/stores/playerStore";
import type { LikeEntry, Playlist } from "@/types";

export function LibraryPage() {
  const [playlists, setPlaylists] = useState<Playlist[]>([]);
  const [likes, setLikes] = useState<LikeEntry[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const playTrack = usePlayerStore((s) => s.playTrack);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [p, l] = await Promise.all([api.listPlaylists(), api.listLikes()]);
      setPlaylists(p);
      setLikes(l);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load library");
    } finally {
      setLoading(false);
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
    <div className="space-y-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="m-0 text-3xl font-bold tracking-tight md:text-4xl">Your library</h1>
        <Button variant="secondary" size="sm" onClick={() => void createPlaylist()}>
          <Plus className="size-4" />
          New playlist
        </Button>
      </div>

      {error ? <p className="text-danger-fg">{error}</p> : null}

      {loading ? (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
          {Array.from({ length: 6 }).map((_, i) => (
            <MediaCardSkeleton key={i} />
          ))}
        </div>
      ) : (
        <>
          <section>
            <SectionHeader title="Playlists" />
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
              <MediaCard
                title="Liked Songs"
                subtitle={`${likes.length} songs`}
                accent
                onPlay={
                  likes.length > 0 ? () => void playTrack(likes[0], likes) : undefined
                }
                cover={
                  <div className="flex size-full items-center justify-center bg-gradient-to-br from-violet-500 via-purple-700 to-indigo-950">
                    <Heart className="size-12 fill-white text-white" />
                  </div>
                }
              />
              {playlists.map((p) => (
                <MediaCard
                  key={p.id}
                  title={p.name}
                  subtitle={`${p.track_count} tracks`}
                  href={`/playlist/${p.id}`}
                />
              ))}
            </div>
          </section>

          <section>
            <SectionHeader title="Liked songs" subtitle={`${likes.length} songs`} />
            {likes.length === 0 ? (
              <p className="text-text-secondary">Songs you like will appear here.</p>
            ) : (
              <div className="space-y-0.5">
                {likes.map((like, i) => (
                  <TrackRow
                    key={like.id}
                    track={like}
                    index={i + 1}
                    onClick={() => void playTrack(like, likes)}
                  />
                ))}
              </div>
            )}
          </section>
        </>
      )}

      {loading ? (
        <div className="space-y-1">
          {Array.from({ length: 4 }).map((_, i) => (
            <TrackRowSkeleton key={i} />
          ))}
        </div>
      ) : null}
    </div>
  );
}
