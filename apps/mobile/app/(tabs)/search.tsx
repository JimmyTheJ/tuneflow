import { Ionicons } from "@expo/vector-icons";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  FlatList,
  Pressable,
  Text,
  TextInput,
  View,
} from "react-native";

import { ArtistSearchCard } from "@/components/ArtistSearchCard";
import { TrackRowWithActions } from "@/components/TrackRowWithActions";
import { Button } from "@/components/ui/Button";
import { TrackRowSkeleton } from "@/components/ui/Skeleton";
import { useSearchHistory } from "@/hooks/useSearchHistory";
import { api } from "@/lib/api";
import { isAbortError } from "@/lib/retry";
import {
  DEFAULT_SEARCH_OPTIONS,
  flattenGroupTracks,
  mergeSearchGroups,
  primaryPlayQueue,
} from "@/lib/searchOptions";
import { formatSearchSubtitle } from "@/lib/tracks";
import { usePlayerStore } from "@/stores/player";
import type { ArtistSearchHit, Playlist, SearchPlayOnSelect, SearchResultGroup, Track } from "@/types";

export default function SearchScreen() {
  const [query, setQuery] = useState("");
  const [groups, setGroups] = useState<SearchResultGroup[]>([]);
  const [artists, setArtists] = useState<ArtistSearchHit[]>([]);
  const [playlists, setPlaylists] = useState<Playlist[]>([]);
  const [nextPage, setNextPage] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [inputFocused, setInputFocused] = useState(false);
  const [lastQuery, setLastQuery] = useState<string | null>(null);
  const [pendingQuery, setPendingQuery] = useState<string | null>(null);
  const [sessionOptions] = useState(DEFAULT_SEARCH_OPTIONS);
  const [explanation, setExplanation] = useState<string | null>(null);
  const [playOnSelect, setPlayOnSelect] = useState<SearchPlayOnSelect>(
    DEFAULT_SEARCH_OPTIONS.play_on_select,
  );
  const loadingMoreRef = useRef(false);
  const searchAbortRef = useRef<AbortController | null>(null);
  const loadMoreAbortRef = useRef<AbortController | null>(null);
  const listRef = useRef<FlatList<Track>>(null);
  const scrollOffsetRef = useRef(0);
  const playTrack = usePlayerStore((state) => state.playTrack);
  const { suggestions, recordQuery, removeQuery, clearHistory } = useSearchHistory(query);

  const loadPlaylists = useCallback(async () => {
    try {
      setPlaylists(await api.listPlaylists());
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    void loadPlaylists();
  }, [loadPlaylists]);

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
  }, []);

  const runSearch = async (searchText?: string) => {
    const trimmed = (searchText ?? query).trim();
    if (!trimmed) return;

    searchAbortRef.current?.abort();
    const controller = new AbortController();
    searchAbortRef.current = controller;

    setQuery(trimmed);
    setInputFocused(false);
    setLoading(true);
    setLoadingMore(false);
    setError(null);
    setNextPage(null);
    setPendingQuery(trimmed);

    try {
      const page = await api.search(trimmed, { searchOptions: sessionOptions, signal: controller.signal });
      if (searchAbortRef.current !== controller) return;
      setGroups(page.groups);
      setArtists(page.artists ?? []);
      setNextPage(page.next_page);
      setExplanation(page.explanation?.messages.join(" · ") ?? null);
      setPlayOnSelect(page.effective_options.play_on_select ?? DEFAULT_SEARCH_OPTIONS.play_on_select);
      setLastQuery(trimmed);
      recordQuery(trimmed);
    } catch (err) {
      if (isAbortError(err) || searchAbortRef.current !== controller) return;
      setError(err instanceof Error ? err.message : "Search failed");
      setGroups([]);
      setArtists([]);
      setNextPage(null);
    } finally {
      if (searchAbortRef.current === controller) {
        searchAbortRef.current = null;
        setLoading(false);
        setPendingQuery(null);
      }
    }
  };

  const loadMore = useCallback(async () => {
    const trimmed = query.trim();
    if (!trimmed || !nextPage || loadingMoreRef.current || loading) return;

    loadMoreAbortRef.current?.abort();
    const controller = new AbortController();
    loadMoreAbortRef.current = controller;

    loadingMoreRef.current = true;
    setLoadingMore(true);
    setError(null);

    try {
      const page = await api.search(trimmed, {
        nextPage,
        searchOptions: sessionOptions,
        signal: controller.signal,
      });
      if (loadMoreAbortRef.current !== controller) return;
      setGroups((current) => mergeSearchGroups(current, page.groups));
      setNextPage(page.next_page);
      setExplanation(page.explanation?.messages.join(" · ") ?? null);
    } catch (err) {
      if (isAbortError(err) || loadMoreAbortRef.current !== controller) return;
      setError(err instanceof Error ? err.message : "Could not load more results");
    } finally {
      if (loadMoreAbortRef.current === controller) {
        loadMoreAbortRef.current = null;
        loadingMoreRef.current = false;
        setLoadingMore(false);
      }
    }
  }, [query, nextPage, loading, sessionOptions]);

  const showSuggestions = inputFocused && suggestions.length > 0 && !loading;
  const results = flattenGroupTracks(groups);
  const playable = primaryPlayQueue(groups);
  const defaultPlayQueue = playOnSelect === "single_track" ? [] : playable;

  return (
    <View className="flex-1 bg-base px-4 pt-2">
      <Text className="mb-3 text-3xl font-bold tracking-tight text-text">Search</Text>

      <View className="mb-3 flex-row items-center gap-2">
        <View className="relative min-w-0 flex-1">
          <Ionicons
            name="search"
            size={18}
            color="#6a6a6a"
            style={{ position: "absolute", left: 14, top: 14, zIndex: 1 }}
          />
          <TextInput
            value={query}
            onChangeText={setQuery}
            placeholder="What do you want to listen to?"
            placeholderTextColor="#6a6a6a"
            className="rounded-full border border-border bg-elevated py-3.5 pl-11 pr-4 text-base text-text"
            onFocus={() => setInputFocused(true)}
            onBlur={() => setInputFocused(false)}
            onSubmitEditing={() => void runSearch()}
            returnKeyType="search"
          />
        </View>
        <Button
          onPress={() => (loading ? cancelSearch() : void runSearch())}
          disabled={!loading && !query.trim()}
          variant={loading ? "secondary" : "primary"}
          className="px-5"
        >
          {loading ? "Cancel" : "Search"}
        </Button>
      </View>

      {showSuggestions ? (
        <View className="mb-3 overflow-hidden rounded-xl border border-border bg-elevated">
          {!query.trim() ? (
            <View className="flex-row items-center justify-between border-b border-border px-4 py-2.5">
              <Text className="text-xs font-semibold uppercase tracking-wide text-text-muted">
                Recent searches
              </Text>
              <Pressable onPress={clearHistory} hitSlop={8}>
                <Text className="text-xs font-semibold text-text-secondary">Clear</Text>
              </Pressable>
            </View>
          ) : null}
          {suggestions.map((suggestion) => (
            <View key={suggestion.text} className="flex-row items-center">
              <Pressable
                className="flex-1 px-4 py-3 active:bg-highlight"
                onPress={() => void runSearch(suggestion.text)}
              >
                <Text className="text-base text-text">{suggestion.text}</Text>
              </Pressable>
              {!query.trim() ? (
                <Pressable
                  className="px-4 py-3"
                  onPress={() => removeQuery(suggestion.text)}
                  hitSlop={8}
                  accessibilityLabel={`Remove ${suggestion.text}`}
                >
                  <Ionicons name="close" size={16} color="#6a6a6a" />
                </Pressable>
              ) : null}
            </View>
          ))}
        </View>
      ) : null}

      {loading ? (
        <View className="gap-1">
          <Text className="mb-2 text-sm text-text-secondary">
            Searching for &ldquo;{pendingQuery}&rdquo;…
          </Text>
          {results.length === 0
            ? Array.from({ length: 6 }).map((_, i) => <TrackRowSkeleton key={i} />)
            : null}
        </View>
      ) : null}

      {error ? <Text className="mb-2 text-danger-fg">{error}</Text> : null}
      {explanation ? <Text className="mb-2 text-sm text-text-secondary">{explanation}</Text> : null}

      {!loading && lastQuery && results.length === 0 && !error ? (
        <Text className="text-text-muted">No results for &ldquo;{lastQuery}&rdquo;.</Text>
      ) : null}

      <FlatList
        ref={listRef}
        data={results}
        keyExtractor={(item) => item.video_id}
        onScroll={(event) => {
          scrollOffsetRef.current = event.nativeEvent.contentOffset.y;
        }}
        scrollEventThrottle={16}
        renderItem={({ item }) => (
          <TrackRowWithActions
            track={item}
            playQueue={defaultPlayQueue}
            playlists={playlists}
            displayTitle={item.source_title ?? item.title}
            showBadges
            subtitle={
              item.blocked_reason
                ? `Blocked: ${item.blocked_reason}`
                : formatSearchSubtitle(item)
            }
            disabled={Boolean(item.blocked_reason)}
            onPlay={() => void playTrack(item, defaultPlayQueue.length > 0 ? defaultPlayQueue : [item])}
            onPlaylistsChange={() => void loadPlaylists()}
          />
        )}
        onEndReached={() => {
          if (loadingMoreRef.current || loading || !nextPage) return;
          void loadMore();
        }}
        onEndReachedThreshold={0.4}
        ListHeaderComponent={
          !loading && artists.length > 0 ? (
            <View className="mb-2">
              {artists.map((artist) => (
                <ArtistSearchCard key={artist.mbid} artist={artist} />
              ))}
            </View>
          ) : null
        }
        ListFooterComponent={
          loadingMore ? (
            <View className="my-4 flex-row items-center justify-center gap-3">
              <Text className="text-sm text-text-secondary">Loading more…</Text>
              <Pressable onPress={cancelLoadMore} hitSlop={8}>
                <Text className="text-sm font-semibold text-text-secondary">Cancel</Text>
              </Pressable>
            </View>
          ) : null
        }
        ListEmptyComponent={
          !loading && !showSuggestions && !lastQuery ? (
            <Text className="mt-6 text-text-muted">
              Search YouTube’s music catalog via your server.
            </Text>
          ) : null
        }
      />
    </View>
  );
}
