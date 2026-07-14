import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Music2, Search } from "lucide-react";
import { MediaCard } from "@/components/MediaCard";
import { TrackRowWithActions } from "@/components/TrackRowWithActions";
import { SectionHeader } from "@/components/ui/SectionHeader";
import { Skeleton, TrackRowSkeleton } from "@/components/ui/Skeleton";
import { useLikedTracks } from "@/hooks/useLikedTracks";
import { api } from "@/lib/api";
import { useAuthStore } from "@/stores/authStore";
import { usePlayerStore } from "@/stores/playerStore";
import type { PlayHistoryEntry, Playlist } from "@/types";

function greeting(): string {
  const hour = new Date().getHours();
  if (hour < 12) return "Good morning";
  if (hour < 18) return "Good afternoon";
  return "Good evening";
}

export function HomePage() {
  const user = useAuthStore((s) => s.user);
  const [history, setHistory] = useState<PlayHistoryEntry[]>([]);
  const [playlists, setPlaylists] = useState<Playlist[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const playTrack = usePlayerStore((s) => s.playTrack);
  const { likedVideoIds, refresh: refreshLikedTracks } = useLikedTracks();

  const loadPlaylists = useCallback(async () => {
    try {
      setPlaylists(await api.listPlaylists());
    } catch {
      /* playlist actions are optional on home */
    }
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setHistory(await api.listHistory());
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load history");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
    void loadPlaylists();
  }, [load, loadPlaylists]);

  const name = user?.display_name?.split(" ")[0];

  return (
    <div className="space-y-8">
      <div>
        <h1 className="m-0 text-3xl font-bold tracking-tight md:text-4xl">
          {greeting()}
          {name ? `, ${name}` : ""}
        </h1>
        <p className="mt-2 text-text-secondary">Pick up where you left off</p>
      </div>

      {error ? <p className="text-danger-fg">{error}</p> : null}

      {loading ? (
        <div className="space-y-6">
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="space-y-3">
                <Skeleton className="aspect-square w-full rounded-lg" />
                <Skeleton className="h-3.5 w-3/4" />
                <Skeleton className="h-3 w-1/2" />
              </div>
            ))}
          </div>
          <div className="space-y-1">
            {Array.from({ length: 4 }).map((_, i) => (
              <TrackRowSkeleton key={i} />
            ))}
          </div>
        </div>
      ) : history.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-2xl bg-elevated px-6 py-16 text-center">
          <div className="mb-4 flex size-16 items-center justify-center rounded-full bg-highlight text-accent">
            <Music2 className="size-8" />
          </div>
          <h2 className="m-0 text-xl font-bold">No listening history yet</h2>
          <p className="mt-2 max-w-sm text-text-secondary">
            Play something from Search to build your recently played list.
          </p>
          <Link
            to="/search"
            className="mt-6 inline-flex items-center gap-2 rounded-full bg-accent px-5 py-2.5 text-sm font-bold text-accent-fg transition hover:bg-accent-hover"
          >
            <Search className="size-4" />
            Search music
          </Link>
        </div>
      ) : (
        <>
          <section>
            <SectionHeader title="Recently played" />
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
              {history.slice(0, 10).map((item) => (
                <MediaCard
                  key={`card-${item.id}`}
                  title={item.title}
                  subtitle={item.artist ?? "Unknown artist"}
                  videoId={item.video_id}
                  onPlay={() => void playTrack(item, history)}
                />
              ))}
            </div>
          </section>

          {history.length > 5 ? (
            <section>
              <SectionHeader title="Jump back in" />
              <div className="space-y-0.5">
                {history.map((item) => (
                  <TrackRowWithActions
                    key={item.id}
                    track={item}
                    playQueue={history}
                    likedVideoIds={likedVideoIds}
                    playlists={playlists}
                    onPlay={() => void playTrack(item, history)}
                    onLikedChange={() => void refreshLikedTracks()}
                    onPlaylistsChange={() => void loadPlaylists()}
                  />
                ))}
              </div>
            </section>
          ) : null}
        </>
      )}
    </div>
  );
}
