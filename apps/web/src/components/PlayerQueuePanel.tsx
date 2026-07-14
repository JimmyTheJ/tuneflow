import { GripVertical, ListStart, X } from "lucide-react";
import { useCallback, useState, type DragEvent } from "react";
import { PlaylistPickerModal } from "@/components/PlaylistPickerModal";
import { TrackRow } from "@/components/TrackRow";
import { Button } from "@/components/ui/Button";
import { IconButton } from "@/components/ui/IconButton";
import { api } from "@/lib/api";
import { cn } from "@/lib/cn";
import { getQueueView, usePlayerStore } from "@/stores/playerStore";
import type { Playlist } from "@/types";

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
  const moveQueueToTop = usePlayerStore((s) => s.moveQueueToTop);

  const [draggedQueueIndex, setDraggedQueueIndex] = useState<number | null>(null);
  const [dropTargetQueueIndex, setDropTargetQueueIndex] = useState<number | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [playlists, setPlaylists] = useState<Playlist[]>([]);
  const [status, setStatus] = useState<string | null>(null);

  const showStatus = useCallback((message: string) => {
    setStatus(message);
    window.setTimeout(() => setStatus(null), 2200);
  }, []);

  const openSaveToPlaylist = async () => {
    try {
      setPlaylists(await api.listPlaylists());
      setPickerOpen(true);
    } catch (err) {
      showStatus(err instanceof Error ? err.message : "Could not load playlists");
    }
  };

  const reloadPlaylists = async () => {
    try {
      setPlaylists(await api.listPlaylists());
    } catch {
      /* ignore */
    }
  };

  const items = getQueueView({ current, queue, shuffle, shuffleOrder, shuffleStep });
  const queueTracks = items.map((item) => item.track);
  const upcomingCount = items.filter((item) => item.status === "upcoming").length;
  const firstUpcomingItem = items.find((item) => item.status === "upcoming");

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
      <section className={cn("flex flex-col gap-3", className)}>
        <header className="flex items-start justify-between gap-3">
          <h2 className="m-0 text-lg font-bold">Queue</h2>
          {onClose ? (
            <IconButton label="Close queue" size="sm" onClick={onClose}>
              <X className="size-4" />
            </IconButton>
          ) : null}
        </header>
        <p className="m-0 text-sm text-text-secondary">Nothing in the queue yet.</p>
      </section>
    );
  }

  return (
    <section className={cn("flex flex-col gap-3", className)}>
      <header className="flex items-start justify-between gap-3">
        <div>
          <h2 className="m-0 text-lg font-bold">Queue</h2>
          <p className="mt-1 mb-0 text-sm text-text-secondary">
            {upcomingCount > 0 ? `${upcomingCount} up next` : "Last track"}
            {shuffle ? " · Shuffle on" : ""}
            {repeatMode === "all" ? " · Repeat all" : repeatMode === "one" ? " · Repeat one" : ""}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {queueTracks.length > 0 ? (
            <Button variant="ghost" size="sm" onClick={() => void openSaveToPlaylist()}>
              Save to playlist
            </Button>
          ) : null}
          {upcomingCount > 0 ? (
            <Button variant="ghost" size="sm" onClick={clearUpcoming} title="Remove all upcoming tracks">
              Clear upcoming
            </Button>
          ) : null}
          {onClose ? (
            <IconButton label="Close queue" size="sm" onClick={onClose}>
              <X className="size-4" />
            </IconButton>
          ) : null}
        </div>
      </header>
      <div className="flex flex-col gap-0.5">
        {items.map((item) => {
          const isUpcoming = item.status === "upcoming";
          const isDragging = draggedQueueIndex === item.queueIndex;
          const isDropTarget = dropTargetQueueIndex === item.queueIndex;
          const isPlaying = item.status === "playing";

          return (
            <div
              key={`${item.queueIndex}-${item.track.video_id}`}
              className={cn(
                "group flex items-center gap-1 rounded-lg transition-colors",
                isPlaying && "bg-accent/10 ring-1 ring-inset ring-accent/30",
                isDragging && "opacity-40",
                isDropTarget && "outline outline-dashed outline-accent",
              )}
              onDragOver={isUpcoming ? (event) => handleDragOver(event, item.queueIndex) : undefined}
              onDragLeave={isUpcoming ? () => setDropTargetQueueIndex(null) : undefined}
              onDrop={isUpcoming ? (event) => handleDrop(event, item.queueIndex) : undefined}
            >
              {isUpcoming ? (
                <button
                  type="button"
                  className="cursor-grab touch-none px-1 py-2 text-text-muted hover:text-text active:cursor-grabbing"
                  draggable
                  aria-label={`Reorder ${item.track.title}`}
                  onDragStart={(event) => handleDragStart(event, item.queueIndex)}
                  onDragEnd={handleDragEnd}
                >
                  <GripVertical className="size-4" />
                </button>
              ) : (
                <span className="w-6 shrink-0" aria-hidden="true" />
              )}
              <div className="min-w-0 flex-1">
                <TrackRow
                  track={item.track}
                  displayTitle={item.track.source_title ?? item.track.title}
                  showBadges
                  subtitle={
                    isPlaying
                      ? `Now playing · ${item.track.artist ?? "Unknown artist"}`
                      : (item.track.artist ?? "Unknown artist")
                  }
                  onClick={isUpcoming ? () => void playQueueIndex(item.queueIndex) : undefined}
                />
              </div>
              {isUpcoming &&
              firstUpcomingItem != null &&
              item.queueIndex !== firstUpcomingItem.queueIndex ? (
                <IconButton
                  label={`Play ${item.track.title} next`}
                  size="sm"
                  className="opacity-0 group-hover:opacity-100"
                  onClick={() => moveQueueToTop(item.queueIndex)}
                >
                  <ListStart className="size-3.5" />
                </IconButton>
              ) : null}
              <IconButton
                label={`Remove ${item.track.title} from queue`}
                size="sm"
                className="opacity-0 group-hover:opacity-100"
                onClick={() => void removeQueueIndex(item.queueIndex)}
              >
                <X className="size-3.5" />
              </IconButton>
            </div>
          );
        })}
      </div>
      {status ? (
        <p className="m-0 text-sm text-accent" role="status" aria-live="polite">
          {status}
        </p>
      ) : null}
      <PlaylistPickerModal
        visible={pickerOpen}
        title="Save queue to playlist"
        tracks={queueTracks}
        playlists={playlists}
        onClose={() => setPickerOpen(false)}
        onComplete={showStatus}
        onPlaylistsChange={() => void reloadPlaylists()}
      />
    </section>
  );
}
