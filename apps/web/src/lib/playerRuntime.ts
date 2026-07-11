import type { StreamInfo, StreamSelection, Track } from "@/types";

export type PlayerSessionSnapshot = {
  current: Track;
  queue: Track[];
  stream: StreamInfo | null;
  streamSelection: StreamSelection;
  shuffle: boolean;
  shuffleOrder: number[];
  shuffleStep: number;
  repeatMode: "none" | "one" | "all";
};

export type PlayerRuntime = {
  media: HTMLMediaElement | null;
  playGeneration: number;
};

const SESSION_KEY = "tuneflow.playerSession";

type TuneflowWindow = Window & { __tuneflowPlayerRuntime?: PlayerRuntime };

export function getPlayerRuntime(): PlayerRuntime {
  if (import.meta.hot) {
    const data = import.meta.hot.data as { tuneflowPlayerRuntime?: PlayerRuntime };
    if (!data.tuneflowPlayerRuntime) {
      data.tuneflowPlayerRuntime = { media: null, playGeneration: 0 };
    }
    return data.tuneflowPlayerRuntime;
  }

  const win = window as TuneflowWindow;
  if (!win.__tuneflowPlayerRuntime) {
    win.__tuneflowPlayerRuntime = { media: null, playGeneration: 0 };
  }
  return win.__tuneflowPlayerRuntime;
}

export function setRuntimeMedia(media: HTMLMediaElement | null): void {
  getPlayerRuntime().media = media;
}

export function nextPlayGeneration(): number {
  const runtime = getPlayerRuntime();
  runtime.playGeneration += 1;
  return runtime.playGeneration;
}

export function getPlayGeneration(): number {
  return getPlayerRuntime().playGeneration;
}

export function isPlayGenerationActive(generation: number): boolean {
  return generation === getPlayerRuntime().playGeneration;
}

export function savePlayerSession(snapshot: PlayerSessionSnapshot): void {
  try {
    sessionStorage.setItem(SESSION_KEY, JSON.stringify(snapshot));
  } catch {
    /* ignore quota / privacy mode */
  }
}

export function loadPlayerSession(): PlayerSessionSnapshot | null {
  try {
    const raw = sessionStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as PlayerSessionSnapshot;
  } catch {
    return null;
  }
}

export function clearPlayerSession(): void {
  sessionStorage.removeItem(SESSION_KEY);
}

export function parseTrackFromMediaUrl(
  src: string,
): { track: Track; streamSelection: StreamSelection } | null {
  try {
    const url = new URL(src, window.location.origin);
    const match = url.pathname.match(/\/api\/music\/(audio|video)\/([^/]+)/);
    if (!match) return null;

    const kind = match[1];
    const videoId = decodeURIComponent(match[2]);
    const title = url.searchParams.get("title") ?? "Unknown track";
    const artist = url.searchParams.get("artist");
    const videoOnly = url.searchParams.get("video_only") === "true";

    return {
      track: { video_id: videoId, title, artist },
      streamSelection:
        kind === "video"
          ? { video: true, audio: !videoOnly }
          : { video: false, audio: true },
    };
  } catch {
    return null;
  }
}

export function isOrphanedMedia(media: HTMLMediaElement): boolean {
  if (!media.src) return false;
  if (!media.paused) return true;
  return media.currentTime > 0 && !media.ended;
}

export function findDetachedTuneflowMedia(): HTMLMediaElement | null {
  const runtime = getPlayerRuntime();
  if (runtime.media && isOrphanedMedia(runtime.media)) {
    return runtime.media;
  }

  for (const element of document.querySelectorAll("audio, video")) {
    if (!(element instanceof HTMLMediaElement) || !element.src) continue;
    if (!parseTrackFromMediaUrl(element.src)) continue;
    if (!isOrphanedMedia(element)) continue;
    return element;
  }

  return null;
}
