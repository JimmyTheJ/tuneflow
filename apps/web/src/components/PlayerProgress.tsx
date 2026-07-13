import { formatTime } from "@/lib/time";
import { cn } from "@/lib/cn";
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
  const percent = max > 0 ? (value / max) * 100 : 0;

  return (
    <div className={cn("grid w-full grid-cols-[auto_1fr_auto] items-center gap-2", className)}>
      <span className="min-w-10 text-right text-xs tabular-nums text-text-muted" aria-hidden="true">
        {formatTime(positionSec)}
      </span>
      <input
        className="tf-slider"
        type="range"
        min={0}
        max={max || 0}
        step={1}
        value={value}
        disabled={max <= 0}
        aria-label="Seek"
        style={{ ["--value" as string]: `${percent}%` }}
        onChange={(e) => seek(Number(e.target.value))}
      />
      <span className="min-w-10 text-xs tabular-nums text-text-muted" aria-hidden="true">
        {formatTime(durationSec)}
      </span>
    </div>
  );
}
