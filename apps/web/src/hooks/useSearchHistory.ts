import { useCallback, useMemo, useState } from "react";
import {
  addSearchQuery,
  clearSearchHistory as clearStoredHistory,
  getSearchHistory,
  getSearchSuggestions,
  removeSearchQuery,
} from "@/lib/searchHistory";

export function useSearchHistory(input: string) {
  const [history, setHistory] = useState<string[]>(() => getSearchHistory());

  const suggestions = useMemo(() => getSearchSuggestions(input, history), [input, history]);

  const recordQuery = useCallback((query: string) => {
    setHistory(addSearchQuery(query));
  }, []);

  const removeQuery = useCallback((query: string) => {
    setHistory(removeSearchQuery(query));
  }, []);

  const clearHistory = useCallback(() => {
    clearStoredHistory();
    setHistory([]);
  }, []);

  return {
    history,
    suggestions,
    recordQuery,
    removeQuery,
    clearHistory,
  };
}
