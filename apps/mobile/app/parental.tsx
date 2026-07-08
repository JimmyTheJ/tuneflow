import { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from "react-native";

import { HourPicker } from "@/components/HourPicker";
import { TrackRow } from "@/components/TrackRow";
import { api } from "@/lib/api";
import type { ChildProfile, ChildUsageToday, PlayHistoryEntry } from "@/types";

type Tab = "controls" | "history";

export default function ParentalScreen() {
  const [tab, setTab] = useState<Tab>("controls");
  const [children, setChildren] = useState<ChildProfile[]>([]);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [usage, setUsage] = useState<ChildUsageToday | null>(null);
  const [history, setHistory] = useState<PlayHistoryEntry[]>([]);
  const [keywords, setKeywords] = useState("");
  const [videoIds, setVideoIds] = useState("");
  const [maxMinutes, setMaxMinutes] = useState("");
  const [startHour, setStartHour] = useState(8);
  const [endHour, setEndHour] = useState(20);
  const [loading, setLoading] = useState(true);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const profiles = await api.listChildren();
      setChildren(profiles);
      const activeId = selectedId ?? profiles[0]?.user.id ?? null;
      if (activeId !== selectedId) {
        setSelectedId(activeId);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load child profiles");
    } finally {
      setLoading(false);
    }
  }, [selectedId]);

  const loadChildData = useCallback(async (childId: number) => {
    setHistoryLoading(true);
    try {
      const [usageData, historyData] = await Promise.all([
        api.getChildUsage(childId),
        api.getChildHistory(childId),
      ]);
      setUsage(usageData);
      setHistory(historyData);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load child data");
    } finally {
      setHistoryLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const selected = children.find((child) => child.user.id === selectedId) ?? null;

  useEffect(() => {
    if (!selected) {
      return;
    }
    setKeywords(selected.settings.blocked_keywords.join(", "));
    setVideoIds(selected.settings.blocked_video_ids.join(", "));
    setMaxMinutes(
      selected.settings.max_daily_minutes != null ? String(selected.settings.max_daily_minutes) : "",
    );
    setStartHour(selected.settings.allowed_start_hour);
    setEndHour(selected.settings.allowed_end_hour);
    void loadChildData(selected.user.id);
  }, [selected, loadChildData]);

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
        allowed_start_hour: startHour,
        allowed_end_hour: endHour,
        blocked_keywords: keywords
          .split(",")
          .map((item) => item.trim())
          .filter(Boolean),
        blocked_video_ids: videoIds
          .split(",")
          .map((item) => item.trim())
          .filter(Boolean),
      });
      setMessage("Saved");
      await load();
      if (selectedId) {
        await loadChildData(selectedId);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save settings");
    } finally {
      setSaving(false);
    }
  };

  const toggleSetting = (field: "block_explicit" | "search_enabled", value: boolean) => {
    if (!selected) {
      return;
    }
    setChildren((current) =>
      current.map((child) =>
        child.user.id === selected.user.id
          ? { ...child, settings: { ...child.settings, [field]: value } }
          : child,
      ),
    );
  };

  if (loading) {
    return <ActivityIndicator color="#22c55e" style={{ marginTop: 48 }} />;
  }

  return (
    <View style={styles.container}>
      <View style={styles.tabRow}>
        <Pressable
          style={[styles.tab, tab === "controls" && styles.tabActive]}
          onPress={() => setTab("controls")}
        >
          <Text style={[styles.tabText, tab === "controls" && styles.tabTextActive]}>Controls</Text>
        </Pressable>
        <Pressable
          style={[styles.tab, tab === "history" && styles.tabActive]}
          onPress={() => setTab("history")}
        >
          <Text style={[styles.tabText, tab === "history" && styles.tabTextActive]}>History</Text>
        </Pressable>
      </View>

      {error ? <Text style={styles.error}>{error}</Text> : null}
      {message ? <Text style={styles.message}>{message}</Text> : null}

      {children.length === 0 ? (
        <Text style={styles.empty}>
          No child accounts yet. Add one from Settings → Family.
        </Text>
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

          {selected && usage ? (
            <View style={styles.usageCard}>
              <Text style={styles.usageText}>
                Today: {usage.listened_minutes_today} min listened
                {usage.max_daily_minutes != null
                  ? ` · ${usage.remaining_minutes ?? 0} min remaining`
                  : " · no daily limit"}
              </Text>
              <Text style={styles.usageMeta}>
                Allowed hours: {formatHourRange(startHour, endHour)}
              </Text>
            </View>
          ) : null}

          {tab === "controls" && selected ? (
            <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent}>
              <View style={styles.card}>
                <View style={styles.row}>
                  <Text style={styles.rowLabel}>Block explicit content</Text>
                  <Switch
                    value={selected.settings.block_explicit}
                    onValueChange={(value) => toggleSetting("block_explicit", value)}
                  />
                </View>
                <View style={styles.row}>
                  <Text style={styles.rowLabel}>Allow search</Text>
                  <Switch
                    value={selected.settings.search_enabled}
                    onValueChange={(value) => toggleSetting("search_enabled", value)}
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

                <Text style={styles.sectionTitle}>Listening hours</Text>
                <HourPicker label="Earliest" value={startHour} onChange={setStartHour} />
                <HourPicker label="Latest (exclusive)" value={endHour} onChange={setEndHour} />

                <Text style={styles.label}>Blocked keywords (comma-separated)</Text>
                <TextInput
                  value={keywords}
                  onChangeText={setKeywords}
                  style={[styles.input, styles.multiline]}
                  placeholder="artist name, topic"
                  placeholderTextColor="#737373"
                  multiline
                />

                <Text style={styles.label}>Blocked video IDs (comma-separated)</Text>
                <TextInput
                  value={videoIds}
                  onChangeText={setVideoIds}
                  style={[styles.input, styles.multiline]}
                  placeholder="dQw4w9WgXcQ, ..."
                  placeholderTextColor="#737373"
                  multiline
                  autoCapitalize="none"
                />

                <Pressable style={styles.button} onPress={() => void save()} disabled={saving}>
                  <Text style={styles.buttonText}>{saving ? "Saving..." : "Save controls"}</Text>
                </Pressable>
              </View>
            </ScrollView>
          ) : null}

          {tab === "history" && selected ? (
            historyLoading ? (
              <ActivityIndicator color="#22c55e" style={{ marginTop: 24 }} />
            ) : (
              <FlatList
                data={history}
                keyExtractor={(item) => String(item.id)}
                renderItem={({ item }) => (
                  <TrackRow track={item} subtitle={item.artist ?? "Unknown artist"} />
                )}
                ListEmptyComponent={
                  <Text style={styles.empty}>No listening history for this child yet.</Text>
                }
              />
            )
          ) : null}
        </>
      )}
    </View>
  );
}

function formatHourRange(start: number, end: number): string {
  const fmt = (hour: number) => {
    if (hour === 0) return "12 AM";
    if (hour < 12) return `${hour} AM`;
    if (hour === 12) return "12 PM";
    return `${hour - 12} PM`;
  };
  return `${fmt(start)} – ${fmt(end)}`;
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#0a0a0a",
    padding: 16,
  },
  tabRow: {
    flexDirection: "row",
    gap: 8,
    marginBottom: 16,
  },
  tab: {
    flex: 1,
    backgroundColor: "#171717",
    borderRadius: 12,
    paddingVertical: 10,
    alignItems: "center",
  },
  tabActive: {
    backgroundColor: "#14532d",
  },
  tabText: {
    color: "#a3a3a3",
    fontWeight: "600",
  },
  tabTextActive: {
    color: "#fff",
  },
  label: {
    color: "#d4d4d4",
    fontSize: 14,
    marginBottom: 8,
    marginTop: 8,
  },
  sectionTitle: {
    color: "#fff",
    fontSize: 16,
    fontWeight: "700",
    marginTop: 8,
    marginBottom: 4,
  },
  chipRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    marginBottom: 12,
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
  usageCard: {
    backgroundColor: "#171717",
    borderRadius: 12,
    padding: 12,
    marginBottom: 12,
    gap: 4,
  },
  usageText: {
    color: "#fff",
    fontSize: 15,
    fontWeight: "600",
  },
  usageMeta: {
    color: "#a3a3a3",
    fontSize: 13,
  },
  scroll: {
    flex: 1,
  },
  scrollContent: {
    paddingBottom: 24,
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
    minHeight: 72,
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
