import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, FlatList, StyleSheet, Text, View } from "react-native";
import { useLocalSearchParams } from "expo-router";

import { TrackRow } from "@/components/TrackRow";
import { api } from "@/lib/api";
import { usePlayerStore } from "@/stores/player";
import type { PlaylistDetail } from "@/types";

export default function PlaylistScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const [playlist, setPlaylist] = useState<PlaylistDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const playTrack = usePlayerStore((state) => state.playTrack);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setPlaylist(await api.getPlaylist(Number(id)));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load playlist");
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  if (loading) {
    return <ActivityIndicator color="#22c55e" style={{ marginTop: 48 }} />;
  }

  if (error || !playlist) {
    return (
      <View style={styles.container}>
        <Text style={styles.error}>{error ?? "Playlist not found"}</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <Text style={styles.heading}>{playlist.name}</Text>
      <Text style={styles.meta}>{playlist.tracks.length} tracks</Text>
      <FlatList
        data={playlist.tracks}
        keyExtractor={(item) => String(item.id)}
        renderItem={({ item }) => (
          <TrackRow track={item} onPress={() => void playTrack(item, playlist.tracks)} />
        )}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#0a0a0a",
    paddingHorizontal: 16,
    paddingTop: 16,
  },
  heading: {
    color: "#fff",
    fontSize: 28,
    fontWeight: "700",
  },
  meta: {
    color: "#737373",
    marginBottom: 16,
    marginTop: 4,
  },
  error: {
    color: "#f87171",
    marginTop: 24,
    paddingHorizontal: 16,
  },
});
