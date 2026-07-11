import { usePlayerStore } from "@/stores/playerStore";

type Props = {
  className?: string;
  compact?: boolean;
};

export function PlayerVolume({ className, compact = false }: Props) {
  const volume = usePlayerStore((s) => s.volume);
  const setVolume = usePlayerStore((s) => s.setVolume);

  const icon = volume === 0 ? "🔇" : volume < 0.5 ? "🔉" : "🔊";

  return (
    <div className={className ? `player-volume ${className}` : "player-volume"}>
      <span className="player-volume-icon" aria-hidden="true">
        {icon}
      </span>
      <input
        className={compact ? "player-volume-slider player-volume-slider-compact" : "player-volume-slider"}
        type="range"
        min={0}
        max={1}
        step={0.01}
        value={volume}
        aria-label="Volume"
        onChange={(e) => setVolume(Number(e.target.value))}
      />
    </div>
  );
}
