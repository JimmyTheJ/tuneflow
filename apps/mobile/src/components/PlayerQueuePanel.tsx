import { Ionicons } from "@expo/vector-icons";
import { useCallback, useMemo, useState } from "react";
import { Pressable, Text, View } from "react-native";
import DraggableFlatList, {
  NestableDraggableFlatList,
  OpacityDecorator,
  ScaleDecorator,
  type RenderItemParams,
} from "react-native-draggable-flatlist";

import { PlaylistPickerModal } from "@/components/PlaylistPickerModal";
import { TrackRow } from "@/components/TrackRow";
import { Button } from "@/components/ui/Button";
import { IconButton } from "@/components/ui/IconButton";
import { api } from "@/lib/api";
import { getQueueView, usePlayerStore, type QueueViewItem } from "@/stores/player";
import type { Playlist } from "@/types";

type Props = {
  /** When true, use nestable list for placement inside NestableScrollContainer. */
  embedded?: boolean;
};

export function PlayerQueuePanel({ embedded = false }: Props) {
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

  const [pickerOpen, setPickerOpen] = useState(false);
  const [playlists, setPlaylists] = useState<Playlist[]>([]);
  const [status, setStatus] = useState<string | null>(null);

  const items = getQueueView({ current, queue, shuffle, shuffleOrder, shuffleStep });
  const playingItem = items.find((item) => item.status === "playing") ?? null;
  const upcomingItems = useMemo(
    () => items.filter((item) => item.status === "upcoming"),
    [items],
  );
  const queueTracks = items.map((item) => item.track);
  const firstUpcomingItem = upcomingItems[0] ?? null;

  const showStatus = useCallback((message: string) => {
    setStatus(message);
    setTimeout(() => setStatus(null), 1100);
  }, []);

  const openSaveToPlaylist = async () => {
    try {
      setPlaylists(await api.listPlaylists());
      setPickerOpen(true);
    } catch (err) {
      showStatus(err instanceof Error ? err.message : "Could not load playlists");
    }
  };

  const reloadPlaylists = async () => {
    try {
      setPlaylists(await api.listPlaylists());
    } catch {
      /* ignore */
    }
  };

  const handleDragEnd = useCallback(
    ({ from, to }: { from: number; to: number }) => {
      if (from === to) return;
      const moved = upcomingItems[from];
      const target = upcomingItems[to];
      if (!moved || !target) return;
      reorderQueue(moved.queueIndex, target.queueIndex);
    },
    [upcomingItems, reorderQueue],
  );

  const renderItem = useCallback(
    ({ item, drag, isActive }: RenderItemParams<QueueViewItem>) => {
      const canMoveToTop =
        firstUpcomingItem != null && item.queueIndex !== firstUpcomingItem.queueIndex;

      return (
        <ScaleDecorator activeScale={1.03}>
          <OpacityDecorator activeOpacity={0.9}>
            <View
              className={`mb-0.5 flex-row items-center rounded-lg ${
                isActive ? "bg-highlight/80" : ""
              }`}
            >
              <Pressable
                className="px-1 py-3"
                onLongPress={drag}
                delayLongPress={180}
                accessibilityLabel={`Reorder ${item.track.title}`}
              >
                <Ionicons name="menu" size={18} color="#6a6a6a" />
              </Pressable>
              <View className="min-w-0 flex-1">
                <TrackRow
                  track={item.track}
                  showBadges
                  displayTitle={item.track.source_title ?? item.track.title}
                  subtitle={item.track.artist ?? "Unknown artist"}
                  onPress={isActive ? undefined : () => void playQueueIndex(item.queueIndex)}
                  onLongPress={drag}
                />
              </View>
              {!isActive ? (
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
                  <IconButton
                    name="close"
                    label={`Remove ${item.track.title}`}
                    size="sm"
                    onPress={() => void removeQueueIndex(item.queueIndex)}
                  />
                </View>
              ) : null}
            </View>
          </OpacityDecorator>
        </ScaleDecorator>
      );
    },
    [firstUpcomingItem, moveQueueToTop, playQueueIndex, removeQueueIndex],
  );

  const header = (
    <View className={embedded ? "px-1" : "px-4 pt-4"}>
      <View className="flex-row items-start justify-between gap-3">
        <View className="min-w-0 flex-1">
          <Text className="text-lg font-bold text-text">Queue</Text>
          <Text className="mt-1 text-sm text-text-secondary">
            {upcomingItems.length > 0 ? `${upcomingItems.length} up next` : "Last track"}
            {shuffle ? " · Shuffle on" : ""}
            {repeatMode === "all" ? " · Repeat all" : repeatMode === "one" ? " · Repeat one" : ""}
          </Text>
          {upcomingItems.length > 1 ? (
            <Text className="mt-1 text-xs text-text-muted">Hold and drag to reorder</Text>
          ) : null}
        </View>
        <View className="flex-row flex-wrap items-center justify-end gap-2">
          {queueTracks.length > 0 ? (
            <Button variant="ghost" size="sm" onPress={() => void openSaveToPlaylist()}>
              Save to playlist
            </Button>
          ) : null}
          {upcomingItems.length > 0 ? (
            <Button variant="ghost" size="sm" onPress={clearUpcoming}>
              Clear upcoming
            </Button>
          ) : null}
        </View>
      </View>

      {status ? (
        <Text className="pt-2 text-sm text-accent" role="status">
          {status}
        </Text>
      ) : null}

      {playingItem ? (
        <View className="mt-3 mb-0.5 flex-row items-center rounded-lg bg-accent/10">
          <View className="w-7" />
          <View className="min-w-0 flex-1">
            <TrackRow
              track={playingItem.track}
              active
              showBadges
              displayTitle={playingItem.track.source_title ?? playingItem.track.title}
              subtitle={`Now playing · ${playingItem.track.artist ?? "Unknown artist"}`}
            />
          </View>
        </View>
      ) : null}
    </View>
  );

  if (items.length === 0) {
    return (
      <View className={embedded ? "px-1 pt-6" : "flex-1 bg-base px-4 pt-4"}>
        <Text className="text-lg font-bold text-text">Queue</Text>
        <Text className="mt-3 text-sm text-text-secondary">Nothing in the queue yet.</Text>
      </View>
    );
  }

  const listProps = {
    data: upcomingItems,
    keyExtractor: (item: QueueViewItem) => `${item.queueIndex}-${item.track.video_id}`,
    onDragEnd: handleDragEnd,
    renderItem,
    activationDistance: 12,
  };

  return (
    <View className={embedded ? "mt-6 w-full" : "flex-1 bg-base"}>
      {embedded ? (
        <>
          {header}
          <NestableDraggableFlatList
            {...listProps}
            scrollEnabled={false}
            ListEmptyComponent={
              playingItem != null ? (
                <Text className="px-1 pb-4 text-sm text-text-muted">No upcoming tracks</Text>
              ) : null
            }
            contentContainerStyle={{ paddingBottom: 8 }}
          />
        </>
      ) : (
        <DraggableFlatList
          {...listProps}
          ListHeaderComponent={header}
          ListEmptyComponent={
            playingItem != null ? (
              <Text className="px-4 pb-4 text-sm text-text-muted">No upcoming tracks</Text>
            ) : null
          }
          contentContainerStyle={{ paddingBottom: 40, flexGrow: 1 }}
          containerStyle={{ flex: 1 }}
        />
      )}

      <PlaylistPickerModal
        visible={pickerOpen}
        title="Save queue to playlist"
        tracks={queueTracks}
        playlists={playlists}
        onClose={() => setPickerOpen(false)}
        onComplete={showStatus}
        onPlaylistsChange={() => void reloadPlaylists()}
      />
    </View>
  );
}
