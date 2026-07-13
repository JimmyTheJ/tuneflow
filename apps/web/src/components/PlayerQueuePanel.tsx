import { useState, type DragEvent } from "react";
import { TrackRow } from "@/components/TrackRow";
import { getQueueView, usePlayerStore } from "@/stores/playerStore";

type Props = {
  onClose?: () => void;
  className?: string;
};

export function PlayerQueuePanel({ onClose, className }: Props) {
  const current = usePlayerStore((s) => s.current);
  const queue = usePlayerStore((s) => s.queue);
  const shuffle = usePlayerStore((s) => s.shuffle);
  const shuffleOrder = usePlayerStore((s) => s.shuffleOrder);
  const shuffleStep = usePlayerStore((s) => s.shuffleStep);
  const repeatMode = usePlayerStore((s) => s.repeatMode);
  const playQueueIndex = usePlayerStore((s) => s.playQueueIndex);
  const removeQueueIndex = usePlayerStore((s) => s.removeQueueIndex);
  const clearUpcoming = usePlayerStore((s) => s.clearUpcoming);
  const reorderQueue = usePlayerStore((s) => s.reorderQueue);

  const [draggedQueueIndex, setDraggedQueueIndex] = useState<number | null>(null);
  const [dropTargetQueueIndex, setDropTargetQueueIndex] = useState<number | null>(null);

  const items = getQueueView({ current, queue, shuffle, shuffleOrder, shuffleStep });
  const upcomingCount = items.filter((item) => item.status === "upcoming").length;

  const handleDragStart = (event: DragEvent<HTMLButtonElement>, queueIndex: number) => {
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", String(queueIndex));
    setDraggedQueueIndex(queueIndex);
  };

  const handleDragEnd = () => {
    setDraggedQueueIndex(null);
    setDropTargetQueueIndex(null);
  };

  const handleDragOver = (event: DragEvent<HTMLDivElement>, queueIndex: number) => {
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
    if (draggedQueueIndex != null && draggedQueueIndex !== queueIndex) {
      setDropTargetQueueIndex(queueIndex);
    }
  };

  const handleDrop = (event: DragEvent<HTMLDivElement>, queueIndex: number) => {
    event.preventDefault();
    const fromIndex = Number(event.dataTransfer.getData("text/plain"));
    if (Number.isFinite(fromIndex) && fromIndex !== queueIndex) {
      reorderQueue(fromIndex, queueIndex);
    }
    handleDragEnd();
  };

  if (items.length === 0) {
    return (
      <section className={className ? `player-queue ${className}` : "player-queue"}>
        <header className="player-queue-header">
          <h2>Queue</h2>
          {onClose ? (
            <button type="button" className="player-queue-close" onClick={onClose} aria-label="Close queue">
              ✕
            </button>
          ) : null}
        </header>
        <p className="muted player-queue-empty">Nothing in the queue yet.</p>
      </section>
    );
  }

  return (
    <section className={className ? `player-queue ${className}` : "player-queue"}>
      <header className="player-queue-header">
        <div>
          <h2>Queue</h2>
          <p className="player-queue-meta">
            {upcomingCount > 0 ? `${upcomingCount} up next` : "Last track"}
            {shuffle ? " · Shuffle on" : ""}
            {repeatMode === "all" ? " · Repeat all" : repeatMode === "one" ? " · Repeat one" : ""}
          </p>
        </div>
        <div className="player-queue-header-actions">
          {upcomingCount > 0 ? (
            <button
              type="button"
              className="player-queue-clear"
              onClick={clearUpcoming}
              title="Remove all upcoming tracks"
            >
              Clear upcoming
            </button>
          ) : null}
          {onClose ? (
            <button type="button" className="player-queue-close" onClick={onClose} aria-label="Close queue">
              ✕
            </button>
          ) : null}
        </div>
      </header>
      <div className="player-queue-list">
        {items.map((item) => {
          const isUpcoming = item.status === "upcoming";
          const isDragging = draggedQueueIndex === item.queueIndex;
          const isDropTarget = dropTargetQueueIndex === item.queueIndex;

          return (
            <div
              key={`${item.queueIndex}-${item.track.video_id}`}
              className={[
                "player-queue-item",
                item.status === "playing" ? "player-queue-item-playing" : undefined,
                isDragging ? "player-queue-item-dragging" : undefined,
                isDropTarget ? "player-queue-item-drop-target" : undefined,
              ]
                .filter(Boolean)
                .join(" ")}
              onDragOver={isUpcoming ? (event) => handleDragOver(event, item.queueIndex) : undefined}
              onDragLeave={isUpcoming ? () => setDropTargetQueueIndex(null) : undefined}
              onDrop={isUpcoming ? (event) => handleDrop(event, item.queueIndex) : undefined}
            >
              {isUpcoming ? (
                <button
                  type="button"
                  className="player-queue-drag"
                  draggable
                  aria-label={`Reorder ${item.track.title}`}
                  onDragStart={(event) => handleDragStart(event, item.queueIndex)}
                  onDragEnd={handleDragEnd}
                >
                  ⠿
                </button>
              ) : (
                <span className="player-queue-drag player-queue-drag-placeholder" aria-hidden="true" />
              )}
              <div className="player-queue-track">
                <TrackRow
                  track={item.track}
                  displayTitle={item.track.source_title ?? item.track.title}
                  showBadges
                  subtitle={
                    item.status === "playing"
                      ? `Now playing · ${item.track.artist ?? "Unknown artist"}`
                      : (item.track.artist ?? "Unknown artist")
                  }
                  onClick={
                    isUpcoming ? () => void playQueueIndex(item.queueIndex) : undefined
                  }
                />
              </div>
              <button
                type="button"
                className="player-queue-remove"
                aria-label={`Remove ${item.track.title} from queue`}
                onClick={() => void removeQueueIndex(item.queueIndex)}
              >
                ✕
              </button>
            </div>
          );
        })}
      </div>
    </section>
  );
}
