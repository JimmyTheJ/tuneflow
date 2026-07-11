import { useCallback, useRef, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";

import { TrackRow } from "@/components/TrackRow";
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
  const loadingMoreRef = useRef(false);
  const playTrack = usePlayerStore((state) => state.playTrack);
  const { suggestions, recordQuery, removeQuery, clearHistory } = useSearchHistory(query);

  const runSearch = async (searchText?: string) => {
    const trimmed = (searchText ?? query).trim();
    if (!trimmed) {
      return;
    }
    setQuery(trimmed);
    setInputFocused(false);
    setLoading(true);
    setLoadingMore(false);
    setError(null);
    setNextPage(null);
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
    if (!trimmed || !nextPage || loadingMoreRef.current || loading) {
      return;
    }

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
    <View style={styles.container}>
      <View style={styles.searchRow}>
        <TextInput
          value={query}
          onChangeText={setQuery}
          placeholder="Search songs, artists..."
          placeholderTextColor="#737373"
          style={styles.input}
          onFocus={() => setInputFocused(true)}
          onBlur={() => setInputFocused(false)}
          onSubmitEditing={() => void runSearch()}
          returnKeyType="search"
        />
        <Pressable style={styles.button} onPress={() => void runSearch()}>
          <Text style={styles.buttonText}>Go</Text>
        </Pressable>
      </View>

      {showSuggestions ? (
        <View style={styles.suggestions}>
          {!query.trim() ? (
            <View style={styles.suggestionsHeader}>
              <Text style={styles.suggestionsTitle}>Recent searches</Text>
              <Pressable onPress={clearHistory} hitSlop={8}>
                <Text style={styles.suggestionsClear}>Clear</Text>
              </Pressable>
            </View>
          ) : null}
          {suggestions.map((suggestion) => (
            <View key={suggestion.text} style={styles.suggestionRow}>
              <Pressable
                style={styles.suggestionButton}
                onPress={() => void runSearch(suggestion.text)}
              >
                <Text style={styles.suggestionText}>{suggestion.text}</Text>
              </Pressable>
              {!query.trim() ? (
                <Pressable
                  style={styles.suggestionRemove}
                  onPress={() => removeQuery(suggestion.text)}
                  hitSlop={8}
                  accessibilityLabel={`Remove ${suggestion.text}`}
                >
                  <Text style={styles.suggestionRemoveText}>×</Text>
                </Pressable>
              ) : null}
            </View>
          ))}
        </View>
      ) : null}

      {loading ? <ActivityIndicator color="#22c55e" style={{ marginTop: 24 }} /> : null}
      {error ? <Text style={styles.error}>{error}</Text> : null}

      <FlatList
        data={results}
        keyExtractor={(item) => item.video_id}
        renderItem={({ item }) => (
          <TrackRow
            track={item}
            displayTitle={item.source_title ?? item.title}
            showBadges
            subtitle={item.blocked_reason ? `Blocked: ${item.blocked_reason}` : item.artist ?? "Unknown artist"}
            onPress={
              item.blocked_reason ? undefined : () => void playTrack(item, playable)
            }
          />
        )}
        onEndReached={() => void loadMore()}
        onEndReachedThreshold={0.4}
        ListFooterComponent={
          loadingMore ? <ActivityIndicator color="#22c55e" style={{ marginVertical: 20 }} /> : null
        }
        ListEmptyComponent={
          !loading && !showSuggestions ? (
            <Text style={styles.empty}>Search YouTube’s music catalog via your server.</Text>
          ) : null
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#0a0a0a",
    paddingHorizontal: 16,
    paddingTop: 8,
  },
  searchRow: {
    flexDirection: "row",
    gap: 8,
    marginBottom: 12,
  },
  input: {
    flex: 1,
    backgroundColor: "#171717",
    color: "#fff",
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 16,
  },
  button: {
    backgroundColor: "#22c55e",
    borderRadius: 12,
    paddingHorizontal: 16,
    justifyContent: "center",
  },
  buttonText: {
    color: "#052e16",
    fontWeight: "700",
    fontSize: 15,
  },
  empty: {
    color: "#737373",
    marginTop: 24,
    fontSize: 15,
  },
  error: {
    color: "#f87171",
    marginBottom: 8,
  },
  suggestions: {
    backgroundColor: "#171717",
    borderRadius: 12,
    marginBottom: 12,
    overflow: "hidden",
  },
  suggestionsHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: "#262626",
  },
  suggestionsTitle: {
    color: "#737373",
    fontSize: 12,
    fontWeight: "600",
    letterSpacing: 0.4,
    textTransform: "uppercase",
  },
  suggestionsClear: {
    color: "#a3a3a3",
    fontSize: 13,
    fontWeight: "600",
  },
  suggestionRow: {
    flexDirection: "row",
    alignItems: "center",
  },
  suggestionButton: {
    flex: 1,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  suggestionText: {
    color: "#e5e5e5",
    fontSize: 16,
  },
  suggestionRemove: {
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  suggestionRemoveText: {
    color: "#737373",
    fontSize: 20,
    lineHeight: 20,
  },
});
