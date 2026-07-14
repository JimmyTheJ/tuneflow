import { Search as SearchIcon, X } from "lucide-react";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { ArtistSearchCard } from "@/components/ArtistSearchCard";
import { TrackRowWithActions } from "@/components/TrackRowWithActions";
import { Button } from "@/components/ui/Button";
import { TrackRowSkeleton } from "@/components/ui/Skeleton";
import { useLikedTracks } from "@/hooks/useLikedTracks";
import { useSearchHistory } from "@/hooks/useSearchHistory";
import { api } from "@/lib/api";
import { cn } from "@/lib/cn";
import { usePlayerStore } from "@/stores/playerStore";
import type { ArtistSearchHit, Playlist, Track } from "@/types";

function mergeTracks(existing: Track[], incoming: Track[]): Track[] {
  const seen = new Set(existing.map((track) => track.video_id));
  const merged = [...existing];
  for (const track of incoming) {
    if (seen.has(track.video_id)) continue;
    seen.add(track.video_id);
    merged.push(track);
  }
  return merged;
}

export function SearchPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const urlQuery = searchParams.get("q") ?? "";
  const [query, setQuery] = useState(urlQuery);
  const [results, setResults] = useState<Track[]>([]);
  const [artists, setArtists] = useState<ArtistSearchHit[]>([]);
  const [nextPage, setNextPage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [lastQuery, setLastQuery] = useState<string | null>(null);
  const [inputFocused, setInputFocused] = useState(false);
  const [playlists, setPlaylists] = useState<Playlist[]>([]);
  const loadMoreRef = useRef<HTMLDivElement>(null);
  const loadingMoreRef = useRef(false);
  const scrollRestoreYRef = useRef<number | null>(null);
  const playTrack = usePlayerStore((s) => s.playTrack);
  const { suggestions, recordQuery, removeQuery, clearHistory } = useSearchHistory(query);
  const { likedVideoIds, refresh: refreshLikedTracks } = useLikedTracks();

  const loadPlaylists = useCallback(async () => {
    try {
      setPlaylists(await api.listPlaylists());
    } catch {
      /* playlist actions are optional on search */
    }
  }, []);

  useEffect(() => {
    void loadPlaylists();
  }, [loadPlaylists]);

  const loadLibraryData = useCallback(async () => {
    await Promise.all([refreshLikedTracks(), loadPlaylists()]);
  }, [loadPlaylists, refreshLikedTracks]);

  useEffect(() => {
    setQuery(urlQuery);
  }, [urlQuery]);

  useEffect(() => {
    const trimmed = urlQuery.trim();
    if (!trimmed) {
      setResults([]);
      setArtists([]);
      setNextPage(null);
      setLastQuery(null);
      setError(null);
      setLoading(false);
      setLoadingMore(false);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setLoadingMore(false);
    setError(null);
    setLastQuery(trimmed);
    setResults([]);
    setArtists([]);
    setNextPage(null);

    void (async () => {
      try {
        const page = await api.search(trimmed);
        if (!cancelled) {
          setResults(page.results);
          setArtists(page.artists ?? []);
          setNextPage(page.next_page);
          recordQuery(trimmed);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Search failed");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [urlQuery, recordQuery]);

  const loadMore = useCallback(async () => {
    const trimmed = urlQuery.trim();
    if (!trimmed || !nextPage || loadingMoreRef.current || loading) return;

    loadingMoreRef.current = true;
    setLoadingMore(true);
    setError(null);
    scrollRestoreYRef.current = window.scrollY;

    try {
      const page = await api.search(trimmed, { nextPage });
      setResults((current) => mergeTracks(current, page.results));
      setNextPage(page.next_page);
    } catch (err) {
      scrollRestoreYRef.current = null;
      setError(err instanceof Error ? err.message : "Could not load more results");
    } finally {
      loadingMoreRef.current = false;
      setLoadingMore(false);
    }
  }, [urlQuery, nextPage, loading]);

  useLayoutEffect(() => {
    const y = scrollRestoreYRef.current;
    if (y === null) return;
    scrollRestoreYRef.current = null;
    window.scrollTo(0, y);
  }, [results]);

  useEffect(() => {
    const node = loadMoreRef.current;
    if (!node || !nextPage || loading || loadingMore) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) {
          void loadMore();
        }
      },
      { rootMargin: "240px" },
    );

    observer.observe(node);
    return () => observer.disconnect();
  }, [loadMore, nextPage, loading, loadingMore]);

  useEffect(() => {
    if (loading || loadingMore || !nextPage) return;
    const doc = document.documentElement;
    if (doc.scrollHeight > window.innerHeight) return;
    void loadMore();
  }, [results.length, loading, loadingMore, nextPage, loadMore]);

  const runSearch = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = query.trim();
    if (!trimmed) return;
    setInputFocused(false);
    if (trimmed !== urlQuery.trim()) {
      setSearchParams({ q: trimmed });
    }
  };

  const selectSuggestion = (text: string) => {
    setQuery(text);
    setInputFocused(false);
    setSearchParams({ q: text });
  };

  const showSuggestions = inputFocused && suggestions.length > 0 && !loading;
  const playable = results.filter((t) => !t.blocked_reason);

  return (
    <div className="space-y-6">
      <h1 className="m-0 text-3xl font-bold tracking-tight md:text-4xl">Search</h1>

      <form className="relative flex gap-2" onSubmit={runSearch}>
        <div className="relative flex-1">
          <SearchIcon className="pointer-events-none absolute left-4 top-1/2 size-5 -translate-y-1/2 text-text-muted" />
          <input
            className={cn(
              "w-full rounded-full border border-border bg-elevated py-3.5 pl-12 pr-4 text-text",
              "placeholder:text-text-muted transition-colors",
              "focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/30",
              "disabled:opacity-50",
            )}
            placeholder="What do you want to listen to?"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onFocus={() => setInputFocused(true)}
            onBlur={() => {
              window.setTimeout(() => setInputFocused(false), 150);
            }}
            disabled={loading}
            aria-busy={loading}
            aria-autocomplete="list"
            aria-expanded={showSuggestions}
            aria-controls="search-suggestions"
            role="combobox"
          />
          {showSuggestions ? (
            <div
              id="search-suggestions"
              className="absolute left-0 right-0 top-[calc(100%+6px)] z-20 overflow-hidden rounded-xl border border-border bg-elevated shadow-elevated"
              role="listbox"
            >
              {!query.trim() ? (
                <div className="flex items-center justify-between border-b border-border px-4 py-2.5 text-xs font-semibold uppercase tracking-wide text-text-muted">
                  <span>Recent searches</span>
                  <button
                    className="border-0 bg-transparent text-xs font-semibold normal-case tracking-normal text-text-secondary hover:text-text cursor-pointer"
                    type="button"
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={clearHistory}
                  >
                    Clear
                  </button>
                </div>
              ) : null}
              <ul className="m-0 list-none p-1">
                {suggestions.map((suggestion) => (
                  <li key={suggestion.text} className="flex items-center" role="option">
                    <button
                      className="min-w-0 flex-1 cursor-pointer border-0 bg-transparent px-3 py-2.5 text-left text-sm text-text hover:bg-highlight rounded-lg"
                      type="button"
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => selectSuggestion(suggestion.text)}
                    >
                      {suggestion.text}
                    </button>
                    {!query.trim() ? (
                      <button
                        className="cursor-pointer border-0 bg-transparent px-3 py-2 text-text-muted hover:text-text"
                        type="button"
                        aria-label={`Remove ${suggestion.text}`}
                        onMouseDown={(e) => e.preventDefault()}
                        onClick={() => removeQuery(suggestion.text)}
                      >
                        <X className="size-4" />
                      </button>
                    ) : null}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>
        <Button type="submit" disabled={loading || !query.trim()} className="shrink-0 px-6">
          {loading ? "Searching…" : "Search"}
        </Button>
      </form>

      {loading ? (
        <div className="space-y-1" role="status" aria-live="polite">
          <p className="mb-3 flex items-center gap-2 text-sm text-text-secondary">
            <span className="tf-spinner" aria-hidden="true" />
            Searching for &ldquo;{lastQuery}&rdquo;&hellip;
          </p>
          {Array.from({ length: 6 }).map((_, i) => (
            <TrackRowSkeleton key={i} />
          ))}
        </div>
      ) : null}

      {error ? <p className="text-danger-fg">{error}</p> : null}

      {!loading && lastQuery && results.length === 0 && !error ? (
        <p className="text-text-muted">No results for &ldquo;{lastQuery}&rdquo;.</p>
      ) : null}

      {!loading && artists.length > 0 ? (
        <div className="space-y-3">
          {artists.map((artist) => (
            <ArtistSearchCard key={artist.mbid} artist={artist} />
          ))}
        </div>
      ) : null}

      <div className="space-y-0.5 [overflow-anchor:none]">
        {results.map((track) => (
          <TrackRowWithActions
            key={track.video_id}
            track={track}
            playQueue={playable}
            likedVideoIds={likedVideoIds}
            playlists={playlists}
            displayTitle={track.source_title ?? track.title}
            showBadges
            subtitle={track.blocked_reason ? `Blocked: ${track.blocked_reason}` : undefined}
            disabled={!!track.blocked_reason}
            onPlay={() => void playTrack(track, playable)}
            onLikedChange={() => void loadLibraryData()}
            onPlaylistsChange={() => void loadLibraryData()}
          />
        ))}
      </div>

      {nextPage ? <div ref={loadMoreRef} className="h-px" aria-hidden="true" /> : null}
      {loadingMore ? (
        <p className="flex items-center gap-2 text-sm text-text-secondary" role="status" aria-live="polite">
          <span className="tf-spinner" aria-hidden="true" />
          Loading more results&hellip;
        </p>
      ) : null}
    </div>
  );
}
