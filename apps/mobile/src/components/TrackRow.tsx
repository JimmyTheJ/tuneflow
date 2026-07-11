import { useState } from "react";
import { Image, Pressable, StyleSheet, Text, View } from "react-native";

import { trackThumbnailUrl } from "@/lib/thumbnails";
import {
  extractTrackBadges,
  formatTrackArtist,
  trackDetailLine,
  trackDisplayTitle,
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
  trailing?: React.ReactNode;
};

export function TrackRow({
  track,
  onPress,
  subtitle,
  displayTitle,
  showDuration = true,
  showBadges = false,
  trailing,
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
    <Pressable style={styles.row} onPress={onPress}>
      {failed ? (
        <View style={[styles.thumbnail, styles.thumbnailFallback]} />
      ) : (
        <Image
          source={{ uri: trackThumbnailUrl(track.video_id) }}
          style={styles.thumbnail}
          onError={() => setFailed(true)}
        />
      )}
      <View style={styles.meta}>
        <View style={styles.titleRow}>
          <Text style={styles.title} numberOfLines={2}>
            {title}
          </Text>
          {duration ? <Text style={styles.duration}>{duration}</Text> : null}
        </View>
        <View style={styles.subtitleRow}>
          <Text style={styles.subtitle} numberOfLines={1}>
            {artistLine}
          </Text>
          {badges.length > 0 ? (
            <View style={styles.badges}>
              {badges.map((badge) => (
                <View key={badge} style={styles.badge}>
                  <Text style={styles.badgeText}>{badge}</Text>
                </View>
              ))}
            </View>
          ) : null}
        </View>
        {detailLine ? (
          <Text style={styles.detail} numberOfLines={2}>
            {detailLine}
          </Text>
        ) : null}
      </View>
      {trailing}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingVertical: 10,
  },
  thumbnail: {
    width: 52,
    height: 52,
    borderRadius: 8,
    backgroundColor: "#1f1f1f",
  },
  thumbnailFallback: {
    backgroundColor: "#2a2a2a",
  },
  meta: {
    flex: 1,
    gap: 4,
  },
  titleRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 8,
  },
  title: {
    color: "#fff",
    fontSize: 16,
    fontWeight: "600",
    flex: 1,
  },
  duration: {
    color: "#a3a3a3",
    fontSize: 13,
    fontVariant: ["tabular-nums"],
  },
  subtitleRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    flexWrap: "wrap",
  },
  subtitle: {
    color: "#a3a3a3",
    fontSize: 14,
    flexShrink: 1,
  },
  badges: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 4,
  },
  badge: {
    backgroundColor: "#262626",
    borderRadius: 999,
    paddingHorizontal: 6,
    paddingVertical: 1,
  },
  badgeText: {
    color: "#d4d4d4",
    fontSize: 10,
    fontWeight: "700",
    textTransform: "uppercase",
  },
  detail: {
    color: "#737373",
    fontSize: 12,
    lineHeight: 16,
  },
});
