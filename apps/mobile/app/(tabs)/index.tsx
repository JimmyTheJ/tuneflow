import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import {
  FlatList,
  Pressable,
  RefreshControl,
  ScrollView,
  Text,
  View,
} from "react-native";

import { TrackRow } from "@/components/TrackRow";
import { MediaCard } from "@/components/ui/MediaCard";
import { SectionHeader } from "@/components/ui/SectionHeader";
import { MediaCardSkeleton, TrackRowSkeleton } from "@/components/ui/Skeleton";
import { api } from "@/lib/api";
import { useAuthStore } from "@/stores/auth";
import { usePlayerStore } from "@/stores/player";
import type { PlayHistoryEntry } from "@/types";

function greeting(): string {
  const hour = new Date().getHours();
  if (hour < 12) return "Good morning";
  if (hour < 18) return "Good afternoon";
  return "Good evening";
}

export default function HomeScreen() {
  const user = useAuthStore((state) => state.user);
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

  const name = user?.display_name?.split(" ")[0];

  return (
    <View className="flex-1 bg-base px-4 pt-2">
      <Text className="text-3xl font-bold tracking-tight text-text">
        {greeting()}
        {name ? `, ${name}` : ""}
      </Text>
      <Text className="mt-1 text-text-secondary">Pick up where you left off</Text>

      {error ? <Text className="mt-3 text-danger-fg">{error}</Text> : null}

      {loading && history.length === 0 ? (
        <View className="mt-6 gap-4">
          <ScrollView horizontal showsHorizontalScrollIndicator={false} className="-mx-1">
            {Array.from({ length: 4 }).map((_, i) => (
              <View key={i} className="mx-1 w-36">
                <MediaCardSkeleton />
              </View>
            ))}
          </ScrollView>
          {Array.from({ length: 4 }).map((_, i) => (
            <TrackRowSkeleton key={i} />
          ))}
        </View>
      ) : history.length === 0 ? (
        <View className="mt-10 items-center rounded-2xl bg-elevated px-6 py-14">
          <View className="mb-4 h-16 w-16 items-center justify-center rounded-full bg-highlight">
            <Ionicons name="musical-notes" size={32} color="#1db954" />
          </View>
          <Text className="text-xl font-bold text-text">No listening history yet</Text>
          <Text className="mt-2 text-center text-text-secondary">
            Play something from Search to build your recently played list.
          </Text>
          <Pressable
            className="mt-6 flex-row items-center gap-2 rounded-full bg-accent px-5 py-2.5 active:bg-accent-hover"
            onPress={() => router.push("/(tabs)/search")}
          >
            <Ionicons name="search" size={16} color="#052e16" />
            <Text className="font-bold text-accent-fg">Search music</Text>
          </Pressable>
        </View>
      ) : (
        <FlatList
          className="mt-4"
          data={history}
          keyExtractor={(item) => String(item.id)}
          refreshControl={<RefreshControl refreshing={loading} onRefresh={() => void load()} tintColor="#1db954" />}
          ListHeaderComponent={
            <View className="mb-6">
              <SectionHeader title="Recently played" />
              <ScrollView horizontal showsHorizontalScrollIndicator={false} className="-mx-1">
                {history.slice(0, 10).map((item) => (
                  <View key={`card-${item.id}`} className="mx-1 w-36">
                    <MediaCard
                      title={item.title}
                      subtitle={item.artist ?? "Unknown artist"}
                      videoId={item.video_id}
                      onPlay={() => void playTrack(item, history)}
                    />
                  </View>
                ))}
              </ScrollView>
              {history.length > 5 ? (
                <View className="mt-6">
                  <SectionHeader title="Jump back in" />
                </View>
              ) : null}
            </View>
          }
          renderItem={({ item }) => (
            <TrackRow track={item} onPress={() => void playTrack(item, history)} />
          )}
        />
      )}
    </View>
  );
}
