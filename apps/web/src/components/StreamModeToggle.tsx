import { usePlayerStore } from "@/stores/playerStore";
import { cn } from "@/lib/cn";

export function StreamModeToggle() {
  const stream = usePlayerStore((s) => s.stream);
  const selection = usePlayerStore((s) => s.streamSelection);
  const isLoading = usePlayerStore((s) => s.isLoading);
  const setStreamSelection = usePlayerStore((s) => s.setStreamSelection);

  if (!stream) return null;

  const videoDisabled = !stream.has_video;

  return (
    <div
      className="inline-flex gap-1 rounded-full bg-elevated p-1 ring-1 ring-border"
      role="group"
      aria-label="Stream mode"
    >
      <button
        type="button"
        className={cn(
          "rounded-full px-4 py-1.5 text-sm font-semibold transition-colors border-0 cursor-pointer",
          selection.audio
            ? "bg-highlight text-text shadow-sm"
            : "bg-transparent text-text-secondary hover:text-text",
          "disabled:cursor-not-allowed disabled:opacity-45",
        )}
        disabled={isLoading || (selection.audio && !selection.video)}
        onClick={() => void setStreamSelection({ audio: !selection.audio })}
        aria-pressed={selection.audio}
      >
        Audio
      </button>
      <button
        type="button"
        className={cn(
          "rounded-full px-4 py-1.5 text-sm font-semibold transition-colors border-0 cursor-pointer",
          selection.video
            ? "bg-highlight text-text shadow-sm"
            : "bg-transparent text-text-secondary hover:text-text",
          "disabled:cursor-not-allowed disabled:opacity-45",
        )}
        disabled={isLoading || videoDisabled || (selection.video && !selection.audio)}
        title={videoDisabled ? "No video stream for this track" : undefined}
        onClick={() => void setStreamSelection({ video: !selection.video })}
        aria-pressed={selection.video}
      >
        Video
      </button>
    </div>
  );
}
