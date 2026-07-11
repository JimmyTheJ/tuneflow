import { useCallback, useEffect, useMemo, useState } from "react";
import {
  addSearchQuery,
  clearSearchHistory as clearStoredHistory,
  getSearchHistory,
  getSearchSuggestions,
  removeSearchQuery,
} from "@/lib/searchHistory";

export function useSearchHistory(input: string) {
  const [history, setHistory] = useState<string[]>([]);

  useEffect(() => {
    void getSearchHistory().then(setHistory);
  }, []);

  const suggestions = useMemo(() => getSearchSuggestions(input, history), [input, history]);

  const recordQuery = useCallback((query: string) => {
    void addSearchQuery(query).then(setHistory);
  }, []);

  const removeQuery = useCallback((query: string) => {
    void removeSearchQuery(query).then(setHistory);
  }, []);

  const clearHistory = useCallback(() => {
    void clearStoredHistory().then(() => setHistory([]));
  }, []);

  return {
    history,
    suggestions,
    recordQuery,
    removeQuery,
    clearHistory,
  };
}
