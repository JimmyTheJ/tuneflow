import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/api";
import type { Track } from "@/types";

let cachedLikedVideoIds: Set<string> | null = null;

export function useLikedTracks() {
  const [likedVideoIds, setLikedVideoIds] = useState<Set<string>>(cachedLikedVideoIds ?? new Set());
  const [loading, setLoading] = useState(cachedLikedVideoIds == null);

  const refresh = useCallback(async () => {
    const likes = await api.listLikes();
    const next = new Set(likes.map((like) => like.video_id));
    cachedLikedVideoIds = next;
    setLikedVideoIds(next);
    return next;
  }, []);

  useEffect(() => {
    if (cachedLikedVideoIds) return;
    void refresh()
      .catch(() => undefined)
      .finally(() => setLoading(false));
  }, [refresh]);

  const isLiked = useCallback(
    (videoId: string) => likedVideoIds.has(videoId),
    [likedVideoIds],
  );

  const toggleLike = useCallback(
    async (track: Track) => {
      if (likedVideoIds.has(track.video_id)) {
        await api.unlikeTrack(track.video_id);
        const next = new Set(likedVideoIds);
        next.delete(track.video_id);
        cachedLikedVideoIds = next;
        setLikedVideoIds(next);
        return false;
      }

      await api.likeTrack(track);
      const next = new Set(likedVideoIds);
      next.add(track.video_id);
      cachedLikedVideoIds = next;
      setLikedVideoIds(next);
      return true;
    },
    [likedVideoIds],
  );

  return { likedVideoIds, isLiked, toggleLike, refresh, loading };
};
