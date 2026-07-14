import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import { Image, Pressable, Text, View } from "react-native";

import type { ArtistSearchHit } from "@/types";

type Props = {
  artist: ArtistSearchHit;
};

export function ArtistSearchCard({ artist }: Props) {
  return (
    <Pressable
      onPress={() => router.push({ pathname: "/artist/[id]", params: { id: artist.mbid } })}
      className="mb-3 flex-row items-center gap-4 rounded-xl border border-border bg-elevated p-4 active:bg-highlight"
    >
      <View className="h-16 w-16 items-center justify-center overflow-hidden rounded-full bg-highlight">
        {artist.image_url ? (
          <Image source={{ uri: artist.image_url }} className="h-full w-full" />
        ) : (
          <Ionicons name="person" size={28} color="#6a6a6a" />
        )}
      </View>
      <View className="min-w-0 flex-1">
        <Text className="text-xs font-bold uppercase tracking-widest text-accent">Artist</Text>
        <Text className="text-lg font-semibold text-text" numberOfLines={1}>
          {artist.name}
        </Text>
        {artist.disambiguation ? (
          <Text className="text-sm text-text-secondary" numberOfLines={1}>
            {artist.disambiguation}
          </Text>
        ) : null}
      </View>
      <Ionicons name="chevron-forward" size={20} color="#6a6a6a" />
    </Pressable>
  );
}
