import { Ionicons } from "@expo/vector-icons";
import { useEffect, useState } from "react";
import { FlatList, Modal, Pressable, Text, TextInput, View } from "react-native";

import { CreatePlaylistDialog } from "@/components/CreatePlaylistDialog";
import { Button } from "@/components/ui/Button";
import { api } from "@/lib/api";
import {
  addTracksToPlaylist,
  filterPlaylists,
  formatBulkAddMessage,
  suggestedPlaylistName,
} from "@/lib/playlistUtils";
import type { Playlist, Track } from "@/types";

type Props = {
  visible: boolean;
  title: string;
  tracks: Track[];
  playlists: Playlist[];
  onClose: () => void;
  onComplete: (message: string) => void;
  onPlaylistsChange: () => void;
};

export function PlaylistPickerModal({
  visible,
  title,
  tracks,
  playlists,
  onClose,
  onComplete,
  onPlaylistsChange,
}: Props) {
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [namingOpen, setNamingOpen] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  useEffect(() => {
    if (!visible) {
      setQuery("");
      setError(null);
      setBusy(false);
      setNamingOpen(false);
      setCreateError(null);
    }
  }, [visible]);

  const filtered = filterPlaylists(playlists, query);

  const handleSelect = async (playlistId: number, playlistName: string) => {
    if (busy || tracks.length === 0) return;
    setBusy(true);
    setError(null);
    try {
      const result = await addTracksToPlaylist(playlistId, tracks, api.addTrackToPlaylist);
      onComplete(formatBulkAddMessage(playlistName, result));
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not add to playlist");
    } finally {
      setBusy(false);
    }
  };

  const handleCreate = async (name: string) => {
    if (busy || tracks.length === 0) return;
    setBusy(true);
    setCreateError(null);
    try {
      const playlist = await api.createPlaylist(name);
      onPlaylistsChange();
      const result = await addTracksToPlaylist(playlist.id, tracks, api.addTrackToPlaylist);
      onComplete(formatBulkAddMessage(playlist.name, result));
      setNamingOpen(false);
      onClose();
    } catch (err) {
      setCreateError(err instanceof Error ? err.message : "Could not create playlist");
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
        <View className="flex-1 justify-end bg-black/70">
          <Pressable className="flex-1" onPress={busy ? undefined : onClose} />
          <View className="max-h-[80%] rounded-t-2xl border border-border bg-elevated">
            <View className="border-b border-border px-5 py-4">
              <Text className="text-xl font-bold text-text">{title}</Text>
              {tracks.length > 1 ? (
                <Text className="mt-1 text-sm text-text-secondary">{tracks.length} tracks</Text>
              ) : null}
            </View>

            <View className="px-5 py-3">
              <View className="relative">
                <Ionicons
                  name="search"
                  size={18}
                  color="#6a6a6a"
                  style={{ position: "absolute", left: 14, top: 14, zIndex: 1 }}
                />
                <TextInput
                  value={query}
                  onChangeText={setQuery}
                  placeholder="Search playlists"
                  placeholderTextColor="#6a6a6a"
                  className="rounded-xl border border-border bg-base py-3 pl-11 pr-4 text-base text-text"
                  editable={!busy}
                />
              </View>
            </View>

            <FlatList
              data={filtered}
              keyExtractor={(item) => String(item.id)}
              style={{ maxHeight: 280 }}
              ListEmptyComponent={
                <Text className="px-5 py-3 text-sm text-text-muted">
                  {playlists.length === 0 ? "No playlists yet" : "No playlists match your search"}
                </Text>
              }
              renderItem={({ item }) => (
                <Pressable
                  className="px-5 py-3 active:bg-highlight"
                  disabled={busy}
                  onPress={() => void handleSelect(item.id, item.name)}
                >
                  <Text className="text-base font-medium text-text">{item.name}</Text>
                  <Text className="text-sm text-text-muted">{item.track_count} tracks</Text>
                </Pressable>
              )}
            />

            <View className="border-t border-border px-5 py-4">
              {error ? <Text className="mb-3 text-sm text-danger-fg">{error}</Text> : null}
              <View className="flex-row gap-3">
                <Button variant="secondary" className="flex-1" onPress={onClose} disabled={busy}>
                  Cancel
                </Button>
                <Button
                  className="flex-1"
                  onPress={() => {
                    setCreateError(null);
                    setNamingOpen(true);
                  }}
                  disabled={busy}
                  loading={busy}
                >
                  New playlist
                </Button>
              </View>
            </View>
          </View>
        </View>
      </Modal>

      <CreatePlaylistDialog
        visible={namingOpen}
        defaultName={suggestedPlaylistName(playlists.length)}
        busy={busy}
        error={createError}
        onConfirm={handleCreate}
        onCancel={() => {
          if (busy) return;
          setNamingOpen(false);
          setCreateError(null);
        }}
      />
    </>
  );
}
