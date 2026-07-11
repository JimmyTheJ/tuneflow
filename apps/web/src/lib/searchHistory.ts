const SEARCH_HISTORY_KEY = "tuneflow.searchHistory";
const MAX_SEARCH_HISTORY = 20;
const MAX_AUTOCOMPLETE_SUGGESTIONS = 8;

export type SearchSuggestionSource = "history";

export type SearchSuggestion = {
  text: string;
  source: SearchSuggestionSource;
};

export function getSearchHistory(): string[] {
  try {
    const raw = localStorage.getItem(SEARCH_HISTORY_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((item): item is string => typeof item === "string");
  } catch {
    return [];
  }
}

function persistSearchHistory(history: string[]): void {
  localStorage.setItem(SEARCH_HISTORY_KEY, JSON.stringify(history));
}

export function addSearchQuery(query: string): string[] {
  const trimmed = query.trim();
  if (!trimmed) return getSearchHistory();

  const history = getSearchHistory().filter((q) => q.toLowerCase() !== trimmed.toLowerCase());
  history.unshift(trimmed);
  const next = history.slice(0, MAX_SEARCH_HISTORY);
  persistSearchHistory(next);
  return next;
}

export function removeSearchQuery(query: string): string[] {
  const lowered = query.toLowerCase();
  const next = getSearchHistory().filter((q) => q.toLowerCase() !== lowered);
  persistSearchHistory(next);
  return next;
}

export function clearSearchHistory(): void {
  localStorage.removeItem(SEARCH_HISTORY_KEY);
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
