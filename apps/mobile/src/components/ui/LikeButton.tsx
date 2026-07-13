import { Ionicons } from "@expo/vector-icons";
import { useState } from "react";
import { Pressable, type GestureResponderEvent } from "react-native";

import { useLikedTracks } from "@/hooks/useLikedTracks";
import type { Track } from "@/types";

type Props = {
  track: Track;
  size?: "sm" | "md" | "lg";
  className?: string;
};

const iconSize = { sm: 18, md: 22, lg: 28 } as const;

export function LikeButton({ track, size = "md", className }: Props) {
  const { isLiked, toggleLike } = useLikedTracks();
  const [busy, setBusy] = useState(false);
  const liked = isLiked(track.video_id);

  const handlePress = async (event: GestureResponderEvent) => {
    event.stopPropagation?.();
    if (busy) return;
    setBusy(true);
    try {
      await toggleLike(track);
    } catch {
      /* ignore */
    } finally {
      setBusy(false);
    }
  };

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={liked ? `Unlike ${track.title}` : `Like ${track.title}`}
      accessibilityState={{ selected: liked, disabled: busy }}
      disabled={busy}
      hitSlop={10}
      onPress={(e) => void handlePress(e)}
      className={`items-center justify-center p-1 active:opacity-70 ${busy ? "opacity-50" : ""} ${className ?? ""}`}
    >
      <Ionicons
        name={liked ? "heart" : "heart-outline"}
        size={iconSize[size]}
        color={liked ? "#1db954" : "#b3b3b3"}
      />
    </Pressable>
  );
}
