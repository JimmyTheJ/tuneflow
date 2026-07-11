import { useState } from "react";
import { Image, Pressable, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";

import { trackThumbnailUrl } from "@/lib/thumbnails";
import { usePlayerStore } from "@/stores/player";

export default function PlayerScreen() {
  const current = usePlayerStore((state) => state.current);
  const isPlaying = usePlayerStore((state) => state.isPlaying);
  const isLoading = usePlayerStore((state) => state.isLoading);
  const togglePlayback = usePlayerStore((state) => state.togglePlayback);
  const playNext = usePlayerStore((state) => state.playNext);
  const stop = usePlayerStore((state) => state.stop);
  const [artFailed, setArtFailed] = useState(false);

  if (!current) {
    return (
      <View style={styles.container}>
        <Text style={styles.empty}>Nothing playing</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {artFailed ? (
        <View style={[styles.artwork, styles.artworkFallback]} />
      ) : (
        <Image
          source={{ uri: trackThumbnailUrl(current.video_id) }}
          style={styles.artwork}
          onError={() => setArtFailed(true)}
        />
      )}

      <Text style={styles.title}>{current.title}</Text>
      <Text style={styles.artist}>{current.artist ?? "Unknown artist"}</Text>

      <View style={styles.controls}>
        <Pressable onPress={() => void stop()} hitSlop={12}>
          <Ionicons name="stop" size={28} color="#fff" />
        </Pressable>
        <Pressable onPress={() => void togglePlayback()} hitSlop={12}>
          <Ionicons
            name={isLoading ? "hourglass-outline" : isPlaying ? "pause-circle" : "play-circle"}
            size={72}
            color="#22c55e"
          />
        </Pressable>
        <Pressable onPress={() => void playNext()} hitSlop={12}>
          <Ionicons name="play-skip-forward" size={28} color="#fff" />
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#0a0a0a",
    paddingHorizontal: 24,
    paddingTop: 48,
    alignItems: "center",
  },
  artwork: {
    width: 280,
    height: 280,
    borderRadius: 20,
    marginBottom: 32,
  },
  artworkFallback: {
    backgroundColor: "#1f1f1f",
  },
  title: {
    color: "#fff",
    fontSize: 24,
    fontWeight: "700",
    textAlign: "center",
  },
  artist: {
    color: "#a3a3a3",
    fontSize: 18,
    marginTop: 8,
    textAlign: "center",
  },
  controls: {
    marginTop: 48,
    flexDirection: "row",
    alignItems: "center",
    gap: 36,
  },
  empty: {
    color: "#737373",
    fontSize: 16,
    marginTop: 48,
  },
});
