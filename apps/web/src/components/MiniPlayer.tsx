import { Link, useLocation } from "react-router-dom";
import { ListMusic, SlidersHorizontal, X } from "lucide-react";
import { LikeButton } from "@/components/LikeButton";
import { PlayerProgress } from "@/components/PlayerProgress";
import { PlayerQueueDrawer } from "@/components/PlayerQueueDrawer";
import { PlayerTransport } from "@/components/PlayerTransport";
import { PlayerVolume } from "@/components/PlayerVolume";
import { TrackThumb } from "@/components/TrackThumb";
import { IconButton } from "@/components/ui/IconButton";
import { cn } from "@/lib/cn";
import { useAuthStore } from "@/stores/authStore";
import { getQueueView, hasActivePlayback, usePlayerStore } from "@/stores/playerStore";
import { usePlayerUiStore } from "@/stores/playerUiStore";

const FULL_WIDTH_ROUTES = new Set(["/login", "/setup"]);

export function MiniPlayer() {
  const location = useLocation();
  const queueOpen = usePlayerUiStore((s) => s.queueDrawerOpen);
  const setQueueDrawerOpen = usePlayerUiStore((s) => s.setQueueDrawerOpen);
  const user = useAuthStore((s) => s.user);
  const current = usePlayerStore((s) => s.current);
  const media = usePlayerStore((s) => s.media);
  const isLoading = usePlayerStore((s) => s.isLoading);
  const queue = usePlayerStore((s) => s.queue);
  const shuffle = usePlayerStore((s) => s.shuffle);
  const shuffleOrder = usePlayerStore((s) => s.shuffleOrder);
  const shuffleStep = usePlayerStore((s) => s.shuffleStep);
  const error = usePlayerStore((s) => s.error);
  const clearError = usePlayerStore((s) => s.clearError);
  const stop = usePlayerStore((s) => s.stop);

  const active = hasActivePlayback({ current, media, isLoading });
  if (!active) return null;

  const queueItems = getQueueView({ current, queue, shuffle, shuffleOrder, shuffleStep });
  const upcomingCount = queueItems.filter((item) => item.status === "upcoming").length;

  const fullWidth = !user || FULL_WIDTH_ROUTES.has(location.pathname);

  return (
    <>
      <PlayerQueueDrawer open={queueOpen} onClose={() => setQueueDrawerOpen(false)} />
      {error ? (
        <div
          className={cn(
            "fixed bottom-[calc(var(--spacing-player)+0.75rem)] z-50 flex max-w-lg items-center gap-3 rounded-full",
            "border border-danger/40 bg-danger-bg px-4 py-2 text-sm text-danger-fg shadow-elevated",
            fullWidth ? "left-1/2 -translate-x-1/2" : "left-[calc(var(--spacing-sidebar)+1.5rem)] right-6 md:left-[calc(var(--spacing-sidebar)+1.5rem)]",
          )}
        >
          <span className="min-w-0 flex-1 truncate">{error}</span>
          <button
            type="button"
            className="inline-flex size-6 items-center justify-center rounded-full hover:bg-white/10"
            onClick={() => clearError()}
            aria-label="Dismiss"
          >
            <X className="size-3.5" />
          </button>
        </div>
      ) : null}
      <div
        className={cn(
          "fixed inset-x-0 bottom-0 z-50 grid h-[var(--spacing-player)] items-center gap-4",
          "border-t border-border/80 bg-elevated/90 px-3 shadow-player backdrop-blur-2xl",
          "grid-cols-[1fr_auto] md:grid-cols-[minmax(180px,1fr)_minmax(280px,2fr)_minmax(180px,1fr)]",
          "md:px-4",
          !fullWidth && "md:left-[var(--spacing-sidebar)]",
        )}
      >
        {/* Left: meta */}
        <div className="flex min-w-0 items-center gap-3">
          <Link to="/player" className="flex min-w-0 flex-1 items-center gap-3">
            {current ? (
              <>
                <TrackThumb
                  videoId={current.video_id}
                  className="size-12 shrink-0 rounded-md"
                  fallbackClassName="size-12 shrink-0 rounded-md"
                />
                <div className="min-w-0">
                  <div className="truncate text-sm font-semibold text-text">{current.title}</div>
                  <div className="truncate text-xs text-text-secondary">
                    {current.artist ?? "Unknown artist"}
                  </div>
                </div>
              </>
            ) : (
              <div className="min-w-0">
                <div className="truncate text-sm font-semibold">Playback active</div>
                <div className="truncate text-xs text-text-secondary">Open Now Playing for controls</div>
              </div>
            )}
          </Link>
          {current ? (
            <div className="hidden shrink-0 sm:block">
              <LikeButton track={current} size="sm" />
            </div>
          ) : null}
        </div>

        {/* Center: transport + progress */}
        <div className="flex flex-col items-center gap-1.5">
          <PlayerTransport showQueueControls={Boolean(current)} />
          {current ? (
            <div className="hidden w-full max-w-xl md:block">
              <PlayerProgress />
            </div>
          ) : null}
        </div>

        {/* Right: queue + volume (desktop) */}
        <div className="hidden items-center justify-end gap-2 md:flex">
          {current ? (
            <Link to="/player#equalizer" title="Open equalizer">
              <IconButton label="Open equalizer" size="sm">
                <SlidersHorizontal className="size-4" />
              </IconButton>
            </Link>
          ) : null}
          {current && queue.length > 0 ? (
            <IconButton
              label={`Open queue, ${upcomingCount} up next`}
              active={queueOpen}
              size="sm"
              onClick={() => setQueueDrawerOpen(true)}
              title="Open queue (Q)"
            >
              <ListMusic className="size-4" />
              {upcomingCount > 0 ? (
                <span className="absolute -right-0.5 -top-0.5 flex size-4 items-center justify-center rounded-full bg-accent text-[0.6rem] font-bold text-accent-fg">
                  {upcomingCount > 9 ? "9+" : upcomingCount}
                </span>
              ) : null}
            </IconButton>
          ) : null}
          <PlayerVolume compact />
          <IconButton label="Stop" size="sm" onClick={() => stop()}>
            <X className="size-4" />
          </IconButton>
        </div>

        {/* Mobile extras */}
        <div className="flex items-center justify-end gap-1 md:hidden">
          {current ? (
            <Link to="/player#equalizer" title="Open equalizer">
              <IconButton label="Open equalizer" size="sm">
                <SlidersHorizontal className="size-4" />
              </IconButton>
            </Link>
          ) : null}
          {current && queue.length > 0 ? (
            <IconButton
              label={`Open queue, ${upcomingCount} up next`}
              size="sm"
              onClick={() => setQueueDrawerOpen(true)}
            >
              <ListMusic className="size-4" />
            </IconButton>
          ) : null}
          <IconButton label="Stop" size="sm" onClick={() => stop()}>
            <X className="size-4" />
          </IconButton>
        </div>
      </div>
    </>
  );
}
