import { Ionicons } from "@expo/vector-icons";
import { useState } from "react";
import { Modal, Pressable, Text, View } from "react-native";

import { PlaylistPickerModal } from "@/components/PlaylistPickerModal";
import { IconButton } from "@/components/ui/IconButton";
import { api } from "@/lib/api";
import { usePlayerStore } from "@/stores/player";
import type { Playlist, Track } from "@/types";

type Props = {
  track: Track;
  playQueue?: Track[];
  playlists: Playlist[];
  disabled?: boolean;
  onPlaylistsChange: () => void;
};

export function TrackActionsMenu({
  track,
  playQueue = [],
  playlists,
  disabled = false,
  onPlaylistsChange,
}: Props) {
  const playTrack = usePlayerStore((state) => state.playTrack);
  const addToQueue = usePlayerStore((state) => state.addToQueue);
  const [menuOpen, setMenuOpen] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [status, setStatus] = useState<string | null>(null);

  const showStatus = (message: string) => {
    setStatus(message);
    setTimeout(() => setStatus(null), 2200);
  };

  const handlePlay = () => {
    setMenuOpen(false);
    const queue = playQueue.length > 0 ? playQueue : [track];
    void playTrack(track, queue);
  };

  const handleAddToQueue = () => {
    addToQueue(track);
    setMenuOpen(false);
    showStatus("Added to queue");
  };

  return (
    <>
      <IconButton
        name="ellipsis-horizontal"
        label={`Actions for ${track.title}`}
        size="sm"
        disabled={disabled}
        onPress={() => setMenuOpen(true)}
      />

      <Modal visible={menuOpen} transparent animationType="fade" onRequestClose={() => setMenuOpen(false)}>
        <Pressable className="flex-1 justify-end bg-black/70" onPress={() => setMenuOpen(false)}>
          <Pressable className="rounded-t-2xl border border-border bg-elevated p-2" onPress={(event) => event.stopPropagation()}>
            <Text className="px-3 py-2 text-base font-semibold text-text" numberOfLines={2}>
              {track.title}
            </Text>
            <Pressable className="rounded-lg px-3 py-3 active:bg-highlight" onPress={handlePlay}>
              <Text className="text-base text-text">Play now</Text>
            </Pressable>
            <Pressable className="rounded-lg px-3 py-3 active:bg-highlight" onPress={handleAddToQueue}>
              <Text className="text-base text-text">Add to queue</Text>
            </Pressable>
            <Pressable
              className="rounded-lg px-3 py-3 active:bg-highlight"
              onPress={() => {
                setMenuOpen(false);
                setPickerOpen(true);
              }}
            >
              <Text className="text-base text-text">Add to playlist…</Text>
            </Pressable>
            <Pressable className="mt-1 rounded-lg px-3 py-3 active:bg-highlight" onPress={() => setMenuOpen(false)}>
              <Text className="text-center text-base font-semibold text-text-secondary">Cancel</Text>
            </Pressable>
            {status ? (
              <Text className="px-3 py-2 text-sm text-accent" role="status">
                {status}
              </Text>
            ) : null}
          </Pressable>
        </Pressable>
      </Modal>

      <PlaylistPickerModal
        visible={pickerOpen}
        title="Add to playlist"
        tracks={[track]}
        playlists={playlists}
        onClose={() => setPickerOpen(false)}
        onComplete={showStatus}
        onPlaylistsChange={onPlaylistsChange}
      />
    </>
  );
}
