import { useEffect, useRef, useState } from "react";
import { Image, Pressable, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { Video, type AVPlaybackStatus } from "expo-av";

import { trackThumbnailUrl } from "@/lib/thumbnails";
import { usePlayerStore } from "@/stores/player";

export default function PlayerScreen() {
  const current = usePlayerStore((state) => state.current);
  const stream = usePlayerStore((state) => state.stream);
  const streamSelection = usePlayerStore((state) => state.streamSelection);
  const mediaUrl = usePlayerStore((state) => state.mediaUrl);
  const playbackKind = usePlayerStore((state) => state.playbackKind);
  const isPlaying = usePlayerStore((state) => state.isPlaying);
  const isLoading = usePlayerStore((state) => state.isLoading);
  const togglePlayback = usePlayerStore((state) => state.togglePlayback);
  const setStreamSelection = usePlayerStore((state) => state.setStreamSelection);
  const registerVideoControls = usePlayerStore((state) => state.registerVideoControls);
  const playNext = usePlayerStore((state) => state.playNext);
  const stop = usePlayerStore((state) => state.stop);
  const videoRef = useRef<Video>(null);
  const positionRef = useRef(0);
  const [artFailed, setArtFailed] = useState(false);

  useEffect(() => {
    registerVideoControls({
      play: async () => {
        await videoRef.current?.playAsync();
      },
      pause: async () => {
        await videoRef.current?.pauseAsync();
      },
      getPositionSec: () => positionRef.current,
      setPositionSec: async (seconds: number) => {
        await videoRef.current?.setPositionAsync(seconds * 1000);
      },
    });
    return () => registerVideoControls(null);
  }, [registerVideoControls]);

  useEffect(() => {
    if (playbackKind !== "video" || !isPlaying) return;
    void videoRef.current?.playAsync();
  }, [playbackKind, mediaUrl, isPlaying]);

  const onVideoStatus = (status: AVPlaybackStatus) => {
    if (!status.isLoaded) return;
    positionRef.current = (status.positionMillis ?? 0) / 1000;
    if (status.didJustFinish) {
      void playNext();
    }
  };

  if (!current) {
    return (
      <View style={styles.container}>
        <Text style={styles.empty}>Nothing playing</Text>
      </View>
    );
  }

  const videoDisabled = !stream?.has_video;

  return (
    <View style={styles.container}>
      {playbackKind === "video" && mediaUrl ? (
        <Video
          ref={videoRef}
          source={{ uri: mediaUrl }}
          style={styles.artwork}
          resizeMode="contain"
          isMuted={!streamSelection.audio}
          shouldPlay={isPlaying}
          useNativeControls
          onPlaybackStatusUpdate={onVideoStatus}
        />
      ) : artFailed ? (
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

      <View style={styles.modeToggle}>
        <Pressable
          style={[styles.modeBtn, streamSelection.audio && styles.modeBtnActive]}
          disabled={isLoading || (streamSelection.audio && !streamSelection.video)}
          onPress={() => void setStreamSelection({ audio: !streamSelection.audio })}
        >
          <Text style={styles.modeBtnText}>Audio</Text>
        </Pressable>
        <Pressable
          style={[styles.modeBtn, streamSelection.video && styles.modeBtnActive]}
          disabled={isLoading || videoDisabled || (streamSelection.video && !streamSelection.audio)}
          onPress={() => void setStreamSelection({ video: !streamSelection.video })}
        >
          <Text style={styles.modeBtnText}>Video</Text>
        </Pressable>
      </View>

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
    backgroundColor: "#000",
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
  modeToggle: {
    flexDirection: "row",
    gap: 8,
    marginTop: 24,
    padding: 4,
    borderRadius: 999,
    backgroundColor: "#171717",
  },
  modeBtn: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 999,
  },
  modeBtnActive: {
    backgroundColor: "#262626",
  },
  modeBtnText: {
    color: "#fff",
    fontSize: 14,
    fontWeight: "600",
  },
  controls: {
    marginTop: 32,
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
