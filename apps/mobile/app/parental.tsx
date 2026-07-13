import { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  ScrollView,
  Switch,
  Text,
  TextInput,
  View,
} from "react-native";

import { HourPicker } from "@/components/HourPicker";
import { TrackRow } from "@/components/TrackRow";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
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
    return (
      <View className="flex-1 items-center justify-center bg-base">
        <ActivityIndicator color="#1db954" />
      </View>
    );
  }

  return (
    <View className="flex-1 bg-base px-4 pt-4">
      <View className="mb-4 flex-row gap-2">
        {(["controls", "history"] as const).map((option) => (
          <Pressable
            key={option}
            className={`flex-1 items-center rounded-xl py-2.5 ${tab === option ? "bg-accent-dim" : "bg-elevated"}`}
            onPress={() => setTab(option)}
          >
            <Text className={`font-semibold capitalize ${tab === option ? "text-text" : "text-text-secondary"}`}>
              {option}
            </Text>
          </Pressable>
        ))}
      </View>

      {error ? <Text className="mb-2 text-sm text-danger-fg">{error}</Text> : null}
      {message ? <Text className="mb-2 text-sm text-accent">{message}</Text> : null}

      {children.length === 0 ? (
        <Text className="mt-3 text-[15px] text-text-muted">
          No child accounts yet. Add one from Settings → Family.
        </Text>
      ) : (
        <>
          <Text className="mb-2 text-sm text-text-secondary">Child account</Text>
          <View className="mb-3 flex-row flex-wrap gap-2">
            {children.map((child) => (
              <Pressable
                key={child.user.id}
                className={`rounded-full px-3.5 py-2 ${selectedId === child.user.id ? "bg-accent-dim" : "bg-elevated"}`}
                onPress={() => setSelectedId(child.user.id)}
              >
                <Text className="font-semibold text-text">{child.user.display_name}</Text>
              </Pressable>
            ))}
          </View>

          {selected && usage ? (
            <Card className="mb-3 gap-1">
              <Text className="text-[15px] font-semibold text-text">
                Today: {usage.listened_minutes_today} min listened
                {usage.max_daily_minutes != null
                  ? ` · ${usage.remaining_minutes ?? 0} min remaining`
                  : " · no daily limit"}
              </Text>
              <Text className="text-[13px] text-text-secondary">
                Allowed hours: {formatHourRange(startHour, endHour)}
              </Text>
            </Card>
          ) : null}

          {tab === "controls" && selected ? (
            <ScrollView contentContainerStyle={{ paddingBottom: 24 }}>
              <Card className="gap-3">
                <View className="flex-row items-center justify-between">
                  <Text className="text-base text-text">Block explicit content</Text>
                  <Switch
                    value={selected.settings.block_explicit}
                    onValueChange={(value) => toggleSetting("block_explicit", value)}
                    trackColor={{ false: "#3a3a3a", true: "#14532d" }}
                    thumbColor={selected.settings.block_explicit ? "#1db954" : "#b3b3b3"}
                  />
                </View>
                <View className="flex-row items-center justify-between">
                  <Text className="text-base text-text">Allow search</Text>
                  <Switch
                    value={selected.settings.search_enabled}
                    onValueChange={(value) => toggleSetting("search_enabled", value)}
                    trackColor={{ false: "#3a3a3a", true: "#14532d" }}
                    thumbColor={selected.settings.search_enabled ? "#1db954" : "#b3b3b3"}
                  />
                </View>

                <Text className="mt-1 text-sm text-text-secondary">
                  Daily limit (minutes, blank = unlimited)
                </Text>
                <TextInput
                  value={maxMinutes}
                  onChangeText={setMaxMinutes}
                  keyboardType="number-pad"
                  className="rounded-xl border border-border bg-base px-3.5 py-3 text-base text-text"
                  placeholder="60"
                  placeholderTextColor="#6a6a6a"
                />

                <Text className="text-base font-bold text-text">Listening hours</Text>
                <HourPicker label="Earliest" value={startHour} onChange={setStartHour} />
                <HourPicker label="Latest (exclusive)" value={endHour} onChange={setEndHour} />

                <Text className="text-sm text-text-secondary">Blocked keywords (comma-separated)</Text>
                <TextInput
                  value={keywords}
                  onChangeText={setKeywords}
                  className="min-h-[72px] rounded-xl border border-border bg-base px-3.5 py-3 text-base text-text"
                  placeholder="artist name, topic"
                  placeholderTextColor="#6a6a6a"
                  multiline
                  textAlignVertical="top"
                />

                <Text className="text-sm text-text-secondary">Blocked video IDs (comma-separated)</Text>
                <TextInput
                  value={videoIds}
                  onChangeText={setVideoIds}
                  className="min-h-[72px] rounded-xl border border-border bg-base px-3.5 py-3 text-base text-text"
                  placeholder="dQw4w9WgXcQ, ..."
                  placeholderTextColor="#6a6a6a"
                  multiline
                  autoCapitalize="none"
                  textAlignVertical="top"
                />

                <Button block loading={saving} onPress={() => void save()}>
                  Save controls
                </Button>
              </Card>
            </ScrollView>
          ) : null}

          {tab === "history" && selected ? (
            historyLoading ? (
              <ActivityIndicator color="#1db954" style={{ marginTop: 24 }} />
            ) : (
              <FlatList
                data={history}
                keyExtractor={(item) => String(item.id)}
                renderItem={({ item }) => (
                  <TrackRow track={item} subtitle={item.artist ?? "Unknown artist"} />
                )}
                ListEmptyComponent={
                  <Text className="mt-3 text-[15px] text-text-muted">
                    No listening history for this child yet.
                  </Text>
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
