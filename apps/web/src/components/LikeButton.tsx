import { useState, type MouseEvent } from "react";
import { useLikedTracks } from "@/hooks/useLikedTracks";
import type { Track } from "@/types";

type Props = {
  track: Track;
  className?: string;
  size?: "sm" | "md" | "lg";
};

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

  const classes = [
    "like-btn",
    `like-btn-${size}`,
    liked ? "like-btn-active" : undefined,
    className,
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <button
      type="button"
      className={classes}
      aria-label={liked ? `Unlike ${track.title}` : `Like ${track.title}`}
      aria-pressed={liked}
      disabled={busy}
      onClick={(event) => void handleClick(event)}
    >
      {liked ? "♥" : "♡"}
    </button>
  );
};
