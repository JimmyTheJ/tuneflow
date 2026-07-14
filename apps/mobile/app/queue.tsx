import { Ionicons } from "@expo/vector-icons";
import { Pressable, ScrollView, Text, View } from "react-native";

import { TrackRow } from "@/components/TrackRow";
import { Button } from "@/components/ui/Button";
import { IconButton } from "@/components/ui/IconButton";
import { getQueueView, usePlayerStore } from "@/stores/player";

export default function QueueScreen() {
  const current = usePlayerStore((s) => s.current);
  const queue = usePlayerStore((s) => s.queue);
  const shuffle = usePlayerStore((s) => s.shuffle);
  const shuffleOrder = usePlayerStore((s) => s.shuffleOrder);
  const shuffleStep = usePlayerStore((s) => s.shuffleStep);
  const repeatMode = usePlayerStore((s) => s.repeatMode);
  const playQueueIndex = usePlayerStore((s) => s.playQueueIndex);
  const removeQueueIndex = usePlayerStore((s) => s.removeQueueIndex);
  const clearUpcoming = usePlayerStore((s) => s.clearUpcoming);
  const reorderQueue = usePlayerStore((s) => s.reorderQueue);
  const moveQueueToTop = usePlayerStore((s) => s.moveQueueToTop);

  const items = getQueueView({ current, queue, shuffle, shuffleOrder, shuffleStep });
  const upcomingCount = items.filter((item) => item.status === "upcoming").length;
  const firstUpcomingItem = items.find((item) => item.status === "upcoming");

  if (items.length === 0) {
    return (
      <View className="flex-1 bg-base px-4 pt-4">
        <Text className="text-lg font-bold text-text">Queue</Text>
        <Text className="mt-3 text-sm text-text-secondary">Nothing in the queue yet.</Text>
      </View>
    );
  }

  return (
    <View className="flex-1 bg-base">
      <View className="flex-row items-start justify-between gap-3 px-4 pt-4">
        <View className="min-w-0 flex-1">
          <Text className="text-lg font-bold text-text">Queue</Text>
          <Text className="mt-1 text-sm text-text-secondary">
            {upcomingCount > 0 ? `${upcomingCount} up next` : "Last track"}
            {shuffle ? " · Shuffle on" : ""}
            {repeatMode === "all" ? " · Repeat all" : repeatMode === "one" ? " · Repeat one" : ""}
          </Text>
        </View>
        {upcomingCount > 0 ? (
          <Button variant="ghost" size="sm" onPress={clearUpcoming}>
            Clear upcoming
          </Button>
        ) : null}
      </View>

      <ScrollView className="mt-3 flex-1 px-3" contentContainerStyle={{ paddingBottom: 40 }}>
        {items.map((item, visualIndex) => {
          const isUpcoming = item.status === "upcoming";
          const isPlaying = item.status === "playing";
          const canMoveUp = isUpcoming && visualIndex > 1;
          const canMoveDown = isUpcoming && visualIndex < items.length - 1;
          const canMoveToTop =
            isUpcoming &&
            firstUpcomingItem != null &&
            item.queueIndex !== firstUpcomingItem.queueIndex;

          return (
            <View
              key={`${item.queueIndex}-${item.track.video_id}`}
              className={`mb-0.5 flex-row items-center rounded-lg ${isPlaying ? "bg-accent/10" : ""}`}
            >
              <View className="min-w-0 flex-1">
                <TrackRow
                  track={item.track}
                  active={isPlaying}
                  showBadges
                  displayTitle={item.track.source_title ?? item.track.title}
                  subtitle={
                    isPlaying
                      ? `Now playing · ${item.track.artist ?? "Unknown artist"}`
                      : (item.track.artist ?? "Unknown artist")
                  }
                  onPress={isUpcoming ? () => void playQueueIndex(item.queueIndex) : undefined}
                />
              </View>
              {isUpcoming ? (
                <View className="flex-row items-center pr-1">
                  {canMoveToTop ? (
                    <Pressable
                      className="p-1.5"
                      onPress={() => moveQueueToTop(item.queueIndex)}
                      hitSlop={6}
                      accessibilityLabel={`Play ${item.track.title} next`}
                    >
                      <Ionicons name="play-skip-forward" size={16} color="#b3b3b3" />
                    </Pressable>
                  ) : null}
                  <Pressable
                    disabled={!canMoveUp}
                    className={`p-1.5 ${canMoveUp ? "" : "opacity-25"}`}
                    onPress={() => {
                      const prev = items[visualIndex - 1];
                      if (prev) reorderQueue(item.queueIndex, prev.queueIndex);
                    }}
                    hitSlop={6}
                  >
                    <Ionicons name="chevron-up" size={16} color="#b3b3b3" />
                  </Pressable>
                  <Pressable
                    disabled={!canMoveDown}
                    className={`p-1.5 ${canMoveDown ? "" : "opacity-25"}`}
                    onPress={() => {
                      const next = items[visualIndex + 1];
                      if (next) reorderQueue(item.queueIndex, next.queueIndex);
                    }}
                    hitSlop={6}
                  >
                    <Ionicons name="chevron-down" size={16} color="#b3b3b3" />
                  </Pressable>
                  <IconButton
                    name="close"
                    label={`Remove ${item.track.title}`}
                    size="sm"
                    onPress={() => void removeQueueIndex(item.queueIndex)}
                  />
                </View>
              ) : null}
            </View>
          );
        })}
      </ScrollView>
    </View>
  );
}
