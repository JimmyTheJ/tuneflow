import AsyncStorage from "@react-native-async-storage/async-storage";

import type { AiInsights, AiRecommendations } from "@/types";

const DISCOVER_CACHE_KEY = "tuneflow.discoverCache";

export type DiscoverCache = {
  userId: number;
  insights: AiInsights | null;
  recommendations: AiRecommendations | null;
  cachedAt: string;
};

export async function loadDiscoverCache(userId: number): Promise<DiscoverCache | null> {
  try {
    const raw = await AsyncStorage.getItem(DISCOVER_CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as DiscoverCache;
    if (parsed.userId !== userId) return null;
    return parsed;
  } catch {
    return null;
  }
}

export async function saveDiscoverCache(
  userId: number,
  data: { insights: AiInsights | null; recommendations: AiRecommendations | null },
): Promise<void> {
  const payload: DiscoverCache = {
    userId,
    insights: data.insights,
    recommendations: data.recommendations,
    cachedAt: new Date().toISOString(),
  };
  await AsyncStorage.setItem(DISCOVER_CACHE_KEY, JSON.stringify(payload));
}
