import { useEffect, useState } from "react";
import { Modal, Pressable, Text, TextInput, View } from "react-native";

import { Button } from "@/components/ui/Button";

type Props = {
  visible: boolean;
  defaultName?: string;
  busy?: boolean;
  error?: string | null;
  onConfirm: (name: string) => void | Promise<void>;
  onCancel: () => void;
};

export function CreatePlaylistDialog({
  visible,
  defaultName = "",
  busy = false,
  error = null,
  onConfirm,
  onCancel,
}: Props) {
  const [name, setName] = useState(defaultName);

  useEffect(() => {
    if (visible) {
      setName(defaultName);
    }
  }, [defaultName, visible]);

  const trimmed = name.trim();
  const canSubmit = trimmed.length > 0 && !busy;

  const submit = () => {
    if (!canSubmit) return;
    void onConfirm(trimmed);
  };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onCancel}>
      <View className="flex-1 justify-center bg-black/70 px-6">
        <Pressable className="absolute inset-0" onPress={busy ? undefined : onCancel} />
        <View className="rounded-2xl border border-border bg-elevated p-6">
          <Text className="text-xl font-bold text-text">Name your playlist</Text>
          <Text className="mt-2 text-sm text-text-secondary">
            Choose a name before creating the playlist.
          </Text>
          <TextInput
            value={name}
            onChangeText={setName}
            placeholder="Playlist name"
            placeholderTextColor="#6a6a6a"
            className="mt-4 rounded-xl border border-border bg-base px-4 py-3 text-base text-text"
            autoFocus
            editable={!busy}
            maxLength={200}
            onSubmitEditing={submit}
            returnKeyType="done"
          />
          {error ? <Text className="mt-3 text-sm text-danger-fg">{error}</Text> : null}
          <View className="mt-6 flex-row gap-3">
            <Button variant="secondary" className="flex-1" onPress={onCancel} disabled={busy}>
              Cancel
            </Button>
            <Button className="flex-1" onPress={submit} disabled={!canSubmit} loading={busy}>
              Create playlist
            </Button>
          </View>
        </View>
      </View>
    </Modal>
  );
}
