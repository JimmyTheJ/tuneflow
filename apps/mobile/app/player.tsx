import { Ionicons } from "@expo/vector-icons";
import Slider from "@react-native-community/slider";
import { LinearGradient } from "expo-linear-gradient";
import { router } from "expo-router";
import { Video, ResizeMode, type AVPlaybackStatus } from "expo-av";
import { useEffect, useRef, useState } from "react";
import { Image, Pressable, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { LikeButton } from "@/components/ui/LikeButton";
import { IconButton } from "@/components/ui/IconButton";
import { PlaylistPickerModal } from "@/components/PlaylistPickerModal";
import { formatDuration } from "@/lib/time";
import { trackThumbnailUrl } from "@/lib/thumbnails";
import { api } from "@/lib/api";
import {
  canPlayNext,
  canPlayPrevious,
  getQueueView,
  usePlayerStore,
  type RepeatMode,
} from "@/stores/player";
import type { Playlist } from "@/types";

export default function PlayerScreen() {
  const insets = useSafeAreaInsets();
  const current = usePlayerStore((state) => state.current);
  const stream = usePlayerStore((state) => state.stream);
  const streamSelection = usePlayerStore((state) => state.streamSelection);
  const mediaUrl = usePlayerStore((state) => state.mediaUrl);
  const playbackKind = usePlayerStore((state) => state.playbackKind);
  const isPlaying = usePlayerStore((state) => state.isPlaying);
  const isLoading = usePlayerStore((state) => state.isLoading);
  const positionSec = usePlayerStore((state) => state.positionSec);
  const durationSec = usePlayerStore((state) => state.durationSec);
  const volume = usePlayerStore((state) => state.volume);
  const shuffle = usePlayerStore((state) => state.shuffle);
  const shuffleOrder = usePlayerStore((state) => state.shuffleOrder);
  const shuffleStep = usePlayerStore((state) => state.shuffleStep);
  const repeatMode = usePlayerStore((state) => state.repeatMode);
  const queue = usePlayerStore((state) => state.queue);
  const canPrevious = usePlayerStore((state) => canPlayPrevious(state));
  const canNext = usePlayerStore((state) => canPlayNext(state));
  const togglePlayback = usePlayerStore((state) => state.togglePlayback);
  const setStreamSelection = usePlayerStore((state) => state.setStreamSelection);
  const registerVideoControls = usePlayerStore((state) => state.registerVideoControls);
  const playNext = usePlayerStore((state) => state.playNext);
  const playPrevious = usePlayerStore((state) => state.playPrevious);
  const seek = usePlayerStore((state) => state.seek);
  const setVolume = usePlayerStore((state) => state.setVolume);
  const toggleShuffle = usePlayerStore((state) => state.toggleShuffle);
  const cycleRepeatMode = usePlayerStore((state) => state.cycleRepeatMode);
  const stop = usePlayerStore((state) => state.stop);
  const reportProgress = usePlayerStore((state) => state.reportProgress);
  const videoRef = useRef<Video>(null);
  const positionRef = useRef(0);
  const [artFailed, setArtFailed] = useState(false);
  const [seeking, setSeeking] = useState(false);
  const [seekValue, setSeekValue] = useState(0);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [playlists, setPlaylists] = useState<Playlist[]>([]);
  const [status, setStatus] = useState<string | null>(null);

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
    reportProgress(
      positionRef.current,
      status.durationMillis != null ? status.durationMillis / 1000 : undefined,
    );
    if (status.didJustFinish) {
      void playNext(true);
    }
  };

  if (!current) {
    return (
      <View className="flex-1 items-center justify-center bg-base px-6">
        <Text className="text-lg text-text-secondary">Nothing playing</Text>
        <Text className="mt-2 text-center text-sm text-text-muted">
          Pick a track from Search or your Library.
        </Text>
      </View>
    );
  }

  const videoDisabled = !stream?.has_video;
  const displayPosition = seeking ? seekValue : positionSec;
  const max = Math.max(durationSec, 0);
  const artUrl = trackThumbnailUrl(current.video_id);

  const repeatIcon: keyof typeof Ionicons.glyphMap =
    repeatMode === "one" ? "repeat" : "repeat";
  const repeatActive = repeatMode !== "none";

  const queueItems = getQueueView({
    current,
    queue,
    shuffle,
    shuffleOrder,
    shuffleStep,
  });
  const queueTracks = queueItems.map((item) => item.track);

  const showStatus = (message: string) => {
    setStatus(message);
    setTimeout(() => setStatus(null), 2200);
  };

  const openSaveToPlaylist = async () => {
    try {
      setPlaylists(await api.listPlaylists());
      setPickerOpen(true);
    } catch (err) {
      showStatus(err instanceof Error ? err.message : "Could not load playlists");
    }
  };

  return (
    <View className="flex-1 bg-base" style={{ paddingTop: insets.top }}>
      <Image
        source={{ uri: artUrl }}
        blurRadius={40}
        className="absolute inset-0 opacity-40"
        style={{ width: "100%", height: "100%" }}
      />
      <LinearGradient
        colors={["rgba(10,10,10,0.35)", "rgba(10,10,10,0.85)", "#0a0a0a"]}
        className="absolute inset-0"
        style={{ position: "absolute", left: 0, right: 0, top: 0, bottom: 0 }}
      />

      <View className="flex-row items-center justify-between px-4 py-2">
        <IconButton name="chevron-down" label="Close" color="#fff" onPress={() => router.back()} />
        <Text className="text-xs font-bold uppercase tracking-widest text-text-secondary">
          Now Playing
        </Text>
        <IconButton
          name="stop"
          label="Stop"
          color="#fff"
          onPress={() => {
            void stop();
            router.back();
          }}
        />
      </View>

      <View className="flex-1 items-center px-6 pb-6">
        {playbackKind === "video" && mediaUrl ? (
          <Video
            ref={videoRef}
            source={{ uri: mediaUrl }}
            style={{ width: "100%", aspectRatio: 1, borderRadius: 20, backgroundColor: "#000", marginBottom: 28 }}
            resizeMode={ResizeMode.CONTAIN}
            isMuted={!streamSelection.audio}
            shouldPlay={isPlaying}
            useNativeControls
            onPlaybackStatusUpdate={onVideoStatus}
          />
        ) : artFailed ? (
          <View className="mb-7 aspect-square w-[78%] items-center justify-center rounded-2xl bg-highlight">
            <Ionicons name="musical-notes" size={64} color="#6a6a6a" />
          </View>
        ) : (
          <Image
            source={{ uri: artUrl }}
            className="mb-7 aspect-square w-[78%] rounded-2xl bg-highlight"
            style={{ width: "78%", aspectRatio: 1, borderRadius: 20, marginBottom: 28 }}
            onError={() => setArtFailed(true)}
          />
        )}

        <View className="w-full flex-row items-center gap-3">
          <View className="min-w-0 flex-1">
            <Text className="text-2xl font-bold text-text" numberOfLines={2}>
              {current.title}
            </Text>
            <Text className="mt-1 text-lg text-text-secondary" numberOfLines={1}>
              {current.artist ?? "Unknown artist"}
            </Text>
          </View>
          <LikeButton track={current} size="lg" />
        </View>

        <View className="mt-5 flex-row gap-1 rounded-full bg-elevated p-1">
          <Pressable
            className={`rounded-full px-4 py-2 ${streamSelection.audio ? "bg-highlight" : ""}`}
            disabled={isLoading || (streamSelection.audio && !streamSelection.video)}
            onPress={() => void setStreamSelection({ audio: !streamSelection.audio })}
          >
            <Text className="text-sm font-semibold text-text">Audio</Text>
          </Pressable>
          <Pressable
            className={`rounded-full px-4 py-2 ${streamSelection.video ? "bg-highlight" : ""} ${videoDisabled ? "opacity-40" : ""}`}
            disabled={isLoading || videoDisabled || (streamSelection.video && !streamSelection.audio)}
            onPress={() => void setStreamSelection({ video: !streamSelection.video })}
          >
            <Text className="text-sm font-semibold text-text">Video</Text>
          </Pressable>
        </View>

        <View className="mt-6 w-full">
          <Slider
            minimumValue={0}
            maximumValue={max || 1}
            value={Math.min(displayPosition, max || 1)}
            disabled={max <= 0}
            minimumTrackTintColor="#1db954"
            maximumTrackTintColor="#3a3a3a"
            thumbTintColor="#fff"
            onSlidingStart={() => {
              setSeeking(true);
              setSeekValue(positionSec);
            }}
            onValueChange={(value) => setSeekValue(value)}
            onSlidingComplete={(value) => {
              setSeeking(false);
              void seek(value);
            }}
          />
          <View className="mt-1 flex-row justify-between">
            <Text className="text-xs tabular-nums text-text-muted">
              {formatDuration(displayPosition)}
            </Text>
            <Text className="text-xs tabular-nums text-text-muted">
              {formatDuration(durationSec)}
            </Text>
          </View>
        </View>

        <View className="mt-4 w-full flex-row items-center justify-center gap-5">
          <IconButton
            name="shuffle"
            label={shuffle ? "Shuffle on" : "Shuffle off"}
            active={shuffle}
            disabled={queue.length <= 1}
            onPress={() => toggleShuffle()}
          />
          <IconButton
            name="play-skip-back"
            label="Previous"
            color="#fff"
            size="lg"
            disabled={!canPrevious}
            onPress={() => void playPrevious()}
          />
          <Pressable
            accessibilityLabel={isPlaying ? "Pause" : "Play"}
            disabled={isLoading}
            onPress={() => void togglePlayback()}
            className="h-16 w-16 items-center justify-center rounded-full bg-text active:opacity-90"
          >
            <Ionicons
              name={isLoading ? "hourglass-outline" : isPlaying ? "pause" : "play"}
              size={32}
              color="#0a0a0a"
              style={isPlaying || isLoading ? undefined : { marginLeft: 3 }}
            />
          </Pressable>
          <IconButton
            name="play-skip-forward"
            label="Next"
            color="#fff"
            size="lg"
            disabled={!canNext}
            onPress={() => void playNext()}
          />
          <IconButton
            name={repeatIcon}
            label={repeatLabel(repeatMode)}
            active={repeatActive}
            onPress={() => cycleRepeatMode()}
          />
        </View>
        {repeatMode === "one" ? (
          <Text className="-mt-1 text-center text-[10px] font-bold text-accent">1</Text>
        ) : (
          <View className="h-3" />
        )}

        <View className="mt-4 w-full flex-row items-center gap-3">
          <Ionicons
            name={volume === 0 ? "volume-mute" : volume < 0.5 ? "volume-low" : "volume-high"}
            size={18}
            color="#b3b3b3"
          />
          <Slider
            style={{ flex: 1 }}
            minimumValue={0}
            maximumValue={1}
            value={volume}
            minimumTrackTintColor="#1db954"
            maximumTrackTintColor="#3a3a3a"
            thumbTintColor="#fff"
            onValueChange={(value) => void setVolume(value)}
          />
          {queueTracks.length > 0 ? (
            <IconButton
              name="bookmark-outline"
              label="Save queue to playlist"
              color="#fff"
              onPress={() => void openSaveToPlaylist()}
            />
          ) : null}
          <IconButton
            name="list"
            label="Open queue"
            color="#fff"
            onPress={() => router.push("/queue")}
          />
        </View>
        {status ? (
          <Text className="mt-2 text-center text-sm text-accent" role="status">
            {status}
          </Text>
        ) : null}
      </View>

      <PlaylistPickerModal
        visible={pickerOpen}
        title="Save queue to playlist"
        tracks={queueTracks}
        playlists={playlists}
        onClose={() => setPickerOpen(false)}
        onComplete={showStatus}
        onPlaylistsChange={async () => {
          try {
            setPlaylists(await api.listPlaylists());
          } catch {
            /* ignore */
          }
        }}
      />
    </View>
  );
}

function repeatLabel(mode: RepeatMode): string {
  if (mode === "all") return "Repeat playlist";
  if (mode === "one") return "Repeat track";
  return "Repeat off";
}
