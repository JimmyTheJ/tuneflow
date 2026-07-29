import type { SearchOptions, SearchResultGroup } from "@/types";

export const DEFAULT_SEARCH_OPTIONS: SearchOptions = {
  max_per_song: 1,
  hide_covers: false,
  hide_loops: false,
  results_per_page: 20,
  version_preference: "auto",
};

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

    map.set(group.group_key, { ...current, alternates });
  }

  return order.map((key) => map.get(key)!);
}

export function flattenGroupTracks(groups: SearchResultGroup[]) {
  const tracks = [];
  for (const group of groups) {
    tracks.push(group.primary);
    tracks.push(...group.alternates);
  }
  return tracks;
}

export function primaryPlayQueue(groups: SearchResultGroup[]) {
  return groups.map((group) => group.primary).filter((track) => !track.blocked_reason);
}
