import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { Stack, router, useLocalSearchParams } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { FlatList, Image, Pressable, Text, View } from "react-native";

import { TrackRowWithActions } from "@/components/TrackRowWithActions";
import { Button } from "@/components/ui/Button";
import { TrackRowSkeleton } from "@/components/ui/Skeleton";
import { api } from "@/lib/api";
import { albumPlayableTracks, catalogTrackToPlayable, formatReleaseYear } from "@/lib/catalogUtils";
import { usePlayerStore } from "@/stores/player";
import type { AlbumDetail, CatalogTrack, Playlist, Track } from "@/types";

export default function AlbumScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const [album, setAlbum] = useState<AlbumDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [resolving, setResolving] = useState(false);
  const [playlists, setPlaylists] = useState<Playlist[]>([]);
  const resolveStarted = useRef(false);
  const playTrack = usePlayerStore((state) => state.playTrack);

  const loadPlaylists = useCallback(async () => {
    try {
      setPlaylists(await api.listPlaylists());
    } catch {
      /* optional */
    }
  }, []);

  const load = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    try {
      setAlbum(await api.getAlbum(id));
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load album");
    } finally {
      setLoading(false);
    }
  }, [id]);

  const resolveTracks = useCallback(async () => {
    if (!id) return;
    setResolving(true);
    try {
      const result = await api.resolveAlbum(id);
      setAlbum((current) => (current ? { ...current, tracks: result.tracks } : current));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not resolve tracks");
    } finally {
      setResolving(false);
    }
  }, [id]);

  useEffect(() => {
    void load();
    void loadPlaylists();
  }, [load, loadPlaylists]);

  useEffect(() => {
    if (!album || resolveStarted.current) return;
    resolveStarted.current = true;
    void resolveTracks();
  }, [album, resolveTracks]);

  if (loading) {
    return (
      <View className="flex-1 bg-base px-4 pt-4">
        <View className="flex-row gap-4">
          <View className="h-36 w-36 rounded-xl bg-highlight" />
          <View className="flex-1 justify-end gap-3 pb-1">
            <View className="h-3 w-20 rounded bg-highlight" />
            <View className="h-8 w-3/4 rounded bg-highlight" />
          </View>
        </View>
        <View className="mt-6 gap-1">
          {Array.from({ length: 8 }).map((_, i) => (
            <TrackRowSkeleton key={i} />
          ))}
        </View>
      </View>
    );
  }

  if (error || !album) {
    return (
      <View className="flex-1 bg-base px-4 pt-6">
        <Text className="text-danger-fg">{error ?? "Album not found"}</Text>
      </View>
    );
  }

  const playable = albumPlayableTracks(album);
  const playAll = () => {
    if (playable.length === 0) return;
    void playTrack(playable[0], playable);
  };

  const trackToRow = (track: CatalogTrack): Track => ({
    video_id: track.video_id ?? `pending-${track.position}`,
    title: track.title,
    artist: track.artist_name ?? album.artist_name,
    thumbnail_url: track.thumbnail_url ?? album.cover_url,
    duration_sec: track.duration_sec,
    blocked_reason: track.blocked_reason,
  });

  return (
    <View className="flex-1 bg-base">
      <Stack.Screen options={{ title: album.title, headerStyle: { backgroundColor: "#0a0a0a" } }} />
      <FlatList
        data={album.tracks}
        keyExtractor={(item) => `${item.position}-${item.title}`}
        contentContainerStyle={{ paddingBottom: 32 }}
        ListHeaderComponent={
          <View>
            <LinearGradient colors={["#14532d66", "#0a0a0a"]} className="px-4 pb-6 pt-2">
              <View className="flex-row items-end gap-4">
                {album.cover_url ? (
                  <Image source={{ uri: album.cover_url }} className="h-36 w-36 rounded-xl" />
                ) : (
                  <View className="h-36 w-36 rounded-xl bg-highlight" />
                )}
                <View className="min-w-0 flex-1 pb-1">
                  <Text className="text-xs font-bold uppercase tracking-widest text-text-secondary">Album</Text>
                  <Text className="text-2xl font-bold text-text">{album.title}</Text>
                  {album.artist_mbid ? (
                    <Pressable onPress={() => router.push({ pathname: "/artist/[id]", params: { id: album.artist_mbid! } })}>
                      <Text className="mt-1 text-sm text-text-secondary">
                        {album.artist_name}
                        {album.release_date ? ` · ${formatReleaseYear(album.release_date)}` : ""}
                      </Text>
                    </Pressable>
                  ) : (
                    <Text className="mt-1 text-sm text-text-secondary">
                      {album.artist_name}
                      {album.release_date ? ` · ${formatReleaseYear(album.release_date)}` : ""}
                    </Text>
                  )}
                  <Text className="mt-1 text-sm text-text-secondary">
                    {album.tracks.length} {album.tracks.length === 1 ? "track" : "tracks"}
                    {resolving ? " · Finding playable versions…" : ""}
                  </Text>
                  <Button
                    className="mt-4 self-start px-6"
                    disabled={playable.length === 0}
                    onPress={playAll}
                  >
                    Play
                  </Button>
                </View>
              </View>
            </LinearGradient>
            {error ? <Text className="px-4 pb-2 text-danger-fg">{error}</Text> : null}
          </View>
        }
        renderItem={({ item, index }) => {
          const playableTrack = catalogTrackToPlayable(item, album.artist_name);
          const rowTrack = trackToRow(item);
          const disabled = !playableTrack || !!item.blocked_reason;

          return (
            <View className="px-2">
              <TrackRowWithActions
                track={rowTrack}
                index={index + 1}
                playQueue={playable}
                playlists={playlists}
                disabled={disabled}
                subtitle={
                  item.blocked_reason
                    ? `Blocked: ${item.blocked_reason}`
                    : !item.resolved
                      ? resolving
                        ? "Finding playable version…"
                        : "Not available on YouTube"
                      : (item.artist_name ?? album.artist_name)
                }
                onPlay={() => {
                  if (!playableTrack) return;
                  void playTrack(playableTrack, playable);
                }}
                onPlaylistsChange={() => void loadPlaylists()}
              />
            </View>
          );
        }}
      />
    </View>
  );
}
