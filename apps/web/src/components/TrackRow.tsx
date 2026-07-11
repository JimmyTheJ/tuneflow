import type { Track } from "@/types";
import { TrackThumb } from "@/components/TrackThumb";
import {
  extractTrackBadges,
  formatTrackArtist,
  trackDetailLine,
} from "@/lib/tracks";
import { formatTime } from "@/lib/time";

type Props = {
  track: Track;
  subtitle?: string;
  detail?: string | null;
  displayTitle?: string;
  showDuration?: boolean;
  showBadges?: boolean;
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
    <button type="button" className="track-row" onClick={onClick} disabled={disabled}>
      <TrackThumb
        videoId={track.video_id}
        className="track-thumb"
        fallbackClassName="track-thumb track-thumb-fallback"
      />
      <div className="track-meta">
        <div className="track-title-row">
          <div className="track-title">{title}</div>
          {duration ? <span className="track-duration">{duration}</span> : null}
        </div>
        <div className="track-subtitle-row">
          <div className="track-subtitle">{artistLine}</div>
          {badges.length > 0 ? (
            <div className="track-badges" aria-label="Version details">
              {badges.map((badge) => (
                <span key={badge} className="track-badge">
                  {badge}
                </span>
              ))}
            </div>
          ) : null}
        </div>
        {detailLine ? <div className="track-detail">{detailLine}</div> : null}
      </div>
    </button>
  );
}
