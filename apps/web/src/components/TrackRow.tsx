import type { Track } from "@/types";
import { TrackThumb } from "@/components/TrackThumb";

type Props = {
  track: Track;
  subtitle?: string;
  onClick?: () => void;
  disabled?: boolean;
};

export function TrackRow({ track, subtitle, onClick, disabled }: Props) {
  return (
    <button type="button" className="track-row" onClick={onClick} disabled={disabled}>
      <TrackThumb
        videoId={track.video_id}
        className="track-thumb"
        fallbackClassName="track-thumb track-thumb-fallback"
      />
      <div className="track-meta">
        <div className="track-title">{track.title}</div>
        <div className="track-subtitle">{subtitle ?? track.artist ?? "Unknown artist"}</div>
      </div>
    </button>
  );
}
