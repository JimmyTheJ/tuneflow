import { useCallback, useEffect, useState } from "react";

import { api } from "@/lib/api";
import type { Track } from "@/types";

let cachedIds: Set<string> | null = null;
let inflight: Promise<Set<string>> | null = null;
const listeners = new Set<() => void>();

function notify() {
  for (const listener of listeners) listener();
}

async function loadLikedIds(force = false): Promise<Set<string>> {
  if (!force && cachedIds) return cachedIds;
  if (!force && inflight) return inflight;

  inflight = (async () => {
    const likes = await api.listLikes();
    cachedIds = new Set(likes.map((like) => like.video_id));
    return cachedIds;
  })();

  try {
    return await inflight;
  } finally {
    inflight = null;
  }
}

export function useLikedTracks() {
  const [likedVideoIds, setLikedVideoIds] = useState<Set<string>>(cachedIds ?? new Set());
  const [ready, setReady] = useState(cachedIds != null);

  const refresh = useCallback(async () => {
    try {
      const ids = await loadLikedIds(true);
      setLikedVideoIds(new Set(ids));
      setReady(true);
      notify();
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    const listener = () => {
      if (cachedIds) setLikedVideoIds(new Set(cachedIds));
    };
    listeners.add(listener);

    void (async () => {
      try {
        const ids = await loadLikedIds();
        setLikedVideoIds(new Set(ids));
        setReady(true);
      } catch {
        setReady(true);
      }
    })();

    return () => {
      listeners.delete(listener);
    };
  }, []);

  const isLiked = useCallback(
    (videoId: string) => likedVideoIds.has(videoId),
    [likedVideoIds],
  );

  const toggleLike = useCallback(async (track: Track) => {
    const currentlyLiked = cachedIds?.has(track.video_id) ?? false;
    if (currentlyLiked) {
      await api.unlikeTrack(track.video_id);
      cachedIds?.delete(track.video_id);
    } else {
      await api.likeTrack(track);
      if (!cachedIds) cachedIds = new Set();
      cachedIds.add(track.video_id);
    }
    setLikedVideoIds(new Set(cachedIds));
    notify();
  }, []);

  return { likedVideoIds, isLiked, toggleLike, refresh, ready };
}
