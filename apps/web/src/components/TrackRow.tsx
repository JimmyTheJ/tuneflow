import type { Track } from "@/types";
import { TrackThumb } from "@/components/TrackThumb";
import { Badge } from "@/components/ui/Badge";
import {
  extractTrackBadges,
  formatTrackArtist,
  trackDetailLine,
} from "@/lib/tracks";
import { formatTime } from "@/lib/time";
import { cn } from "@/lib/cn";

type Props = {
  track: Track;
  subtitle?: string;
  detail?: string | null;
  displayTitle?: string;
  showDuration?: boolean;
  showBadges?: boolean;
  index?: number;
  onClick?: () => void;
  disabled?: boolean;
};

export function TrackRow({
  track,
  subtitle,
  detail,
  displayTitle,
  showDuration = true,
  showBadges = false,
  index,
  onClick,
  disabled,
}: Props) {
  const title = displayTitle ?? track.title;
  const artistLine = subtitle ?? formatTrackArtist(track.artist);
  const badges = showBadges ? extractTrackBadges(title, track.artist) : [];
  const detailLine = detail === undefined ? (showBadges ? trackDetailLine(track) : null) : detail;
  const duration =
    showDuration && track.duration_sec != null && track.duration_sec > 0
      ? formatTime(track.duration_sec)
      : null;

  return (
    <button
      type="button"
      className={cn(
        "group flex w-full items-center gap-3 rounded-lg px-2 py-2 text-left transition-colors",
        "border-0 bg-transparent text-inherit",
        onClick && !disabled ? "cursor-pointer hover:bg-highlight/80" : "cursor-default",
        disabled && "cursor-not-allowed opacity-50",
      )}
      onClick={onClick}
      disabled={disabled}
    >
      {index != null ? (
        <span className="w-5 shrink-0 text-center text-sm tabular-nums text-text-muted">{index}</span>
      ) : null}
      <TrackThumb
        videoId={track.video_id}
        className="size-[52px] shrink-0 rounded-md"
        fallbackClassName="size-[52px] shrink-0 rounded-md"
      />
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-3">
          <div className="min-w-0 flex-1 truncate font-semibold text-text">{title}</div>
          {duration ? (
            <span className="shrink-0 text-sm tabular-nums text-text-secondary">{duration}</span>
          ) : null}
        </div>
        <div className="mt-0.5 flex min-w-0 items-center gap-2">
          <div className="min-w-0 truncate text-sm text-text-secondary">{artistLine}</div>
          {badges.length > 0 ? (
            <div className="flex shrink-0 flex-wrap gap-1" aria-label="Version details">
              {badges.map((badge) => (
                <Badge key={badge}>{badge}</Badge>
              ))}
            </div>
          ) : null}
        </div>
        {detailLine ? (
          <div className="mt-1 line-clamp-2 text-xs leading-snug text-text-muted">{detailLine}</div>
        ) : null}
      </div>
    </button>
  );
}
