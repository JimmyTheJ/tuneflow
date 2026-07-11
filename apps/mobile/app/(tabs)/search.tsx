import { useState } from "react";
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
import { api } from "@/lib/api";
import { usePlayerStore } from "@/stores/player";
import type { Track } from "@/types";

export default function SearchScreen() {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Track[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const playTrack = usePlayerStore((state) => state.playTrack);

  const runSearch = async () => {
    if (!query.trim()) {
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const tracks = await api.search(query.trim());
      setResults(tracks);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Search failed");
    } finally {
      setLoading(false);
    }
  };

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
          onSubmitEditing={() => void runSearch()}
          returnKeyType="search"
        />
        <Pressable style={styles.button} onPress={() => void runSearch()}>
          <Text style={styles.buttonText}>Go</Text>
        </Pressable>
      </View>

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
        ListEmptyComponent={
          !loading ? <Text style={styles.empty}>Search YouTube’s music catalog via your server.</Text> : null
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
});
