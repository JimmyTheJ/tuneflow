import { trackThumbnailUrl } from "@/lib/thumbnails";
import type { Track } from "@/types";

export type MediaSessionHandlers = {
  play: () => void;
  pause: () => void;
  stop: () => void;
  nexttrack: () => void;
  previoustrack: () => void;
  seekto: (seconds: number) => void;
  seekbackward: (offsetSec: number) => void;
  seekforward: (offsetSec: number) => void;
};

const SEEK_OFFSET_SEC = 10;
const POSITION_THROTTLE_MS = 1000;

let handlersInstalled = false;
let lastPositionSyncMs = 0;
let lastTrackId: string | null = null;

function isSupported(): boolean {
  return typeof navigator !== "undefined" && "mediaSession" in navigator;
}

function artworkFor(track: Track): MediaImage[] {
  const src = track.thumbnail_url || trackThumbnailUrl(track.video_id);
  return [
    { src, sizes: "480x360", type: "image/jpeg" },
    { src, sizes: "320x180", type: "image/jpeg" },
  ];
}

function setActionHandler(
  action: MediaSessionAction,
  handler: MediaSessionActionHandler | null,
): void {
  try {
    navigator.mediaSession.setActionHandler(action, handler);
  } catch {
    /* browser may not support this action */
  }
}

export function installMediaSessionHandlers(handlers: MediaSessionHandlers): void {
  if (!isSupported() || handlersInstalled) return;
  handlersInstalled = true;

  setActionHandler("play", () => handlers.play());
  setActionHandler("pause", () => handlers.pause());
  setActionHandler("stop", () => handlers.stop());
  setActionHandler("previoustrack", () => handlers.previoustrack());
  setActionHandler("nexttrack", () => handlers.nexttrack());
  setActionHandler("seekto", (details) => {
    if (typeof details.seekTime === "number" && Number.isFinite(details.seekTime)) {
      handlers.seekto(details.seekTime);
    }
  });
  setActionHandler("seekbackward", (details) => {
    handlers.seekbackward(details.seekOffset ?? SEEK_OFFSET_SEC);
  });
  setActionHandler("seekforward", (details) => {
    handlers.seekforward(details.seekOffset ?? SEEK_OFFSET_SEC);
  });
}

export function clearMediaSession(): void {
  if (!isSupported()) return;

  lastTrackId = null;
  lastPositionSyncMs = 0;
  navigator.mediaSession.playbackState = "none";
  navigator.mediaSession.metadata = null;
  try {
    navigator.mediaSession.setPositionState();
  } catch {
    /* ignore */
  }
}

export function updateMediaSessionPosition(
  positionSec: number,
  durationSec: number,
  options?: { force?: boolean },
): void {
  if (!isSupported()) return;
  if (!(durationSec > 0) || !Number.isFinite(durationSec)) return;

  const now = Date.now();
  if (!options?.force && now - lastPositionSyncMs < POSITION_THROTTLE_MS) return;
  lastPositionSyncMs = now;

  const position = Math.max(0, Math.min(positionSec, durationSec));
  try {
    navigator.mediaSession.setPositionState({
      duration: durationSec,
      position,
      playbackRate: 1,
    });
  } catch {
    /* some browsers reject out-of-range position briefly during seeks */
  }
}

export function syncMediaSession(state: {
  track: Track | null;
  isPlaying: boolean;
  positionSec: number;
  durationSec: number;
}): void {
  if (!isSupported()) return;

  const { track, isPlaying, positionSec, durationSec } = state;
  if (!track) {
    clearMediaSession();
    return;
  }

  if (track.video_id !== lastTrackId) {
    lastTrackId = track.video_id;
    navigator.mediaSession.metadata = new MediaMetadata({
      title: track.title || "Unknown track",
      artist: track.artist || "Unknown artist",
      album: "Tuneflow",
      artwork: artworkFor(track),
    });
  }

  navigator.mediaSession.playbackState = isPlaying ? "playing" : "paused";
  updateMediaSessionPosition(positionSec, durationSec, { force: true });
}
