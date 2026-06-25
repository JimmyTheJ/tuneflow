import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { usePlayerStore } from "@/stores/player";

export function MiniPlayer() {
  const current = usePlayerStore((state) => state.current);
  const isPlaying = usePlayerStore((state) => state.isPlaying);
  const isLoading = usePlayerStore((state) => state.isLoading);
  const togglePlayback = usePlayerStore((state) => state.togglePlayback);
  const playNext = usePlayerStore((state) => state.playNext);

  if (!current) {
    return null;
  }

  return (
    <Pressable style={styles.container} onPress={() => router.push("/player")}>
      <View style={styles.meta}>
        <Text style={styles.title} numberOfLines={1}>
          {current.title}
        </Text>
        <Text style={styles.artist} numberOfLines={1}>
          {current.artist ?? "Unknown artist"}
        </Text>
      </View>
      <View style={styles.controls}>
        <Pressable onPress={() => void togglePlayback()} hitSlop={12}>
          <Ionicons
            name={isLoading ? "hourglass-outline" : isPlaying ? "pause" : "play"}
            size={24}
            color="#fff"
          />
        </Pressable>
        <Pressable onPress={() => void playNext()} hitSlop={12}>
          <Ionicons name="play-skip-forward" size={22} color="#fff" />
        </Pressable>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 12,
    backgroundColor: "#171717",
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: "#2f2f2f",
  },
  meta: {
    flex: 1,
    gap: 2,
  },
  title: {
    color: "#fff",
    fontSize: 15,
    fontWeight: "600",
  },
  artist: {
    color: "#a3a3a3",
    fontSize: 13,
  },
  controls: {
    flexDirection: "row",
    alignItems: "center",
    gap: 16,
  },
});
