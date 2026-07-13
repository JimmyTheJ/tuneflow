import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { useState, type ReactNode } from "react";
import { Image, Pressable, Text, View } from "react-native";

import { Badge } from "@/components/ui/Badge";
import { trackThumbnailUrl } from "@/lib/thumbnails";
import {
  extractTrackBadges,
  formatTrackArtist,
  trackDetailLine,
} from "@/lib/tracks";
import { formatDuration } from "@/lib/time";
import type { Track } from "@/types";

type Props = {
  track: Track;
  onPress?: () => void;
  subtitle?: string;
  displayTitle?: string;
  showDuration?: boolean;
  showBadges?: boolean;
  index?: number;
  trailing?: ReactNode;
  active?: boolean;
};

export function TrackRow({
  track,
  onPress,
  subtitle,
  displayTitle,
  showDuration = true,
  showBadges = false,
  index,
  trailing,
  active = false,
}: Props) {
  const [failed, setFailed] = useState(false);
  const title = displayTitle ?? track.title;
  const artistLine = subtitle ?? formatTrackArtist(track.artist);
  const badges = showBadges ? extractTrackBadges(title, track.artist) : [];
  const detailLine = showBadges ? trackDetailLine(track) : null;
  const duration =
    showDuration && track.duration_sec != null && track.duration_sec > 0
      ? formatDuration(track.duration_sec)
      : null;

  return (
    <Pressable
      className={`flex-row items-center gap-3 rounded-lg px-1 py-2 active:bg-highlight/80 ${active ? "bg-accent/10" : ""}`}
      onPress={onPress}
      disabled={!onPress}
    >
      {index != null ? (
        <Text className="w-5 text-center text-sm tabular-nums text-text-muted">{index}</Text>
      ) : null}
      {failed ? (
        <LinearGradient
          colors={["#1f1f1f", "#2a2a2a"]}
          className="h-[52px] w-[52px] items-center justify-center rounded-md"
          style={{ width: 52, height: 52, borderRadius: 8, alignItems: "center", justifyContent: "center" }}
        >
          <Ionicons name="musical-notes" size={20} color="#6a6a6a" />
        </LinearGradient>
      ) : (
        <Image
          source={{ uri: trackThumbnailUrl(track.video_id) }}
          className="h-[52px] w-[52px] rounded-md bg-highlight"
          onError={() => setFailed(true)}
        />
      )}
      <View className="min-w-0 flex-1 gap-1">
        <View className="flex-row items-start gap-2">
          <Text className={`flex-1 text-base font-semibold ${active ? "text-accent" : "text-text"}`} numberOfLines={2}>
            {title}
          </Text>
          {duration ? <Text className="text-[13px] tabular-nums text-text-secondary">{duration}</Text> : null}
        </View>
        <View className="flex-row flex-wrap items-center gap-1.5">
          <Text className="shrink text-sm text-text-secondary" numberOfLines={1}>
            {artistLine}
          </Text>
          {badges.map((badge) => (
            <Badge key={badge}>{badge}</Badge>
          ))}
        </View>
        {detailLine ? (
          <Text className="text-xs leading-4 text-text-muted" numberOfLines={2}>
            {detailLine}
          </Text>
        ) : null}
      </View>
      {trailing}
    </Pressable>
  );
}
