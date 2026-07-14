import { Ionicons } from "@expo/vector-icons";
import { useEffect, useState } from "react";
import { Pressable, Text, TextInput, View } from "react-native";

type Props = {
  name: string;
  onSave: (name: string) => Promise<void>;
};

export function EditablePlaylistTitle({ name, onSave }: Props) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(name);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!editing) setDraft(name);
  }, [name, editing]);

  const commit = async () => {
    const trimmed = draft.trim();
    if (!trimmed || trimmed === name) {
      setDraft(name);
      setEditing(false);
      return;
    }

    setBusy(true);
    try {
      await onSave(trimmed);
      setEditing(false);
    } catch {
      setDraft(name);
      setEditing(false);
    } finally {
      setBusy(false);
    }
  };

  if (editing) {
    return (
      <TextInput
        value={draft}
        editable={!busy}
        onChangeText={setDraft}
        onBlur={() => void commit()}
        onSubmitEditing={() => void commit()}
        className="mt-1 rounded-lg border border-border bg-base px-2 py-1 text-3xl font-extrabold text-text"
        autoFocus
        returnKeyType="done"
      />
    );
  }

  return (
    <Pressable className="mt-1 flex-row items-center gap-2" onPress={() => setEditing(true)}>
      <Text className="flex-1 text-3xl font-extrabold tracking-tight text-text" numberOfLines={2}>
        {name}
      </Text>
      <View className="rounded-full p-1.5">
        <Ionicons name="pencil" size={16} color="#b3b3b3" />
      </View>
    </Pressable>
  );
}
