import { useEffect, useState } from "react";
import { LikeButton } from "@/components/LikeButton";
import { PlayerProgress } from "@/components/PlayerProgress";
import { PlayerQueuePanel } from "@/components/PlayerQueuePanel";
import { PlayerTransport } from "@/components/PlayerTransport";
import { PlayerVideo } from "@/components/PlayerVideo";
import { PlayerVolume } from "@/components/PlayerVolume";
import { StreamModeToggle } from "@/components/StreamModeToggle";
import { TrackDownloadButton } from "@/components/TrackDownloadButton";
import { TrackThumb } from "@/components/TrackThumb";
import { Button } from "@/components/ui/Button";
import { usePlayerPageHotkeys } from "@/hooks/usePlayerPageHotkeys";
import { trackThumbnailUrl } from "@/lib/thumbnails";
import {
  hasActivePlayback,
  hasOrphanedPlayback,
  usePlayerStore,
} from "@/stores/playerStore";

export function PlayerPage() {
  usePlayerPageHotkeys();
  const current = usePlayerStore((s) => s.current);
  const media = usePlayerStore((s) => s.media);
  const isLoading = usePlayerStore((s) => s.isLoading);
  const streamSelection = usePlayerStore((s) => s.streamSelection);
  const queue = usePlayerStore((s) => s.queue);
  const stop = usePlayerStore((s) => s.stop);
  const recoverSession = usePlayerStore((s) => s.recoverSession);
  const stopOrphanedPlayback = usePlayerStore((s) => s.stopOrphanedPlayback);
  const [orphaned, setOrphaned] = useState(false);

  useEffect(() => {
    const recovered = recoverSession();
    if (!recovered) {
      setOrphaned(hasOrphanedPlayback(usePlayerStore.getState()));
    }
  }, [recoverSession]);

  const active = hasActivePlayback({
    current,
    media,
    isLoading,
  });

  if (!active) {
    if (orphaned) {
      return (
        <div className="mx-auto max-w-lg rounded-2xl bg-elevated p-8 text-center shadow-card">
          <h1 className="m-0 text-2xl font-bold tracking-tight">Playback disconnected</h1>
          <p className="mt-3 text-text-secondary">
            Audio is still playing in this tab, but the player state was lost — often after a
            hot reload.
          </p>
          <div className="mt-6 flex flex-col items-center gap-3">
            <Button
              onClick={() => {
                const recovered = recoverSession();
                if (recovered) {
                  setOrphaned(false);
                  return;
                }
                setOrphaned(hasOrphanedPlayback(usePlayerStore.getState()));
              }}
            >
              Reconnect playback
            </Button>
            <Button
              variant="secondary"
              onClick={() => {
                stopOrphanedPlayback();
                setOrphaned(false);
              }}
            >
              Stop audio
            </Button>
          </div>
        </div>
      );
    }

    return (
      <div className="flex min-h-[50vh] flex-col items-center justify-center text-center">
        <p className="text-lg text-text-secondary">Nothing playing</p>
        <p className="mt-2 text-sm text-text-muted">Pick a track from Search or your Library.</p>
      </div>
    );
  }

  if (!current) {
    return (
      <div className="mx-auto flex max-w-md flex-col items-center gap-6 py-12 text-center">
        <h1 className="m-0 text-3xl font-bold tracking-tight">Playback active</h1>
        <p className="m-0 text-text-secondary">Controls for audio that is still playing in this tab.</p>
        <PlayerTransport size="large" />
        <Button variant="secondary" onClick={() => stop()}>
          Stop
        </Button>
      </div>
    );
  }

  const artUrl = trackThumbnailUrl(current.video_id);

  return (
    <div className="relative -mx-4 -mt-6 overflow-hidden md:-mx-8 md:-mt-8">
      {/* Blurred backdrop */}
      <div className="pointer-events-none absolute inset-0 -z-10">
        <img
          src={artUrl}
          alt=""
          className="size-full scale-125 object-cover opacity-40 blur-3xl"
          aria-hidden="true"
        />
        <div className="absolute inset-0 bg-gradient-to-b from-base/40 via-base/80 to-base" />
      </div>

      <div className="mx-auto flex max-w-2xl flex-col items-center px-4 py-10 text-center md:py-16">
        {streamSelection.video ? (
          <div className="mb-8 w-full max-w-[720px] overflow-hidden rounded-2xl bg-black shadow-elevated aspect-video">
            <PlayerVideo className="size-full [&_video]:size-full [&_video]:object-contain" />
          </div>
        ) : (
          <TrackThumb
            videoId={current.video_id}
            className="mb-8 size-[min(280px,70vw)] rounded-2xl shadow-elevated"
            fallbackClassName="mb-8 size-[min(280px,70vw)] rounded-2xl shadow-elevated"
          />
        )}

        <h1 className="m-0 max-w-full truncate text-3xl font-bold tracking-tight md:text-4xl">
          {current.title}
        </h1>
        <div className="mt-3 flex items-center justify-center gap-3">
          <p className="m-0 text-lg text-text-secondary">{current.artist ?? "Unknown artist"}</p>
          <LikeButton track={current} size="lg" />
          <TrackDownloadButton track={current} variant="icon" size="lg" />
        </div>

        <div className="mt-10 flex w-full max-w-md flex-col items-center gap-5">
          <StreamModeToggle />
          <PlayerTransport size="large" showQueueControls />
          <PlayerProgress className="w-full" />
          <PlayerVolume className="w-full max-w-[280px]" />
          <Button variant="secondary" size="sm" onClick={() => stop()}>
            Stop
          </Button>
        </div>

        {queue.length > 0 ? (
          <div className="mt-12 w-full max-w-xl text-left">
            <PlayerQueuePanel />
          </div>
        ) : null}

        <p className="mt-10 text-xs leading-relaxed text-text-muted">
          Space play/pause · ←/→ seek · Shift+←/→ skip · ↑/↓ volume · M mute · L like · V video · S
          shuffle · R repeat
        </p>
      </div>
    </div>
  );
}
