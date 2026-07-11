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

  const items = getQueueView({ current, queue, shuffle, shuffleOrder, shuffleStep });
  const upcomingCount = items.filter((item) => item.status === "upcoming").length;

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
        {onClose ? (
          <button type="button" className="player-queue-close" onClick={onClose} aria-label="Close queue">
            ✕
          </button>
        ) : null}
      </header>
      <div className="player-queue-list">
        {items.map((item) => (
          <div
            key={`${item.queueIndex}-${item.track.video_id}`}
            className={item.status === "playing" ? "player-queue-item-playing" : undefined}
          >
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
                item.status === "upcoming" ? () => void playQueueIndex(item.queueIndex) : undefined
              }
            />
          </div>
        ))}
      </div>
    </section>
  );
}
