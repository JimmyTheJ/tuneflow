import { useCallback, useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { TrackRow } from "@/components/TrackRow";
import { api } from "@/lib/api";
import { usePlayerStore } from "@/stores/playerStore";
import type { Track } from "@/types";

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
  const [nextPage, setNextPage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [lastQuery, setLastQuery] = useState<string | null>(null);
  const loadMoreRef = useRef<HTMLDivElement>(null);
  const loadingMoreRef = useRef(false);
  const playTrack = usePlayerStore((s) => s.playTrack);

  useEffect(() => {
    setQuery(urlQuery);
  }, [urlQuery]);

  useEffect(() => {
    const trimmed = urlQuery.trim();
    if (!trimmed) {
      setResults([]);
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
    setNextPage(null);

    void (async () => {
      try {
        const page = await api.search(trimmed);
        if (!cancelled) {
          setResults(page.results);
          setNextPage(page.next_page);
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
  }, [urlQuery]);

  const loadMore = useCallback(async () => {
    const trimmed = urlQuery.trim();
    if (!trimmed || !nextPage || loadingMoreRef.current || loading) return;

    loadingMoreRef.current = true;
    setLoadingMore(true);
    setError(null);

    try {
      const page = await api.search(trimmed, { nextPage });
      setResults((current) => mergeTracks(current, page.results));
      setNextPage(page.next_page);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load more results");
    } finally {
      loadingMoreRef.current = false;
      setLoadingMore(false);
    }
  }, [urlQuery, nextPage, loading]);

  useEffect(() => {
    const node = loadMoreRef.current;
    if (!node || !nextPage || loading) return;

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
  }, [loadMore, nextPage, loading, results.length]);

  const runSearch = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = query.trim();
    if (!trimmed) return;
    if (trimmed !== urlQuery.trim()) {
      setSearchParams({ q: trimmed });
    }
  };

  const playable = results.filter((t) => !t.blocked_reason);

  return (
    <div className="page">
      <h1>Search</h1>
      <form className="search-row" onSubmit={runSearch}>
        <input
          className="input"
          placeholder="Search songs, artists…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          disabled={loading}
          aria-busy={loading}
        />
        <button className="btn-primary" type="submit" disabled={loading || !query.trim()}>
          {loading ? "Searching…" : "Go"}
        </button>
      </form>
      {loading ? (
        <p className="search-status" role="status" aria-live="polite">
          <span className="search-spinner" aria-hidden="true" />
          Searching for &ldquo;{lastQuery}&rdquo;&hellip;
        </p>
      ) : null}
      {error ? <p className="error">{error}</p> : null}
      {!loading && lastQuery && results.length === 0 && !error ? (
        <p className="search-status search-status-empty">No results for &ldquo;{lastQuery}&rdquo;.</p>
      ) : null}
      {results.map((track) => (
        <TrackRow
          key={track.video_id}
          track={track}
          displayTitle={track.source_title ?? track.title}
          showBadges
          subtitle={track.blocked_reason ? `Blocked: ${track.blocked_reason}` : undefined}
          disabled={!!track.blocked_reason}
          onClick={() => void playTrack(track, playable)}
        />
      ))}
      {nextPage ? <div ref={loadMoreRef} className="search-load-sentinel" aria-hidden="true" /> : null}
      {loadingMore ? (
        <p className="search-status" role="status" aria-live="polite">
          <span className="search-spinner" aria-hidden="true" />
          Loading more results&hellip;
        </p>
      ) : null}
    </div>
  );
}
