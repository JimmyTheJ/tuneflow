import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { useLocalSearchParams, Stack } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import { FlatList, Image, Pressable, Text, View } from "react-native";

import { EditablePlaylistTitle } from "@/components/EditablePlaylistTitle";
import { TrackRow } from "@/components/TrackRow";
import { Button } from "@/components/ui/Button";
import { IconButton } from "@/components/ui/IconButton";
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

  const handleRename = async (name: string) => {
    if (!playlist) return;
    const updated = await api.updatePlaylist(playlist.id, { name });
    setPlaylist({ ...playlist, name: updated.name });
  };

  const handleRemoveTrack = async (trackId: number) => {
    if (!playlist) return;
    const previous = playlist.tracks;
    const nextTracks = previous.filter((track) => track.id !== trackId);
    setPlaylist({ ...playlist, tracks: nextTracks, track_count: nextTracks.length });
    try {
      await api.removePlaylistTrack(playlist.id, trackId);
    } catch (err) {
      setPlaylist({ ...playlist, tracks: previous, track_count: previous.length });
      setError(err instanceof Error ? err.message : "Could not remove track");
    }
  };

  const reorderTracks = async (fromIndex: number, toIndex: number) => {
    if (!playlist || fromIndex === toIndex) return;
    const previous = playlist.tracks;
    const nextTracks = [...previous];
    const [moved] = nextTracks.splice(fromIndex, 1);
    nextTracks.splice(toIndex, 0, moved);
    setPlaylist({ ...playlist, tracks: nextTracks });
    try {
      await api.reorderPlaylistTracks(
        playlist.id,
        nextTracks.map((track) => track.id),
      );
    } catch (err) {
      setPlaylist({ ...playlist, tracks: previous });
      setError(err instanceof Error ? err.message : "Could not reorder tracks");
    }
  };

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
                  <EditablePlaylistTitle name={playlist.name} onSave={handleRename} />
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
            {error ? <Text className="px-4 py-2 text-danger-fg">{error}</Text> : null}
            <View className="h-2" />
          </View>
        }
        renderItem={({ item, index }) => {
          const canMoveUp = index > 0;
          const canMoveDown = index < playlist.tracks.length - 1;

          return (
            <View className="flex-row items-center px-3">
              <View className="min-w-0 flex-1">
                <TrackRow
                  track={item}
                  index={index + 1}
                  onPress={() => void playTrack(item, playlist.tracks)}
                />
              </View>
              <View className="flex-row items-center">
                <Pressable
                  disabled={!canMoveUp}
                  className={`p-1.5 ${canMoveUp ? "" : "opacity-25"}`}
                  onPress={() => void reorderTracks(index, index - 1)}
                  hitSlop={6}
                >
                  <Ionicons name="chevron-up" size={16} color="#b3b3b3" />
                </Pressable>
                <Pressable
                  disabled={!canMoveDown}
                  className={`p-1.5 ${canMoveDown ? "" : "opacity-25"}`}
                  onPress={() => void reorderTracks(index, index + 1)}
                  hitSlop={6}
                >
                  <Ionicons name="chevron-down" size={16} color="#b3b3b3" />
                </Pressable>
                <IconButton
                  name="close"
                  label={`Remove ${item.title}`}
                  size="sm"
                  onPress={() => void handleRemoveTrack(item.id)}
                />
              </View>
            </View>
          );
        }}
      />
    </View>
  );
}
