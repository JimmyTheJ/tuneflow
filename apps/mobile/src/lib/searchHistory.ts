import AsyncStorage from "@react-native-async-storage/async-storage";

const SEARCH_HISTORY_KEY = "tuneflow.searchHistory";
const MAX_SEARCH_HISTORY = 20;
const MAX_AUTOCOMPLETE_SUGGESTIONS = 8;

export type SearchSuggestionSource = "history";

export type SearchSuggestion = {
  text: string;
  source: SearchSuggestionSource;
};

export async function getSearchHistory(): Promise<string[]> {
  try {
    const raw = await AsyncStorage.getItem(SEARCH_HISTORY_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((item): item is string => typeof item === "string");
  } catch {
    return [];
  }
}

async function persistSearchHistory(history: string[]): Promise<void> {
  await AsyncStorage.setItem(SEARCH_HISTORY_KEY, JSON.stringify(history));
}

export async function addSearchQuery(query: string): Promise<string[]> {
  const trimmed = query.trim();
  if (!trimmed) return getSearchHistory();

  const history = (await getSearchHistory()).filter(
    (q) => q.toLowerCase() !== trimmed.toLowerCase(),
  );
  history.unshift(trimmed);
  const next = history.slice(0, MAX_SEARCH_HISTORY);
  await persistSearchHistory(next);
  return next;
}

export async function removeSearchQuery(query: string): Promise<string[]> {
  const lowered = query.toLowerCase();
  const next = (await getSearchHistory()).filter((q) => q.toLowerCase() !== lowered);
  await persistSearchHistory(next);
  return next;
}

export async function clearSearchHistory(): Promise<void> {
  await AsyncStorage.removeItem(SEARCH_HISTORY_KEY);
}

/** Rank stored queries for autocomplete. Add more sources here later. */
export function getSearchSuggestions(input: string, history: string[]): SearchSuggestion[] {
  const trimmed = input.trim();
  const lower = trimmed.toLowerCase();

  if (!trimmed) {
    return history
      .slice(0, MAX_SEARCH_HISTORY)
      .map((text) => ({ text, source: "history" as const }));
  }

  const prefix: string[] = [];
  const contains: string[] = [];

  for (const q of history) {
    const qLower = q.toLowerCase();
    if (qLower.startsWith(lower)) {
      prefix.push(q);
    } else if (qLower.includes(lower)) {
      contains.push(q);
    }
  }

  return [...prefix, ...contains]
    .slice(0, MAX_AUTOCOMPLETE_SUGGESTIONS)
    .map((text) => ({ text, source: "history" as const }));
}
