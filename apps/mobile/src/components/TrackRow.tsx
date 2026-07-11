import { useState } from "react";
import { Image, Pressable, StyleSheet, Text, View } from "react-native";

import { trackThumbnailUrl } from "@/lib/thumbnails";
import type { Track } from "@/types";

type Props = {
  track: Track;
  onPress?: () => void;
  subtitle?: string;
  trailing?: React.ReactNode;
};

export function TrackRow({ track, onPress, subtitle, trailing }: Props) {
  const [failed, setFailed] = useState(false);

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
        <Text style={styles.title} numberOfLines={1}>
          {track.title}
        </Text>
        <Text style={styles.subtitle} numberOfLines={1}>
          {subtitle ?? track.artist ?? "Unknown artist"}
        </Text>
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
  title: {
    color: "#fff",
    fontSize: 16,
    fontWeight: "600",
  },
  subtitle: {
    color: "#a3a3a3",
    fontSize: 14,
  },
});
