import { Ionicons } from "@expo/vector-icons";
import { useCallback, useRef, useState } from "react";
import {
  FlatList,
  Pressable,
  Text,
  TextInput,
  View,
} from "react-native";

import { TrackRow } from "@/components/TrackRow";
import { Button } from "@/components/ui/Button";
import { TrackRowSkeleton } from "@/components/ui/Skeleton";
import { useSearchHistory } from "@/hooks/useSearchHistory";
import { api } from "@/lib/api";
import { usePlayerStore } from "@/stores/player";
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

export default function SearchScreen() {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Track[]>([]);
  const [nextPage, setNextPage] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [inputFocused, setInputFocused] = useState(false);
  const [lastQuery, setLastQuery] = useState<string | null>(null);
  const loadingMoreRef = useRef(false);
  const endReachedGuardRef = useRef(false);
  const playTrack = usePlayerStore((state) => state.playTrack);
  const { suggestions, recordQuery, removeQuery, clearHistory } = useSearchHistory(query);

  const runSearch = async (searchText?: string) => {
    const trimmed = (searchText ?? query).trim();
    if (!trimmed) return;
    setQuery(trimmed);
    setInputFocused(false);
    setLoading(true);
    setLoadingMore(false);
    setError(null);
    setNextPage(null);
    setLastQuery(trimmed);
    endReachedGuardRef.current = false;
    try {
      const page = await api.search(trimmed);
      setResults(page.results);
      setNextPage(page.next_page);
      recordQuery(trimmed);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Search failed");
      setResults([]);
      setNextPage(null);
    } finally {
      setLoading(false);
    }
  };

  const loadMore = useCallback(async () => {
    const trimmed = query.trim();
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
  }, [query, nextPage, loading]);

  const showSuggestions = inputFocused && suggestions.length > 0 && !loading;
  const playable = results.filter((track) => !track.blocked_reason);

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
          onPress={() => void runSearch()}
          disabled={loading || !query.trim()}
          loading={loading}
          className="px-5"
        >
          Search
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
            Searching for &ldquo;{lastQuery}&rdquo;…
          </Text>
          {Array.from({ length: 6 }).map((_, i) => (
            <TrackRowSkeleton key={i} />
          ))}
        </View>
      ) : null}

      {error ? <Text className="mb-2 text-danger-fg">{error}</Text> : null}

      {!loading && lastQuery && results.length === 0 && !error ? (
        <Text className="text-text-muted">No results for &ldquo;{lastQuery}&rdquo;.</Text>
      ) : null}

      <FlatList
        data={results}
        keyExtractor={(item) => item.video_id}
        renderItem={({ item }) => (
          <TrackRow
            track={item}
            displayTitle={item.source_title ?? item.title}
            showBadges
            subtitle={
              item.blocked_reason
                ? `Blocked: ${item.blocked_reason}`
                : (item.artist ?? "Unknown artist")
            }
            onPress={item.blocked_reason ? undefined : () => void playTrack(item, playable)}
          />
        )}
        onEndReached={() => {
          if (endReachedGuardRef.current || loadingMoreRef.current || loading || !nextPage) return;
          endReachedGuardRef.current = true;
          void loadMore();
        }}
        onEndReachedThreshold={0.4}
        onMomentumScrollBegin={() => {
          endReachedGuardRef.current = false;
        }}
        onScrollBeginDrag={() => {
          endReachedGuardRef.current = false;
        }}
        ListFooterComponent={
          loadingMore ? (
            <Text className="my-4 text-center text-sm text-text-secondary">Loading more…</Text>
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
