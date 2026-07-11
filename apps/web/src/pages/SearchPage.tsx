import { useState } from "react";
import { TrackRow } from "@/components/TrackRow";
import { api } from "@/lib/api";
import { usePlayerStore } from "@/stores/playerStore";
import type { Track } from "@/types";

export function SearchPage() {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Track[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [lastQuery, setLastQuery] = useState<string | null>(null);
  const playTrack = usePlayerStore((s) => s.playTrack);

  const runSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = query.trim();
    if (!trimmed) return;
    setLoading(true);
    setError(null);
    setLastQuery(trimmed);
    setResults([]);
    try {
      setResults(await api.search(trimmed));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Search failed");
    } finally {
      setLoading(false);
    }
  };

  const playable = results.filter((t) => !t.blocked_reason);

  return (
    <div className="page">
      <h1>Search</h1>
      <form className="search-row" onSubmit={(e) => void runSearch(e)}>
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
          subtitle={track.blocked_reason ? `Blocked: ${track.blocked_reason}` : undefined}
          disabled={!!track.blocked_reason}
          onClick={() => void playTrack(track, playable)}
        />
      ))}
    </div>
  );
}
