import { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { router } from "expo-router";

import { TrackRow } from "@/components/TrackRow";
import { api } from "@/lib/api";
import { usePlayerStore } from "@/stores/player";
import type { LikeEntry, Playlist } from "@/types";

export default function LibraryScreen() {
  const [playlists, setPlaylists] = useState<Playlist[]>([]);
  const [likes, setLikes] = useState<LikeEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const playTrack = usePlayerStore((state) => state.playTrack);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [playlistData, likeData] = await Promise.all([api.listPlaylists(), api.listLikes()]);
      setPlaylists(playlistData);
      setLikes(likeData);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load library");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const createPlaylist = async () => {
    try {
      const playlist = await api.createPlaylist(`Playlist ${playlists.length + 1}`);
      setPlaylists((current) => [playlist, ...current]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create playlist");
    }
  };

  return (
    <View style={styles.container}>
      <View style={styles.headerRow}>
        <Text style={styles.heading}>Your library</Text>
        <Pressable style={styles.createButton} onPress={() => void createPlaylist()}>
          <Text style={styles.createButtonText}>New playlist</Text>
        </Pressable>
      </View>

      {loading && playlists.length === 0 && likes.length === 0 ? (
        <ActivityIndicator color="#22c55e" style={{ marginTop: 24 }} />
      ) : error ? (
        <Text style={styles.error}>{error}</Text>
      ) : (
        <FlatList
          data={[
            ...playlists.map((playlist) => ({ type: "playlist" as const, playlist })),
            ...likes.map((like) => ({ type: "like" as const, like })),
          ]}
          keyExtractor={(item) =>
            item.type === "playlist" ? `playlist-${item.playlist.id}` : `like-${item.like.id}`
          }
          refreshControl={<RefreshControl refreshing={loading} onRefresh={() => void load()} />}
          ListHeaderComponent={<Text style={styles.section}>Playlists</Text>}
          renderItem={({ item }) => {
            if (item.type === "playlist") {
              return (
                <Pressable
                  style={styles.playlistRow}
                  onPress={() => router.push(`/playlist/${item.playlist.id}`)}
                >
                  <Text style={styles.playlistName}>{item.playlist.name}</Text>
                  <Text style={styles.playlistMeta}>{item.playlist.track_count} tracks</Text>
                </Pressable>
              );
            }

            return (
              <TrackRow track={item.like} onPress={() => void playTrack(item.like, likes)} />
            );
          }}
          ListFooterComponent={
            likes.length > 0 ? null : <Text style={styles.empty}>Liked songs will appear below playlists.</Text>
          }
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
  headerRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 12,
  },
  heading: {
    color: "#fff",
    fontSize: 28,
    fontWeight: "700",
  },
  createButton: {
    backgroundColor: "#171717",
    borderRadius: 999,
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  createButtonText: {
    color: "#22c55e",
    fontWeight: "600",
  },
  section: {
    color: "#a3a3a3",
    fontSize: 14,
    marginBottom: 8,
    textTransform: "uppercase",
    letterSpacing: 0.8,
  },
  playlistRow: {
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: "#222",
  },
  playlistName: {
    color: "#fff",
    fontSize: 17,
    fontWeight: "600",
  },
  playlistMeta: {
    color: "#737373",
    marginTop: 4,
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
