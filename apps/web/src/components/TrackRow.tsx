import type { Track } from "@/types";

type Props = {
  track: Track;
  subtitle?: string;
  onClick?: () => void;
  disabled?: boolean;
};

export function TrackRow({ track, subtitle, onClick, disabled }: Props) {
  return (
    <button type="button" className="track-row" onClick={onClick} disabled={disabled}>
      {track.thumbnail_url ? (
        <img src={track.thumbnail_url} alt="" className="track-thumb" />
      ) : (
        <div className="track-thumb track-thumb-fallback" />
      )}
      <div className="track-meta">
        <div className="track-title">{track.title}</div>
        <div className="track-subtitle">{subtitle ?? track.artist ?? "Unknown artist"}</div>
      </div>
    </button>
  );
}
