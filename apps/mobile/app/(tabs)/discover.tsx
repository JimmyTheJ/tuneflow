import { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";

import { TrackRow } from "@/components/TrackRow";
import { api } from "@/lib/api";
import { usePlayerStore } from "@/stores/player";
import type { AiInsights, AiRecommendations, LlmStatus } from "@/types";

export default function DiscoverScreen() {
  const [status, setStatus] = useState<LlmStatus | null>(null);
  const [insights, setInsights] = useState<AiInsights | null>(null);
  const [recommendations, setRecommendations] = useState<AiRecommendations | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const playTrack = usePlayerStore((state) => state.playTrack);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const llmStatus = await api.aiStatus();
      setStatus(llmStatus);
      if (llmStatus.enabled && llmStatus.reachable) {
        const [insightsData, recommendationsData] = await Promise.all([
          api.aiInsights(),
          api.aiRecommendations(),
        ]);
        setInsights(insightsData);
        setRecommendations(recommendationsData);
      } else {
        setInsights(null);
        setRecommendations(null);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load AI features");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <ScrollView
      style={styles.container}
      refreshControl={<RefreshControl refreshing={loading} onRefresh={() => void load()} />}
    >
      <Text style={styles.heading}>Discover</Text>
      <Text style={styles.subheading}>Personalized insights from your listening history</Text>

      {loading && !status ? <ActivityIndicator color="#22c55e" style={{ marginTop: 24 }} /> : null}
      {error ? <Text style={styles.error}>{error}</Text> : null}

      {status ? (
        <View style={styles.card}>
          <Text style={styles.cardTitle}>AI status</Text>
          <Text style={styles.cardBody}>
            {status.reachable
              ? `Connected to ${status.model} at ${status.base_url}`
              : status.detail ?? "LLM not reachable. Check server LLM_BASE_URL (e.g. Ollama on your LAN)."}
          </Text>
        </View>
      ) : null}

      {insights ? (
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Your listening</Text>
          <Text style={styles.cardBody}>{insights.summary}</Text>
          {insights.top_artists.length > 0 ? (
            <Text style={styles.meta}>Top artists: {insights.top_artists.join(", ")}</Text>
          ) : null}
          {insights.listening_patterns.map((item) => (
            <Text key={item} style={styles.bullet}>
              • {item}
            </Text>
          ))}
        </View>
      ) : null}

      {recommendations ? (
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Suggested for you</Text>
          <Text style={styles.cardBody}>{recommendations.summary}</Text>
          {recommendations.suggestions.map((suggestion) => (
            <View key={suggestion.query} style={styles.suggestionBlock}>
              <Text style={styles.suggestionReason}>{suggestion.reason}</Text>
              {suggestion.tracks.map((track) => (
                <TrackRow
                  key={track.video_id}
                  track={track}
                  onPress={() => void playTrack(track, suggestion.tracks)}
                />
              ))}
              {!suggestion.tracks.length ? (
                <Pressable
                  style={styles.searchLink}
                  onPress={() => {
                    // User can search manually; keep MVP simple
                  }}
                >
                  <Text style={styles.searchLinkText}>Try searching: {suggestion.query}</Text>
                </Pressable>
              ) : null}
            </View>
          ))}
        </View>
      ) : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#0a0a0a",
    paddingHorizontal: 16,
    paddingTop: 8,
  },
  heading: {
    color: "#fff",
    fontSize: 28,
    fontWeight: "700",
  },
  subheading: {
    color: "#a3a3a3",
    fontSize: 15,
    marginBottom: 16,
    marginTop: 4,
  },
  card: {
    backgroundColor: "#171717",
    borderRadius: 16,
    padding: 16,
    marginBottom: 16,
    gap: 8,
  },
  cardTitle: {
    color: "#fff",
    fontSize: 18,
    fontWeight: "700",
  },
  cardBody: {
    color: "#d4d4d4",
    fontSize: 15,
    lineHeight: 22,
  },
  meta: {
    color: "#a3a3a3",
    fontSize: 14,
  },
  bullet: {
    color: "#d4d4d4",
    fontSize: 14,
    lineHeight: 20,
  },
  suggestionBlock: {
    marginTop: 8,
    gap: 4,
  },
  suggestionReason: {
    color: "#22c55e",
    fontSize: 14,
    fontWeight: "600",
  },
  searchLink: {
    paddingVertical: 8,
  },
  searchLinkText: {
    color: "#a3a3a3",
    fontSize: 14,
  },
  error: {
    color: "#f87171",
    marginBottom: 12,
  },
});
