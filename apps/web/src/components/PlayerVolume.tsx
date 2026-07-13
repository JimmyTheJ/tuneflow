import { Volume1, Volume2, VolumeX } from "lucide-react";
import { IconButton } from "@/components/ui/IconButton";
import { cn } from "@/lib/cn";
import { usePlayerStore } from "@/stores/playerStore";

type Props = {
  className?: string;
  compact?: boolean;
};

export function PlayerVolume({ className, compact = false }: Props) {
  const volume = usePlayerStore((s) => s.volume);
  const setVolume = usePlayerStore((s) => s.setVolume);

  const Icon = volume === 0 ? VolumeX : volume < 0.5 ? Volume1 : Volume2;
  const percent = volume * 100;

  return (
    <div className={cn("flex items-center gap-2", className)}>
      <IconButton
        label={volume === 0 ? "Unmute" : "Mute"}
        size="sm"
        onClick={() => setVolume(volume === 0 ? 0.7 : 0)}
      >
        <Icon className="size-4" />
      </IconButton>
      <input
        className={cn("tf-slider", compact ? "max-w-[110px]" : "w-full max-w-[160px]")}
        type="range"
        min={0}
        max={1}
        step={0.01}
        value={volume}
        aria-label="Volume"
        style={{ ["--value" as string]: `${percent}%` }}
        onChange={(e) => setVolume(Number(e.target.value))}
      />
    </div>
  );
}
