import { Pause, Play, SkipBack, SkipForward } from "lucide-react";
import { canPlayNext, canPlayPrevious, usePlayerStore } from "@/stores/playerStore";
import { PlayerQueueControls } from "@/components/PlayerQueueControls";
import { IconButton } from "@/components/ui/IconButton";
import { cn } from "@/lib/cn";

type Props = {
  size?: "mini" | "large";
  showQueueControls?: boolean;
};

export function PlayerTransport({ size = "mini", showQueueControls = false }: Props) {
  const canPrevious = usePlayerStore((s) => canPlayPrevious(s));
  const canNext = usePlayerStore((s) => canPlayNext(s));
  const isPlaying = usePlayerStore((s) => s.isPlaying);
  const isLoading = usePlayerStore((s) => s.isLoading);
  const togglePlayback = usePlayerStore((s) => s.togglePlayback);
  const playPrevious = usePlayerStore((s) => s.playPrevious);
  const playNext = usePlayerStore((s) => s.playNext);

  const large = size === "large";

  return (
    <div className={cn("flex items-center gap-2", large && "w-full justify-center gap-5")}>
      {showQueueControls ? <PlayerQueueControls compact={!large} showRepeat={false} /> : null}
      <IconButton
        label="Previous"
        size={large ? "lg" : "md"}
        disabled={!canPrevious}
        onClick={() => void playPrevious()}
      >
        <SkipBack className={large ? "size-6" : "size-5"} fill="currentColor" />
      </IconButton>
      <button
        type="button"
        aria-label={isPlaying ? "Pause" : "Play"}
        disabled={isLoading}
        onClick={() => togglePlayback()}
        className={cn(
          "inline-flex items-center justify-center rounded-full bg-text text-base transition-transform",
          "hover:scale-105 active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed",
          large ? "size-16" : "size-9",
        )}
      >
        {isLoading ? (
          <span className="tf-spinner border-base border-t-accent" />
        ) : isPlaying ? (
          <Pause className={large ? "size-7" : "size-4"} fill="currentColor" />
        ) : (
          <Play className={cn(large ? "size-7" : "size-4", "translate-x-0.5")} fill="currentColor" />
        )}
      </button>
      <IconButton
        label="Next"
        size={large ? "lg" : "md"}
        disabled={!canNext}
        onClick={() => void playNext()}
      >
        <SkipForward className={large ? "size-6" : "size-5"} fill="currentColor" />
      </IconButton>
      {showQueueControls ? (
        <PlayerQueueControls compact={!large} showShuffle={false} />
      ) : null}
    </div>
  );
}
