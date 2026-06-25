import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, FlatList, RefreshControl, StyleSheet, Text, View } from "react-native";

import { TrackRow } from "@/components/TrackRow";
import { api } from "@/lib/api";
import { usePlayerStore } from "@/stores/player";
import type { PlayHistoryEntry } from "@/types";

export default function HomeScreen() {
  const [history, setHistory] = useState<PlayHistoryEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const playTrack = usePlayerStore((state) => state.playTrack);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setHistory(await api.listHistory());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load history");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <View style={styles.container}>
      <Text style={styles.heading}>Recently played</Text>
      {loading && history.length === 0 ? (
        <ActivityIndicator color="#22c55e" style={{ marginTop: 24 }} />
      ) : error ? (
        <Text style={styles.error}>{error}</Text>
      ) : (
        <FlatList
          data={history}
          keyExtractor={(item) => String(item.id)}
          refreshControl={<RefreshControl refreshing={loading} onRefresh={() => void load()} />}
          renderItem={({ item }) => (
            <TrackRow
              track={item}
              subtitle={item.artist ?? "Unknown artist"}
              onPress={() => void playTrack(item, history)}
            />
          )}
          ListEmptyComponent={<Text style={styles.empty}>Play something from Search to build history.</Text>}
        />
      )}
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
  heading: {
    color: "#fff",
    fontSize: 28,
    fontWeight: "700",
    marginBottom: 12,
  },
  empty: {
    color: "#737373",
    marginTop: 24,
    fontSize: 15,
  },
  error: {
    color: "#f87171",
    marginTop: 16,
  },
});
