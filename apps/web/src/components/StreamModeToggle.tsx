import { usePlayerStore } from "@/stores/playerStore";

export function StreamModeToggle() {
  const stream = usePlayerStore((s) => s.stream);
  const selection = usePlayerStore((s) => s.streamSelection);
  const isLoading = usePlayerStore((s) => s.isLoading);
  const setStreamSelection = usePlayerStore((s) => s.setStreamSelection);

  if (!stream) return null;

  const videoDisabled = !stream.has_video;

  return (
    <div className="stream-mode-toggle" role="group" aria-label="Stream mode">
      <button
        type="button"
        className={`stream-mode-btn${selection.audio ? " stream-mode-btn-active" : ""}`}
        disabled={isLoading || (selection.audio && !selection.video)}
        onClick={() => void setStreamSelection({ audio: !selection.audio })}
        aria-pressed={selection.audio}
      >
        Audio
      </button>
      <button
        type="button"
        className={`stream-mode-btn${selection.video ? " stream-mode-btn-active" : ""}`}
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
