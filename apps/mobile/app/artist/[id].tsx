import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { Stack, router, useLocalSearchParams } from "expo-router";
import { useEffect, useState } from "react";
import { Image, ScrollView, Text, View } from "react-native";

import { MediaCard } from "@/components/ui/MediaCard";
import { SectionHeader } from "@/components/ui/SectionHeader";
import { MediaCardSkeleton, Skeleton } from "@/components/ui/Skeleton";
import { api } from "@/lib/api";
import { formatReleaseYear, mergeArtistDiscography } from "@/lib/catalogUtils";
import type { ArtistDetail, ReleaseSummary } from "@/types";

function ReleaseSection({
  title,
  releases,
  loading,
}: {
  title: string;
  releases: ReleaseSummary[];
  loading: boolean;
}) {
  if (releases.length === 0 && !loading) return null;

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
        {loading
          ? Array.from({ length: releases.length === 0 ? 4 : 2 }).map((_, i) => (
              <View key={`loading-${i}`} className="w-[46%] sm:w-[30%]">
                <MediaCardSkeleton />
              </View>
            ))
          : null}
      </View>
    </View>
  );
}

export default function ArtistScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const [artist, setArtist] = useState<ArtistDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loadingProfile, setLoadingProfile] = useState(true);
  const [loadingDiscography, setLoadingDiscography] = useState(true);

  useEffect(() => {
    if (!id) return;

    let cancelled = false;
    setArtist(null);
    setError(null);
    setLoadingProfile(true);
    setLoadingDiscography(true);

    void (async () => {
      try {
        for await (const event of api.streamArtist(id)) {
          if (cancelled) return;

          if (event.event === "profile") {
            setArtist({
              ...event.data,
              albums: [],
              eps: [],
              singles: [],
            });
            setLoadingProfile(false);
          } else if (event.event === "chunk") {
            setArtist((current) => (current ? mergeArtistDiscography(current, event.data) : current));
          } else if (event.event === "done") {
            setArtist((current) =>
              current
                ? { ...current, image_url: event.data.image_url ?? current.image_url }
                : current,
            );
            setLoadingDiscography(false);
          } else if (event.event === "error") {
            throw new Error(event.data.message);
          }
        }
        if (!cancelled) setLoadingDiscography(false);
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Failed to load artist");
          setLoadingProfile(false);
          setLoadingDiscography(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [id]);

  if (loadingProfile && !artist) {
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

  if (error && !artist) {
    return (
      <View className="flex-1 bg-base px-4 pt-6">
        <Text className="text-danger-fg">{error ?? "Artist not found"}</Text>
      </View>
    );
  }

  if (!artist) {
    return (
      <View className="flex-1 bg-base px-4 pt-6">
        <Text className="text-text-muted">Artist not found</Text>
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
                {loadingDiscography && totalReleases === 0
                  ? "Loading releases…"
                  : `${totalReleases}${loadingDiscography ? "+" : ""} ${totalReleases === 1 ? "release" : "releases"}`}
              </Text>
            </View>
          </View>
        </LinearGradient>

        <View className="px-4">
          <ReleaseSection title="Albums" releases={artist.albums} loading={loadingDiscography} />
          <ReleaseSection
            title="EPs"
            releases={artist.eps}
            loading={loadingDiscography && artist.albums.length === 0}
          />
          <ReleaseSection
            title="Singles"
            releases={artist.singles}
            loading={loadingDiscography && artist.albums.length === 0 && artist.eps.length === 0}
          />
          {!loadingDiscography && totalReleases === 0 ? (
            <Text className="text-text-muted">No releases found for this artist.</Text>
          ) : null}
        </View>
      </ScrollView>
    </View>
  );
}
