import { formatTime } from "@/lib/time";
import { usePlayerStore } from "@/stores/playerStore";

type Props = {
  className?: string;
};

export function PlayerProgress({ className }: Props) {
  const positionSec = usePlayerStore((s) => s.positionSec);
  const durationSec = usePlayerStore((s) => s.durationSec);
  const seek = usePlayerStore((s) => s.seek);

  const max = Math.max(durationSec, 0);
  const value = Math.min(positionSec, max || positionSec);

  return (
    <div className={className ? `player-progress ${className}` : "player-progress"}>
      <span className="player-time" aria-hidden="true">
        {formatTime(positionSec)}
      </span>
      <input
        className="player-progress-slider"
        type="range"
        min={0}
        max={max || 0}
        step={1}
        value={value}
        disabled={max <= 0}
        aria-label="Seek"
        onChange={(e) => seek(Number(e.target.value))}
      />
      <span className="player-time" aria-hidden="true">
        {formatTime(durationSec)}
      </span>
    </div>
  );
}
