import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import { useState } from "react";
import { Image, Pressable, Text, View } from "react-native";

import { LikeButton } from "@/components/ui/LikeButton";
import { IconButton } from "@/components/ui/IconButton";
import { trackThumbnailUrl } from "@/lib/thumbnails";
import { canPlayNext, usePlayerStore } from "@/stores/player";

export function MiniPlayer() {
  const current = usePlayerStore((state) => state.current);
  const isPlaying = usePlayerStore((state) => state.isPlaying);
  const isLoading = usePlayerStore((state) => state.isLoading);
  const positionSec = usePlayerStore((state) => state.positionSec);
  const durationSec = usePlayerStore((state) => state.durationSec);
  const canNext = usePlayerStore((state) => canPlayNext(state));
  const togglePlayback = usePlayerStore((state) => state.togglePlayback);
  const playNext = usePlayerStore((state) => state.playNext);
  const [artFailed, setArtFailed] = useState(false);

  if (!current) {
    return null;
  }

  const progress = durationSec > 0 ? Math.min(1, positionSec / durationSec) : 0;

  return (
    <View className="border-t border-border bg-elevated/95">
      <View className="h-0.5 w-full bg-border-strong">
        <View className="h-full bg-accent" style={{ width: `${progress * 100}%` }} />
      </View>
      <Pressable
        className="flex-row items-center gap-3 px-3 py-2.5 active:opacity-90"
        onPress={() => router.push("/player")}
      >
        {artFailed ? (
          <View className="h-12 w-12 items-center justify-center rounded-md bg-highlight">
            <Ionicons name="musical-notes" size={20} color="#6a6a6a" />
          </View>
        ) : (
          <Image
            source={{ uri: trackThumbnailUrl(current.video_id) }}
            className="h-12 w-12 rounded-md bg-highlight"
            onError={() => setArtFailed(true)}
          />
        )}
        <View className="min-w-0 flex-1">
          <Text className="text-[15px] font-semibold text-text" numberOfLines={1}>
            {current.title}
          </Text>
          <Text className="text-[13px] text-text-secondary" numberOfLines={1}>
            {current.artist ?? "Unknown artist"}
          </Text>
        </View>
        <LikeButton track={current} size="sm" />
        <IconButton
          name={isLoading ? "hourglass-outline" : isPlaying ? "pause" : "play"}
          label={isPlaying ? "Pause" : "Play"}
          color="#fff"
          size="sm"
          onPress={() => void togglePlayback()}
        />
        <IconButton
          name="play-skip-forward"
          label="Next"
          color="#fff"
          size="sm"
          disabled={!canNext}
          onPress={() => void playNext()}
        />
      </Pressable>
    </View>
  );
}
