import { Ionicons } from "@expo/vector-icons";
import { ActivityIndicator, RefreshControl, ScrollView, Text, View } from "react-native";

import { TrackRow } from "@/components/TrackRow";
import { Card } from "@/components/ui/Card";
import { SectionHeader } from "@/components/ui/SectionHeader";
import { Skeleton, TrackRowSkeleton } from "@/components/ui/Skeleton";
import { useDiscoverData } from "@/hooks/useDiscoverData";
import { useAuthStore } from "@/stores/auth";
import { usePlayerStore } from "@/stores/player";

export default function DiscoverScreen() {
  const userId = useAuthStore((state) => state.user?.id);
  const { status, insights, recommendations, error, loading, refreshing, reload } =
    useDiscoverData(userId);
  const playTrack = usePlayerStore((state) => state.playTrack);

  return (
    <ScrollView
      className="flex-1 bg-base px-4 pt-2"
      refreshControl={
        <RefreshControl refreshing={refreshing} onRefresh={() => void reload()} tintColor="#1db954" />
      }
    >
      <Text className="text-3xl font-bold tracking-tight text-text">Discover</Text>
      <Text className="mb-1 mt-1 text-text-secondary">
        Personalized insights from your listening history
      </Text>
      {refreshing ? (
        <View className="mb-3 flex-row items-center gap-2">
          <ActivityIndicator size="small" color="#1db954" />
          <Text className="text-sm text-text-secondary">Updating recommendations…</Text>
        </View>
      ) : (
        <View className="mb-4" />
      )}

      {error ? <Text className="mb-3 text-danger-fg">{error}</Text> : null}

      {loading && !status ? (
        <View className="gap-4">
          <Skeleton className="h-24 w-full rounded-xl" />
          <Skeleton className="h-32 w-full rounded-xl" />
          {Array.from({ length: 3 }).map((_, i) => (
            <TrackRowSkeleton key={i} />
          ))}
        </View>
      ) : null}

      {status ? (
        <Card className="mb-4">
          <View className="flex-row items-start gap-3">
            <View className="h-10 w-10 items-center justify-center rounded-full bg-accent/20">
              <Ionicons name="sparkles" size={20} color="#1db954" />
            </View>
            <View className="min-w-0 flex-1">
              <Text className="text-base font-bold text-text">AI status</Text>
              <Text className="mt-1 text-sm text-text-secondary">
                {status.reachable
                  ? `Connected to ${status.model}`
                  : (status.detail ??
                    "LLM not reachable. Check server LLM_BASE_URL (e.g. Ollama on your LAN).")}
              </Text>
            </View>
          </View>
        </Card>
      ) : null}

      {insights ? (
        <Card className="mb-4">
          <Text className="text-base font-bold text-text">Your listening</Text>
          <Text className="mt-2 text-[15px] leading-6 text-text">{insights.summary}</Text>
          {insights.top_artists.length > 0 ? (
            <Text className="mt-2 text-sm text-text-secondary">
              Top artists: {insights.top_artists.join(", ")}
            </Text>
          ) : null}
          {insights.listening_patterns.map((item) => (
            <Text key={item} className="mt-1 text-sm leading-5 text-text-secondary">
              • {item}
            </Text>
          ))}
        </Card>
      ) : null}

      {recommendations?.suggestions.map((suggestion) => (
        <View key={suggestion.query} className="mb-5">
          <SectionHeader title={suggestion.reason} />
          <Card className="!p-2">
            {suggestion.tracks.map((track) => (
              <TrackRow
                key={track.video_id}
                track={track}
                onPress={() => void playTrack(track, suggestion.tracks)}
              />
            ))}
            {!suggestion.tracks.length ? (
              <Text className="px-2 py-2 text-sm text-text-muted">
                Try searching: {suggestion.query}
              </Text>
            ) : null}
          </Card>
        </View>
      ))}
      <View className="h-8" />
    </ScrollView>
  );
}
