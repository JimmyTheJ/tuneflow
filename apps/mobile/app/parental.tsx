import { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from "react-native";

import { api } from "@/lib/api";
import type { ChildProfile } from "@/types";

export default function ParentalScreen() {
  const [children, setChildren] = useState<ChildProfile[]>([]);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [keywords, setKeywords] = useState("");
  const [maxMinutes, setMaxMinutes] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const profiles = await api.listChildren();
      setChildren(profiles);
      if (profiles.length && selectedId === null) {
        setSelectedId(profiles[0].user.id);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load child profiles");
    } finally {
      setLoading(false);
    }
  }, [selectedId]);

  useEffect(() => {
    void load();
  }, [load]);

  const selected = children.find((child) => child.user.id === selectedId) ?? null;

  useEffect(() => {
    if (!selected) {
      return;
    }
    setKeywords(selected.settings.blocked_keywords.join(", "));
    setMaxMinutes(
      selected.settings.max_daily_minutes != null ? String(selected.settings.max_daily_minutes) : "",
    );
  }, [selected]);

  const save = async () => {
    if (!selected) {
      return;
    }
    setSaving(true);
    setMessage(null);
    setError(null);
    try {
      await api.updateChildSettings(selected.user.id, {
        block_explicit: selected.settings.block_explicit,
        search_enabled: selected.settings.search_enabled,
        max_daily_minutes: maxMinutes.trim() ? Number(maxMinutes) : null,
        allowed_start_hour: selected.settings.allowed_start_hour,
        allowed_end_hour: selected.settings.allowed_end_hour,
        blocked_keywords: keywords
          .split(",")
          .map((item) => item.trim())
          .filter(Boolean),
      });
      setMessage("Saved");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save settings");
    } finally {
      setSaving(false);
    }
  };

  const toggleSetting = async (field: "block_explicit" | "search_enabled", value: boolean) => {
    if (!selected) {
      return;
    }
    const updated = {
      ...selected,
      settings: { ...selected.settings, [field]: value },
    };
    setChildren((current) =>
      current.map((child) => (child.user.id === selected.user.id ? updated : child)),
    );
  };

  if (loading) {
    return <ActivityIndicator color="#22c55e" style={{ marginTop: 48 }} />;
  }

  return (
    <ScrollView style={styles.container}>
      <Text style={styles.help}>
        Manage listening rules for child accounts. Create child users from the API or add a family-management
        screen later.
      </Text>

      {error ? <Text style={styles.error}>{error}</Text> : null}
      {message ? <Text style={styles.message}>{message}</Text> : null}

      {children.length === 0 ? (
        <Text style={styles.empty}>No child accounts yet. Parents can create them via POST /api/users.</Text>
      ) : (
        <>
          <Text style={styles.label}>Child account</Text>
          <View style={styles.chipRow}>
            {children.map((child) => (
              <Pressable
                key={child.user.id}
                style={[styles.chip, selectedId === child.user.id && styles.chipActive]}
                onPress={() => setSelectedId(child.user.id)}
              >
                <Text style={styles.chipText}>{child.user.display_name}</Text>
              </Pressable>
            ))}
          </View>

          {selected ? (
            <View style={styles.card}>
              <View style={styles.row}>
                <Text style={styles.rowLabel}>Block explicit content</Text>
                <Switch
                  value={selected.settings.block_explicit}
                  onValueChange={(value) => void toggleSetting("block_explicit", value)}
                />
              </View>
              <View style={styles.row}>
                <Text style={styles.rowLabel}>Allow search</Text>
                <Switch
                  value={selected.settings.search_enabled}
                  onValueChange={(value) => void toggleSetting("search_enabled", value)}
                />
              </View>

              <Text style={styles.label}>Daily limit (minutes, blank = unlimited)</Text>
              <TextInput
                value={maxMinutes}
                onChangeText={setMaxMinutes}
                keyboardType="number-pad"
                style={styles.input}
                placeholder="60"
                placeholderTextColor="#737373"
              />

              <Text style={styles.label}>Blocked keywords (comma-separated)</Text>
              <TextInput
                value={keywords}
                onChangeText={setKeywords}
                style={[styles.input, styles.multiline]}
                placeholder="artist name, topic"
                placeholderTextColor="#737373"
                multiline
              />

              <Pressable style={styles.button} onPress={() => void save()} disabled={saving}>
                <Text style={styles.buttonText}>{saving ? "Saving..." : "Save controls"}</Text>
              </Pressable>
            </View>
          ) : null}
        </>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#0a0a0a",
    padding: 16,
  },
  help: {
    color: "#a3a3a3",
    fontSize: 15,
    lineHeight: 22,
    marginBottom: 16,
  },
  label: {
    color: "#d4d4d4",
    fontSize: 14,
    marginBottom: 8,
    marginTop: 8,
  },
  chipRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    marginBottom: 16,
  },
  chip: {
    backgroundColor: "#171717",
    borderRadius: 999,
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  chipActive: {
    backgroundColor: "#14532d",
  },
  chipText: {
    color: "#fff",
    fontWeight: "600",
  },
  card: {
    backgroundColor: "#171717",
    borderRadius: 16,
    padding: 16,
    gap: 12,
  },
  row: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  rowLabel: {
    color: "#fff",
    fontSize: 16,
  },
  input: {
    backgroundColor: "#0a0a0a",
    color: "#fff",
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 16,
  },
  multiline: {
    minHeight: 80,
    textAlignVertical: "top",
  },
  button: {
    backgroundColor: "#22c55e",
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: "center",
    marginTop: 8,
  },
  buttonText: {
    color: "#052e16",
    fontWeight: "700",
    fontSize: 16,
  },
  empty: {
    color: "#737373",
    fontSize: 15,
    marginTop: 12,
  },
  error: {
    color: "#f87171",
    marginBottom: 8,
  },
  message: {
    color: "#22c55e",
    marginBottom: 8,
  },
});
