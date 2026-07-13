import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { useState, type ReactNode } from "react";
import { Image, Pressable, Text, View } from "react-native";

import { trackThumbnailUrl } from "@/lib/thumbnails";

type Props = {
  title: string;
  subtitle?: string;
  videoId?: string;
  cover?: ReactNode;
  accent?: boolean;
  onPress?: () => void;
  onPlay?: () => void;
  className?: string;
};

export function MediaCard({
  title,
  subtitle,
  videoId,
  cover,
  accent = false,
  onPress,
  onPlay,
  className,
}: Props) {
  const [failed, setFailed] = useState(false);

  return (
    <Pressable
      onPress={onPress ?? onPlay}
      className={`gap-2 rounded-xl bg-elevated p-3 active:bg-highlight ${className ?? ""}`}
    >
      <View className="relative aspect-square w-full overflow-hidden rounded-lg">
        {cover ? (
          cover
        ) : videoId && !failed ? (
          <Image
            source={{ uri: trackThumbnailUrl(videoId) }}
            className="h-full w-full"
            onError={() => setFailed(true)}
          />
        ) : (
          <LinearGradient
            colors={accent ? ["#7c3aed", "#4c1d95"] : ["#1f1f1f", "#2a2a2a"]}
            className="h-full w-full items-center justify-center"
            style={{ flex: 1 }}
          >
            <View className="flex-1 items-center justify-center">
              <Ionicons name="musical-notes" size={36} color="#6a6a6a" />
            </View>
          </LinearGradient>
        )}
        {onPlay ? (
          <Pressable
            accessibilityLabel={`Play ${title}`}
            onPress={(e) => {
              e.stopPropagation?.();
              onPlay();
            }}
            className="absolute bottom-2 right-2 h-11 w-11 items-center justify-center rounded-full bg-accent shadow-lg active:bg-accent-hover"
          >
            <Ionicons name="play" size={22} color="#052e16" style={{ marginLeft: 2 }} />
          </Pressable>
        ) : null}
      </View>
      <View>
        <Text className="font-semibold text-text" numberOfLines={1}>
          {title}
        </Text>
        {subtitle ? (
          <Text className="mt-0.5 text-sm text-text-secondary" numberOfLines={1}>
            {subtitle}
          </Text>
        ) : null}
      </View>
    </Pressable>
  );
}
