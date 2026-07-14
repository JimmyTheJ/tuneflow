import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { router } from "expo-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  FlatList,
  RefreshControl,
  Text,
  TextInput,
  View,
  useWindowDimensions,
} from "react-native";

import { TrackRowWithActions } from "@/components/TrackRowWithActions";
import { CreatePlaylistDialog } from "@/components/CreatePlaylistDialog";
import { Button } from "@/components/ui/Button";
import { MediaCard } from "@/components/ui/MediaCard";
import { SectionHeader } from "@/components/ui/SectionHeader";
import { MediaCardSkeleton, TrackRowSkeleton } from "@/components/ui/Skeleton";
import { api } from "@/lib/api";
import { filterPlaylists, suggestedPlaylistName } from "@/lib/playlistUtils";
import { usePlayerStore } from "@/stores/player";
import type { LikeEntry, Playlist } from "@/types";

export default function LibraryScreen() {
  const { width } = useWindowDimensions();
  const cardWidth = (width - 32 - 12) / 2;
  const [playlists, setPlaylists] = useState<Playlist[]>([]);
  const [likes, setLikes] = useState<LikeEntry[]>([]);
  const [playlistQuery, setPlaylistQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [createBusy, setCreateBusy] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
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

  const filteredPlaylists = useMemo(
    () => filterPlaylists(playlists, playlistQuery),
    [playlists, playlistQuery],
  );

  const createPlaylist = async (name: string) => {
    setCreateBusy(true);
    setCreateError(null);
    try {
      const playlist = await api.createPlaylist(name);
      setPlaylists((current) => [playlist, ...current]);
      setCreateOpen(false);
    } catch (err) {
      setCreateError(err instanceof Error ? err.message : "Could not create playlist");
    } finally {
      setCreateBusy(false);
    }
  };

  return (
    <View className="flex-1 bg-base px-4 pt-2">
      <View className="mb-3 flex-row items-center justify-between gap-3">
        <Text className="text-3xl font-bold tracking-tight text-text">Your library</Text>
        <Button
          variant="secondary"
          size="sm"
          onPress={() => {
            setCreateError(null);
            setCreateOpen(true);
          }}
        >
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
              {playlists.length > 0 ? (
                <View className="relative mb-4">
                  <Ionicons
                    name="search"
                    size={18}
                    color="#6a6a6a"
                    style={{ position: "absolute", left: 14, top: 14, zIndex: 1 }}
                  />
                  <TextInput
                    value={playlistQuery}
                    onChangeText={setPlaylistQuery}
                    placeholder="Search playlists"
                    placeholderTextColor="#6a6a6a"
                    className="rounded-xl border border-border bg-elevated py-3 pl-11 pr-4 text-base text-text"
                  />
                </View>
              ) : null}
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
                {filteredPlaylists.map((playlist) => (
                  <View key={playlist.id} style={{ width: cardWidth }}>
                    <MediaCard
                      title={playlist.name}
                      subtitle={`${playlist.track_count} tracks`}
                      onPress={() => router.push(`/playlist/${playlist.id}`)}
                    />
                  </View>
                ))}
              </View>
              {playlists.length > 0 && filteredPlaylists.length === 0 ? (
                <Text className="mt-3 text-sm text-text-muted">No playlists match your search.</Text>
              ) : null}
              <View className="mt-6">
                <SectionHeader title="Liked songs" subtitle={`${likes.length} songs`} />
              </View>
              {likes.length === 0 ? (
                <Text className="text-text-secondary">Songs you like will appear here.</Text>
              ) : null}
            </View>
          }
          renderItem={({ item }) => (
            <TrackRowWithActions
              track={item}
              playQueue={likes}
              playlists={playlists}
              onPlay={() => void playTrack(item, likes)}
              onPlaylistsChange={() => void load()}
            />
          )}
        />
      )}

      <CreatePlaylistDialog
        visible={createOpen}
        defaultName={suggestedPlaylistName(playlists.length)}
        busy={createBusy}
        error={createError}
        onConfirm={createPlaylist}
        onCancel={() => {
          if (createBusy) return;
          setCreateOpen(false);
          setCreateError(null);
        }}
      />
    </View>
  );
}
