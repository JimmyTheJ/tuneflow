import { Heart } from "lucide-react";
import { useState, type MouseEvent } from "react";
import { IconButton } from "@/components/ui/IconButton";
import { useLikedTracks } from "@/hooks/useLikedTracks";
import { cn } from "@/lib/cn";
import type { Track } from "@/types";

type Props = {
  track: Track;
  className?: string;
  size?: "sm" | "md" | "lg";
};

const iconSize = {
  sm: "size-4",
  md: "size-5",
  lg: "size-7",
} as const;

export function LikeButton({ track, className, size = "md" }: Props) {
  const { isLiked, toggleLike } = useLikedTracks();
  const [busy, setBusy] = useState(false);
  const liked = isLiked(track.video_id);

  const handleClick = async (event: MouseEvent<HTMLButtonElement>) => {
    event.preventDefault();
    event.stopPropagation();
    if (busy) return;

    setBusy(true);
    try {
      await toggleLike(track);
    } catch {
      /* ignore — user can retry */
    } finally {
      setBusy(false);
    }
  };

  return (
    <IconButton
      label={liked ? `Unlike ${track.title}` : `Like ${track.title}`}
      active={liked}
      size={size === "lg" ? "lg" : size === "sm" ? "sm" : "md"}
      disabled={busy}
      className={cn(liked && "text-accent hover:text-accent-hover", className)}
      onClick={(event) => void handleClick(event)}
    >
      <Heart className={cn(iconSize[size], liked && "fill-current")} />
    </IconButton>
  );
}
