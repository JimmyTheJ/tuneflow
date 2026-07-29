import type { SearchOptions, SearchResultGroup } from "@/types";

export const DEFAULT_SEARCH_OPTIONS: SearchOptions = {
  max_per_song: 3,
  hide_covers: false,
  hide_loops: false,
  results_per_page: 20,
  version_preference: "auto",
};

const SESSION_SEARCH_OPTIONS_KEY = "tuneflow.search.sessionOptions";

export function loadSessionSearchOptions(): SearchOptions | null {
  try {
    const raw = localStorage.getItem(SESSION_SEARCH_OPTIONS_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as SearchOptions;
  } catch {
    return null;
  }
}

export function saveSessionSearchOptions(options: SearchOptions | null): void {
  if (!options) {
    localStorage.removeItem(SESSION_SEARCH_OPTIONS_KEY);
    return;
  }
  localStorage.setItem(SESSION_SEARCH_OPTIONS_KEY, JSON.stringify(options));
}

export function countActiveSearchOptionChanges(
  options: SearchOptions,
  baseline: SearchOptions = DEFAULT_SEARCH_OPTIONS,
): number {
  let count = 0;
  if (options.max_per_song !== baseline.max_per_song) count += 1;
  if (options.hide_covers !== baseline.hide_covers) count += 1;
  if (options.hide_loops !== baseline.hide_loops) count += 1;
  if (options.results_per_page !== baseline.results_per_page) count += 1;
  if (options.version_preference !== baseline.version_preference) count += 1;
  return count;
}

export function mergeSearchGroups(
  existing: SearchResultGroup[],
  incoming: SearchResultGroup[],
): SearchResultGroup[] {
  const map = new Map(existing.map((group) => [group.group_key, group]));
  const order = existing.map((group) => group.group_key);

  for (const group of incoming) {
    const current = map.get(group.group_key);
    if (!current) {
      map.set(group.group_key, group);
      order.push(group.group_key);
      continue;
    }

    const seen = new Set([
      current.primary.video_id,
      ...current.alternates.map((track) => track.video_id),
    ]);
    const alternates = [...current.alternates];

    if (!seen.has(group.primary.video_id)) {
      alternates.push(group.primary);
      seen.add(group.primary.video_id);
    }
    for (const alternate of group.alternates) {
      if (seen.has(alternate.video_id)) continue;
      alternates.push(alternate);
      seen.add(alternate.video_id);
    }

    map.set(group.group_key, {
      ...current,
      alternates,
      total_versions: Math.max(
        current.total_versions ?? 1,
        group.total_versions ?? 1,
        alternates.length + 1,
      ),
    });
  }

  return order.map((key) => map.get(key)!);
}

export function flattenGroupTracks(groups: SearchResultGroup[]): SearchResultGroup["primary"][] {
  const tracks: SearchResultGroup["primary"][] = [];
  for (const group of groups) {
    tracks.push(group.primary);
    tracks.push(...group.alternates);
  }
  return tracks;
}

export function primaryPlayQueue(groups: SearchResultGroup[]): SearchResultGroup["primary"][] {
  return groups.map((group) => group.primary).filter((track) => !track.blocked_reason);
}

export function buildMoreVersionsQuery(track: SearchResultGroup["primary"]): string {
  const title = track.source_title?.trim() || track.title;
  const artist = track.artist?.replace(/\s*-\s*Topic\s*$/i, "").trim();
  return [artist, title].filter(Boolean).join(" ");
}

export function searchOptionsToParams(options: SearchOptions): URLSearchParams {
  const params = new URLSearchParams();
  if (options.max_per_song === null) {
    params.set("max_per_song", "0");
  } else if (options.max_per_song !== DEFAULT_SEARCH_OPTIONS.max_per_song) {
    params.set("max_per_song", String(options.max_per_song));
  }
  if (options.hide_covers) params.set("hide_covers", "true");
  if (options.hide_loops) params.set("hide_loops", "true");
  if (options.results_per_page !== DEFAULT_SEARCH_OPTIONS.results_per_page) {
    params.set("limit", String(options.results_per_page));
  }
  if (options.version_preference !== "auto") {
    params.set("version_preference", options.version_preference);
  }
  return params;
}
