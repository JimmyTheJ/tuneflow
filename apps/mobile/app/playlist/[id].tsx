import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { useLocalSearchParams, Stack } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import { FlatList, Image, Text, View } from "react-native";

import { TrackRow } from "@/components/TrackRow";
import { Button } from "@/components/ui/Button";
import { Skeleton, TrackRowSkeleton } from "@/components/ui/Skeleton";
import { api } from "@/lib/api";
import { trackThumbnailUrl } from "@/lib/thumbnails";
import { usePlayerStore } from "@/stores/player";
import type { PlaylistDetail } from "@/types";

export default function PlaylistScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const [playlist, setPlaylist] = useState<PlaylistDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [artFailed, setArtFailed] = useState(false);
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
    return (
      <View className="flex-1 bg-base px-4 pt-4">
        <View className="flex-row gap-4">
          <Skeleton className="h-36 w-36 rounded-xl" />
          <View className="flex-1 justify-end gap-3 pb-1">
            <Skeleton className="h-3 w-20" />
            <Skeleton className="h-8 w-3/4" />
            <Skeleton className="h-3 w-24" />
          </View>
        </View>
        <View className="mt-6 gap-1">
          {Array.from({ length: 6 }).map((_, i) => (
            <TrackRowSkeleton key={i} />
          ))}
        </View>
      </View>
    );
  }

  if (error || !playlist) {
    return (
      <View className="flex-1 bg-base px-4 pt-6">
        <Text className="text-danger-fg">{error ?? "Playlist not found"}</Text>
      </View>
    );
  }

  const coverId = playlist.tracks[0]?.video_id;
  const playAll = () => {
    if (playlist.tracks.length === 0) return;
    void playTrack(playlist.tracks[0], playlist.tracks);
  };

  return (
    <View className="flex-1 bg-base">
      <Stack.Screen options={{ title: playlist.name, headerStyle: { backgroundColor: "#0a0a0a" } }} />
      <FlatList
        data={playlist.tracks}
        keyExtractor={(item) => String(item.id)}
        contentContainerStyle={{ paddingBottom: 32 }}
        ListHeaderComponent={
          <View>
            <LinearGradient colors={["#14532d", "#181818", "#0a0a0a"]} style={{ paddingHorizontal: 16, paddingTop: 16, paddingBottom: 20 }}>
              <View className="flex-row items-end gap-4">
                {coverId && !artFailed ? (
                  <Image
                    source={{ uri: trackThumbnailUrl(coverId) }}
                    className="h-36 w-36 rounded-xl bg-highlight"
                    style={{ width: 144, height: 144, borderRadius: 12 }}
                    onError={() => setArtFailed(true)}
                  />
                ) : (
                  <View className="h-36 w-36 items-center justify-center rounded-xl bg-highlight">
                    <Ionicons name="musical-notes" size={40} color="#6a6a6a" />
                  </View>
                )}
                <View className="min-w-0 flex-1 pb-1">
                  <Text className="text-xs font-bold uppercase tracking-widest text-text-secondary">
                    Playlist
                  </Text>
                  <Text className="mt-1 text-3xl font-extrabold tracking-tight text-text" numberOfLines={2}>
                    {playlist.name}
                  </Text>
                  <Text className="mt-1 text-sm text-text-secondary">
                    {playlist.tracks.length} {playlist.tracks.length === 1 ? "track" : "tracks"}
                  </Text>
                </View>
              </View>
              <View className="mt-5">
                <Button
                  size="lg"
                  disabled={playlist.tracks.length === 0}
                  onPress={playAll}
                  className="self-start px-8"
                >
                  <View className="flex-row items-center gap-2">
                    <Ionicons name="play" size={20} color="#052e16" />
                    <Text className="text-base font-bold text-accent-fg">Play</Text>
                  </View>
                </Button>
              </View>
            </LinearGradient>
            <View className="h-2" />
          </View>
        }
        renderItem={({ item, index }) => (
          <View className="px-3">
            <TrackRow
              track={item}
              index={index + 1}
              onPress={() => void playTrack(item, playlist.tracks)}
            />
          </View>
        )}
      />
    </View>
  );
}
