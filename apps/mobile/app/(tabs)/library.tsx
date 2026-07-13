import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { router } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import {
  FlatList,
  RefreshControl,
  Text,
  View,
  useWindowDimensions,
} from "react-native";

import { TrackRow } from "@/components/TrackRow";
import { Button } from "@/components/ui/Button";
import { MediaCard } from "@/components/ui/MediaCard";
import { SectionHeader } from "@/components/ui/SectionHeader";
import { MediaCardSkeleton, TrackRowSkeleton } from "@/components/ui/Skeleton";
import { api } from "@/lib/api";
import { usePlayerStore } from "@/stores/player";
import type { LikeEntry, Playlist } from "@/types";

export default function LibraryScreen() {
  const { width } = useWindowDimensions();
  const cardWidth = (width - 32 - 12) / 2;
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
    <View className="flex-1 bg-base px-4 pt-2">
      <View className="mb-3 flex-row items-center justify-between gap-3">
        <Text className="text-3xl font-bold tracking-tight text-text">Your library</Text>
        <Button variant="secondary" size="sm" onPress={() => void createPlaylist()}>
          <View className="flex-row items-center gap-1.5">
            <Ionicons name="add" size={16} color="#fff" />
            <Text className="text-sm font-semibold text-text">New playlist</Text>
          </View>
        </Button>
      </View>

      {error ? <Text className="mb-2 text-danger-fg">{error}</Text> : null}

      {loading && playlists.length === 0 && likes.length === 0 ? (
        <View className="gap-4">
          <View className="flex-row flex-wrap gap-3">
            {Array.from({ length: 4 }).map((_, i) => (
              <View key={i} style={{ width: cardWidth }}>
                <MediaCardSkeleton />
              </View>
            ))}
          </View>
          {Array.from({ length: 3 }).map((_, i) => (
            <TrackRowSkeleton key={i} />
          ))}
        </View>
      ) : (
        <FlatList
          data={likes}
          keyExtractor={(item) => String(item.id)}
          refreshControl={<RefreshControl refreshing={loading} onRefresh={() => void load()} tintColor="#1db954" />}
          ListHeaderComponent={
            <View className="mb-4">
              <SectionHeader title="Playlists" />
              <View className="flex-row flex-wrap gap-3">
                <View style={{ width: cardWidth }}>
                  <MediaCard
                    title="Liked Songs"
                    subtitle={`${likes.length} songs`}
                    accent
                    onPlay={likes.length > 0 ? () => void playTrack(likes[0], likes) : undefined}
                    cover={
                      <LinearGradient
                        colors={["#8b5cf6", "#4c1d95"]}
                        style={{ flex: 1, alignItems: "center", justifyContent: "center" }}
                      >
                        <Ionicons name="heart" size={40} color="#fff" />
                      </LinearGradient>
                    }
                  />
                </View>
                {playlists.map((playlist) => (
                  <View key={playlist.id} style={{ width: cardWidth }}>
                    <MediaCard
                      title={playlist.name}
                      subtitle={`${playlist.track_count} tracks`}
                      onPress={() => router.push(`/playlist/${playlist.id}`)}
                    />
                  </View>
                ))}
              </View>
              <View className="mt-6">
                <SectionHeader title="Liked songs" subtitle={`${likes.length} songs`} />
              </View>
              {likes.length === 0 ? (
                <Text className="text-text-secondary">Songs you like will appear here.</Text>
              ) : null}
            </View>
          }
          renderItem={({ item, index }) => (
            <TrackRow
              track={item}
              index={index + 1}
              onPress={() => void playTrack(item, likes)}
            />
          )}
        />
      )}
    </View>
  );
}
