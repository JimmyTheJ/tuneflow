import { useCallback, useEffect, useState } from "react";
import { TrackRow } from "@/components/TrackRow";
import { api } from "@/lib/api";
import { usePlayerStore } from "@/stores/playerStore";
import type { AiInsights, AiRecommendations, LlmStatus } from "@/types";

export function DiscoverPage() {
  const [status, setStatus] = useState<LlmStatus | null>(null);
  const [insights, setInsights] = useState<AiInsights | null>(null);
  const [recommendations, setRecommendations] = useState<AiRecommendations | null>(null);
  const [error, setError] = useState<string | null>(null);
  const playTrack = usePlayerStore((s) => s.playTrack);

  const load = useCallback(async () => {
    setError(null);
    try {
      const llmStatus = await api.aiStatus();
      setStatus(llmStatus);
      if (llmStatus.enabled && llmStatus.reachable) {
        const [i, r] = await Promise.all([api.aiInsights(), api.aiRecommendations()]);
        setInsights(i);
        setRecommendations(r);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load AI features");
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="page">
      <h1>Discover</h1>
      <p className="muted">Personalized insights from your listening history</p>
      {error ? <p className="error">{error}</p> : null}
      {status ? (
        <div className="card">
          <h3>AI status</h3>
          <p className="muted">
            {status.reachable
              ? `Connected to ${status.model}`
              : status.detail ?? "LLM not reachable — check LLM_BASE_URL on the server"}
          </p>
        </div>
      ) : null}
      {insights ? (
        <div className="card">
          <h3>Your listening</h3>
          <p>{insights.summary}</p>
          {insights.top_artists.length > 0 ? (
            <p className="muted">Top artists: {insights.top_artists.join(", ")}</p>
          ) : null}
        </div>
      ) : null}
      {recommendations?.suggestions.map((s) => (
        <div key={s.query} className="card">
          <p className="accent">{s.reason}</p>
          {s.tracks.map((track) => (
            <TrackRow key={track.video_id} track={track} onClick={() => void playTrack(track, s.tracks)} />
          ))}
        </div>
      ))}
    </div>
  );
}
