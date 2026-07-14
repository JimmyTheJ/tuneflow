import { useCallback, useEffect, useState } from "react";

import { api } from "@/lib/api";
import { loadDiscoverCache, saveDiscoverCache } from "@/lib/discoverCache";
import type { AiInsights, AiRecommendations, LlmStatus } from "@/types";

type DiscoverData = {
  status: LlmStatus | null;
  insights: AiInsights | null;
  recommendations: AiRecommendations | null;
  error: string | null;
  loading: boolean;
  refreshing: boolean;
  reload: () => Promise<void>;
};

async function fetchAiContent(refresh: boolean): Promise<{
  insights: AiInsights;
  recommendations: AiRecommendations;
}> {
  const [insights, recommendations] = await Promise.all([
    api.aiInsights(refresh),
    api.aiRecommendations(refresh),
  ]);
  return { insights, recommendations };
}

export function useDiscoverData(userId: number | undefined): DiscoverData {
  const [status, setStatus] = useState<LlmStatus | null>(null);
  const [insights, setInsights] = useState<AiInsights | null>(null);
  const [recommendations, setRecommendations] = useState<AiRecommendations | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const applyData = useCallback(
    (activeUserId: number, data: { insights: AiInsights | null; recommendations: AiRecommendations | null }) => {
      setInsights(data.insights);
      setRecommendations(data.recommendations);
      saveDiscoverCache(activeUserId, data);
    },
    [],
  );

  const load = useCallback(
    async (options?: { forceRefresh?: boolean }) => {
      if (!userId) return;

      const forceRefresh = options?.forceRefresh ?? false;
      setError(null);

      if (forceRefresh) {
        setRefreshing(true);
      }

      try {
        const llmStatus = await api.aiStatus();
        setStatus(llmStatus);

        if (!llmStatus.enabled || !llmStatus.reachable) {
          if (forceRefresh) {
            setInsights(null);
            setRecommendations(null);
          }
          return;
        }

        const content = await fetchAiContent(forceRefresh);
        applyData(userId, content);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Could not load AI features");
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [applyData, userId],
  );

  const reload = useCallback(async () => {
    await load({ forceRefresh: true });
  }, [load]);

  useEffect(() => {
    if (!userId) return;

    let cancelled = false;

    void (async () => {
      setError(null);

      const cached = loadDiscoverCache(userId);
      if (cached) {
        setInsights(cached.insights);
        setRecommendations(cached.recommendations);
        setLoading(false);
        setRefreshing(true);
      }

      try {
        const llmStatus = await api.aiStatus();
        if (cancelled) return;
        setStatus(llmStatus);

        if (!llmStatus.enabled || !llmStatus.reachable) {
          if (!cached) {
            setInsights(null);
            setRecommendations(null);
          }
          return;
        }

        if (!cached) {
          const content = await fetchAiContent(false);
          if (cancelled) return;
          applyData(userId, content);
          setLoading(false);
          setRefreshing(true);
        }

        const fresh = await fetchAiContent(true);
        if (cancelled) return;
        applyData(userId, fresh);
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Could not load AI features");
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
          setRefreshing(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [applyData, userId]);

  return { status, insights, recommendations, error, loading, refreshing, reload };
}
