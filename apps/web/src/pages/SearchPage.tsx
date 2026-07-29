import { Search as SearchIcon, Settings2, X } from "lucide-react";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { ArtistSearchCard } from "@/components/ArtistSearchCard";
import { SearchOptionsPanel } from "@/components/SearchOptionsPanel";
import { SearchResultGroupRow } from "@/components/SearchResultGroupRow";
import { Button } from "@/components/ui/Button";
import { TrackRowSkeleton } from "@/components/ui/Skeleton";
import { useLikedTracks } from "@/hooks/useLikedTracks";
import { useSearchHistory } from "@/hooks/useSearchHistory";
import { api } from "@/lib/api";
import { cn } from "@/lib/cn";
import { isAbortError } from "@/lib/retry";
import {
  buildMoreVersionsQuery,
  countActiveSearchOptionChanges,
  DEFAULT_SEARCH_OPTIONS,
  loadSessionSearchOptions,
  mergeSearchGroups,
  primaryPlayQueue,
  saveSessionSearchOptions,
} from "@/lib/searchOptions";
import { formatTrackArtist } from "@/lib/tracks";
import { usePlayerStore } from "@/stores/playerStore";
import type { ArtistSearchHit, Playlist, SearchExplanation, SearchOptions, SearchResultGroup, Track } from "@/types";

export function SearchPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const urlQuery = searchParams.get("q") ?? "";
  const [query, setQuery] = useState(urlQuery);
  const [groups, setGroups] = useState<SearchResultGroup[]>([]);
  const [artists, setArtists] = useState<ArtistSearchHit[]>([]);
  const [nextPage, setNextPage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [lastQuery, setLastQuery] = useState<string | null>(null);
  const [pendingQuery, setPendingQuery] = useState<string | null>(null);
  const [inputFocused, setInputFocused] = useState(false);
  const [playlists, setPlaylists] = useState<Playlist[]>([]);
  const [optionsOpen, setOptionsOpen] = useState(false);
  const [sessionOptions, setSessionOptions] = useState<SearchOptions>(
    () => loadSessionSearchOptions() ?? DEFAULT_SEARCH_OPTIONS,
  );
  const [explanation, setExplanation] = useState<SearchExplanation | null>(null);
  const [searchAdvancedHidden, setSearchAdvancedHidden] = useState(false);
  const loadMoreRef = useRef<HTMLDivElement>(null);
  const loadingMoreRef = useRef(false);
  const searchAbortRef = useRef<AbortController | null>(null);
  const loadMoreAbortRef = useRef<AbortController | null>(null);
  const scrollRestoreYRef = useRef<number | null>(null);
  const playTrack = usePlayerStore((s) => s.playTrack);
  const { suggestions, recordQuery, removeQuery, clearHistory } = useSearchHistory(query);
  const { likedVideoIds, refresh: refreshLikedTracks } = useLikedTracks();

  const activeOptionCount = useMemo(
    () => countActiveSearchOptionChanges(sessionOptions, DEFAULT_SEARCH_OPTIONS),
    [sessionOptions],
  );

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
    saveSessionSearchOptions(sessionOptions);
  }, [sessionOptions]);

  const runSearchRequest = useCallback(
    async (trimmed: string, options: SearchOptions, pageToken?: string | null, signal?: AbortSignal) => {
      return api.search(trimmed, {
        nextPage: pageToken ?? undefined,
        searchOptions: options,
        signal,
      });
    },
    [],
  );

  const cancelSearch = useCallback(() => {
    searchAbortRef.current?.abort();
    searchAbortRef.current = null;
    setLoading(false);
    setPendingQuery(null);
  }, []);

  const cancelLoadMore = useCallback(() => {
    loadMoreAbortRef.current?.abort();
    loadMoreAbortRef.current = null;
    loadingMoreRef.current = false;
    setLoadingMore(false);
    scrollRestoreYRef.current = null;
  }, []);

  useEffect(() => {
    const trimmed = urlQuery.trim();
    if (!trimmed) {
      searchAbortRef.current?.abort();
      searchAbortRef.current = null;
      setGroups([]);
      setArtists([]);
      setNextPage(null);
      setLastQuery(null);
      setPendingQuery(null);
      setError(null);
      setExplanation(null);
      setLoading(false);
      setLoadingMore(false);
      return;
    }

    searchAbortRef.current?.abort();
    const controller = new AbortController();
    searchAbortRef.current = controller;

    setLoading(true);
    setLoadingMore(false);
    setError(null);
    setPendingQuery(trimmed);

    void (async () => {
      try {
        const page = await runSearchRequest(trimmed, sessionOptions, null, controller.signal);
        if (searchAbortRef.current !== controller) return;
        setGroups(page.groups);
        setArtists(page.artists ?? []);
        setNextPage(page.next_page);
        setExplanation(page.explanation);
        setSearchAdvancedHidden(page.search_advanced_hidden);
        setLastQuery(trimmed);
        recordQuery(trimmed);
      } catch (err) {
        if (isAbortError(err) || searchAbortRef.current !== controller) return;
        setError(err instanceof Error ? err.message : "Search failed");
      } finally {
        if (searchAbortRef.current === controller) {
          searchAbortRef.current = null;
          setLoading(false);
          setPendingQuery(null);
        }
      }
    })();

    return () => {
      controller.abort();
    };
  }, [urlQuery, sessionOptions, recordQuery, runSearchRequest]);

  const loadMore = useCallback(async () => {
    const trimmed = urlQuery.trim();
    if (!trimmed || !nextPage || loadingMoreRef.current || loading) return;

    loadMoreAbortRef.current?.abort();
    const controller = new AbortController();
    loadMoreAbortRef.current = controller;

    loadingMoreRef.current = true;
    setLoadingMore(true);
    setError(null);
    scrollRestoreYRef.current = window.scrollY;

    try {
      const page = await runSearchRequest(trimmed, sessionOptions, nextPage, controller.signal);
      if (loadMoreAbortRef.current !== controller) return;
      setGroups((current) => mergeSearchGroups(current, page.groups));
      setNextPage(page.next_page);
      setExplanation(page.explanation);
    } catch (err) {
      if (isAbortError(err) || loadMoreAbortRef.current !== controller) return;
      scrollRestoreYRef.current = null;
      setError(err instanceof Error ? err.message : "Could not load more results");
    } finally {
      if (loadMoreAbortRef.current === controller) {
        loadMoreAbortRef.current = null;
        loadingMoreRef.current = false;
        setLoadingMore(false);
      }
    }
  }, [urlQuery, nextPage, loading, sessionOptions, runSearchRequest]);

  useLayoutEffect(() => {
    const y = scrollRestoreYRef.current;
    if (y === null) return;
    scrollRestoreYRef.current = null;
    window.scrollTo(0, y);
  }, [groups]);

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
  }, [groups.length, loading, loadingMore, nextPage, loadMore]);

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

  const handlePlayTrack = (track: Track, queue: Track[]) => {
    void playTrack(track, queue);
  };

  const handleMoreVersions = (track: Track) => {
    const nextQuery = buildMoreVersionsQuery(track);
    setSessionOptions((current) => ({ ...current, max_per_song: null }));
    setQuery(nextQuery);
    setSearchParams({ q: nextQuery });
    setOptionsOpen(true);
  };

  const handlePinChannel = async (track: Track) => {
    const artistKey = formatTrackArtist(track.artist);
    const channelName = track.artist?.trim();
    if (!artistKey || artistKey === "Unknown artist" || !channelName) {
      throw new Error("No channel available to pin");
    }
    await api.upsertChannelPin(artistKey, channelName);
  };

  const showSuggestions = inputFocused && suggestions.length > 0 && !loading;
  const playable = primaryPlayQueue(groups);
  const hasResults = groups.length > 0;

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
        {!searchAdvancedHidden ? (
          <Button
            type="button"
            variant="secondary"
            className="relative shrink-0 px-3"
            aria-expanded={optionsOpen}
            aria-label="Search options"
            onClick={() => setOptionsOpen((open) => !open)}
          >
            <Settings2 className="size-5" />
            {activeOptionCount > 0 ? (
              <span className="absolute -right-1 -top-1 flex size-5 items-center justify-center rounded-full bg-accent text-[11px] font-bold text-accent-fg">
                {activeOptionCount}
              </span>
            ) : null}
          </Button>
        ) : null}
        <Button
          type={loading ? "button" : "submit"}
          variant={loading ? "secondary" : "primary"}
          disabled={!loading && !query.trim()}
          className="shrink-0 px-6"
          onClick={loading ? cancelSearch : undefined}
        >
          {loading ? "Cancel" : "Search"}
        </Button>
      </form>

      {optionsOpen && !searchAdvancedHidden ? (
        <SearchOptionsPanel
          value={sessionOptions}
          onChange={setSessionOptions}
          onReset={() => setSessionOptions(DEFAULT_SEARCH_OPTIONS)}
        />
      ) : null}

      {explanation?.messages.length ? (
        <p className="text-sm text-text-secondary">
          {explanation.messages.join(" · ")}
        </p>
      ) : null}

      {loading ? (
        <div className="space-y-1" role="status" aria-live="polite">
          <p className="mb-3 flex items-center gap-2 text-sm text-text-secondary">
            <span className="tf-spinner" aria-hidden="true" />
            Searching for &ldquo;{pendingQuery}&rdquo;&hellip;
          </p>
          {!hasResults
            ? Array.from({ length: 6 }).map((_, i) => <TrackRowSkeleton key={i} />)
            : null}
        </div>
      ) : null}

      {error ? <p className="text-danger-fg">{error}</p> : null}

      {!loading && lastQuery && !hasResults && !error ? (
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
        {groups.map((group) => (
          <SearchResultGroupRow
            key={group.group_key}
            group={group}
            playQueue={playable}
            likedVideoIds={likedVideoIds}
            playlists={playlists}
            onPlayTrack={handlePlayTrack}
            onLikedChange={() => void loadLibraryData()}
            onPlaylistsChange={() => void loadLibraryData()}
            onMoreVersions={handleMoreVersions}
            onPinChannel={(track) => void handlePinChannel(track)}
          />
        ))}
      </div>

      {nextPage ? <div ref={loadMoreRef} className="h-px" aria-hidden="true" /> : null}
      {loadingMore ? (
        <div className="flex items-center gap-3">
          <p className="flex items-center gap-2 text-sm text-text-secondary" role="status" aria-live="polite">
            <span className="tf-spinner" aria-hidden="true" />
            Loading more results&hellip;
          </p>
          <Button type="button" variant="ghost" size="sm" onClick={cancelLoadMore}>
            Cancel
          </Button>
        </div>
      ) : null}
    </div>
  );
}
