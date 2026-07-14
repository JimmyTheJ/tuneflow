import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { Stack, router, useLocalSearchParams } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import { Image, ScrollView, Text, View } from "react-native";

import { MediaCard } from "@/components/ui/MediaCard";
import { SectionHeader } from "@/components/ui/SectionHeader";
import { MediaCardSkeleton, Skeleton } from "@/components/ui/Skeleton";
import { api } from "@/lib/api";
import { formatReleaseYear } from "@/lib/catalogUtils";
import type { ArtistDetail, ReleaseSummary } from "@/types";

function ReleaseSection({ title, releases }: { title: string; releases: ReleaseSummary[] }) {
  if (releases.length === 0) return null;

  return (
    <View className="mb-8">
      <SectionHeader title={title} />
      <View className="flex-row flex-wrap gap-3">
        {releases.map((release) => (
          <View key={release.mbid} className="w-[46%] sm:w-[30%]">
            <MediaCard
              title={release.title}
              subtitle={formatReleaseYear(release.release_date)}
              onPress={() => router.push({ pathname: "/album/[id]", params: { id: release.mbid } })}
              cover={
                release.cover_url ? (
                  <Image source={{ uri: release.cover_url }} className="h-full w-full" />
                ) : undefined
              }
            />
          </View>
        ))}
      </View>
    </View>
  );
}

export default function ArtistScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const [artist, setArtist] = useState<ArtistDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    try {
      setArtist(await api.getArtist(id));
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load artist");
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
          <Skeleton className="h-36 w-36 rounded-full" />
          <View className="flex-1 justify-end gap-3 pb-1">
            <Skeleton className="h-3 w-20" />
            <Skeleton className="h-8 w-3/4" />
          </View>
        </View>
        <View className="mt-6 flex-row flex-wrap gap-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <View key={i} className="w-[46%]">
              <MediaCardSkeleton />
            </View>
          ))}
        </View>
      </View>
    );
  }

  if (error || !artist) {
    return (
      <View className="flex-1 bg-base px-4 pt-6">
        <Text className="text-danger-fg">{error ?? "Artist not found"}</Text>
      </View>
    );
  }

  const totalReleases = artist.albums.length + artist.eps.length + artist.singles.length;

  return (
    <View className="flex-1 bg-base">
      <Stack.Screen options={{ title: artist.name, headerStyle: { backgroundColor: "#0a0a0a" } }} />
      <ScrollView contentContainerStyle={{ paddingBottom: 32 }}>
        <LinearGradient colors={["#14532d66", "#0a0a0a"]} className="px-4 pb-8 pt-4">
          <View className="flex-row items-end gap-4">
            <View className="h-36 w-36 items-center justify-center overflow-hidden rounded-full bg-highlight">
              {artist.image_url ? (
                <Image source={{ uri: artist.image_url }} className="h-full w-full" />
              ) : (
                <Ionicons name="person" size={48} color="#6a6a6a" />
              )}
            </View>
            <View className="min-w-0 flex-1 pb-1">
              <Text className="text-xs font-bold uppercase tracking-widest text-text-secondary">Artist</Text>
              <Text className="text-3xl font-bold text-text">{artist.name}</Text>
              {artist.disambiguation ? (
                <Text className="mt-1 text-sm text-text-secondary">{artist.disambiguation}</Text>
              ) : null}
              <Text className="mt-2 text-sm text-text-secondary">
                {totalReleases} {totalReleases === 1 ? "release" : "releases"}
              </Text>
            </View>
          </View>
        </LinearGradient>

        <View className="px-4">
          <ReleaseSection title="Albums" releases={artist.albums} />
          <ReleaseSection title="EPs" releases={artist.eps} />
          <ReleaseSection title="Singles" releases={artist.singles} />
          {totalReleases === 0 ? (
            <Text className="text-text-muted">No releases found for this artist.</Text>
          ) : null}
        </View>
      </ScrollView>
    </View>
  );
}
