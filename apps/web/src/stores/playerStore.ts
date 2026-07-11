import { create } from "zustand";
import { api } from "@/lib/api";
import { getAccessToken, getApiUrl } from "@/lib/settings";
import type { StreamInfo, StreamSelection, Track } from "@/types";

type PlayerState = {
  current: Track | null;
  stream: StreamInfo | null;
  streamSelection: StreamSelection;
  isPlaying: boolean;
  isLoading: boolean;
  positionSec: number;
  durationSec: number;
  queue: Track[];
  media: HTMLMediaElement | null;
  error: string | null;
  playTrack: (track: Track, queue?: Track[]) => Promise<void>;
  togglePlayback: () => void;
  setStreamSelection: (selection: Partial<StreamSelection>) => Promise<void>;
  playPrevious: () => Promise<void>;
  playNext: () => Promise<void>;
  seek: (seconds: number) => void;
  stop: () => void;
  clearError: () => void;
};

const DEFAULT_SELECTION: StreamSelection = { video: false, audio: true };

let playGeneration = 0;

function isActiveGeneration(generation: number): boolean {
  return generation === playGeneration;
}

function normalizeSelection(
  selection: StreamSelection,
  stream: StreamInfo | null,
): StreamSelection {
  let next = { ...selection };
  if (!next.audio && !next.video) {
    next = { ...DEFAULT_SELECTION };
  }
  if (next.video && stream && !stream.has_video) {
    next.video = false;
  }
  return next;
}

function playableIdFromStream(stream: StreamInfo): string {
  return stream.playable_video_id ?? stream.video_id;
}

function buildMediaUrl(stream: StreamInfo, selection: StreamSelection): string {
  const token = encodeURIComponent(getAccessToken() ?? "");
  const base = getApiUrl();
  const playableId = playableIdFromStream(stream);

  if (selection.video) {
    const videoOnly = !selection.audio;
    const query = new URLSearchParams({ token });
    if (videoOnly) query.set("video_only", "true");
    return `${base}/api/music/video/${playableId}?${query.toString()}`;
  }

  return `${base}/api/music/audio/${playableId}?token=${token}`;
}

function disposeMedia(media: HTMLMediaElement | null): void {
  if (!media) return;
  media.pause();
  if (media instanceof HTMLVideoElement) {
    media.removeAttribute("src");
    media.load();
    media.remove();
    return;
  }
  media.removeAttribute("src");
  media.load();
}

function syncProgress(media: HTMLMediaElement, track: Track) {
  const duration = Number.isFinite(media.duration) ? media.duration : (track.duration_sec ?? 0);
  return {
    positionSec: media.currentTime || 0,
    durationSec: duration > 0 ? duration : (track.duration_sec ?? 0),
  };
}

function attachMediaListeners(
  media: HTMLMediaElement,
  track: Track,
  generation: number,
  set: (partial: Partial<PlayerState>) => void,
  get: () => PlayerState,
) {
  const shouldHandle = () => isActiveGeneration(generation);

  const updateProgress = () => {
    if (!shouldHandle()) return;
    set(syncProgress(media, track));
  };

  media.addEventListener("loadedmetadata", updateProgress);
  media.addEventListener("durationchange", updateProgress);
  media.addEventListener("timeupdate", updateProgress);
  media.addEventListener("ended", () => {
    if (!shouldHandle()) return;
    void get().playNext();
  });
  media.addEventListener("play", () => {
    if (!shouldHandle()) return;
    set({ isPlaying: true });
  });
  media.addEventListener("pause", () => {
    if (!shouldHandle()) return;
    set({ isPlaying: false });
  });
  media.addEventListener("error", () => {
    if (!shouldHandle()) return;
    set({ isLoading: false, isPlaying: false, error: "Playback failed — try another track" });
  });
}

function waitForMediaReady(media: HTMLMediaElement, timeoutMs = 120000): Promise<void> {
  return new Promise((resolve, reject) => {
    if (media.readyState >= HTMLMediaElement.HAVE_FUTURE_DATA) {
      resolve();
      return;
    }

    const timer = window.setTimeout(() => {
      cleanup();
      reject(new Error("Preparing audio is taking longer than expected — please wait and try again"));
    }, timeoutMs);

    const onCanPlay = () => {
      cleanup();
      resolve();
    };
    const onError = () => {
      cleanup();
      reject(new Error("Failed to load audio — the server may still be preparing this track"));
    };
    const cleanup = () => {
      window.clearTimeout(timer);
      media.removeEventListener("canplay", onCanPlay);
      media.removeEventListener("error", onError);
    };

    media.addEventListener("canplay", onCanPlay, { once: true });
    media.addEventListener("error", onError, { once: true });
  });
}

function createMediaElement(url: string, selection: StreamSelection): HTMLMediaElement {
  if (selection.video) {
    const video = document.createElement("video");
    video.src = url;
    video.playsInline = true;
    video.controls = false;
    video.preload = "auto";
    if (!selection.audio) {
      video.muted = true;
    }
    return video;
  }
  return new Audio(url);
}

async function loadMediaAt(
  stream: StreamInfo,
  track: Track,
  selection: StreamSelection,
  generation: number,
  set: (partial: Partial<PlayerState>) => void,
  get: () => PlayerState,
  startSec = 0,
  autoplay = true,
): Promise<HTMLMediaElement | null> {
  const mediaUrl = buildMediaUrl(stream, selection);
  const media = createMediaElement(mediaUrl, selection);
  attachMediaListeners(media, track, generation, set, get);

  await waitForMediaReady(media);
  if (!isActiveGeneration(generation)) {
    disposeMedia(media);
    return null;
  }

  if (autoplay) {
    await media.play();
  }
  if (!isActiveGeneration(generation)) {
    disposeMedia(media);
    return null;
  }

  if (startSec > 0) {
    media.currentTime = startSec;
  }

  return media;
}

export const usePlayerStore = create<PlayerState>((set, get) => ({
  current: null,
  stream: null,
  streamSelection: DEFAULT_SELECTION,
  isPlaying: false,
  isLoading: false,
  positionSec: 0,
  durationSec: 0,
  queue: [],
  media: null,
  error: null,

  clearError: () => set({ error: null }),

  playTrack: async (track, queue = []) => {
    const generation = ++playGeneration;
    disposeMedia(get().media);

    const nextQueue = queue.length ? queue : [track];
    const selection = normalizeSelection(get().streamSelection, get().stream);

    set({
      media: null,
      stream: null,
      isLoading: true,
      isPlaying: false,
      current: track,
      queue: nextQueue,
      streamSelection: selection,
      error: null,
      positionSec: 0,
      durationSec: track.duration_sec ?? 0,
    });

    let pendingMedia: HTMLMediaElement | null = null;

    try {
      const stream = await api.getStream(track.video_id);
      if (!isActiveGeneration(generation)) return;

      const resolvedSelection = normalizeSelection(selection, stream);
      pendingMedia = await loadMediaAt(
        stream,
        track,
        resolvedSelection,
        generation,
        set,
        get,
      );
      if (!pendingMedia) return;

      set({
        media: pendingMedia,
        stream,
        streamSelection: resolvedSelection,
        current: { ...track, video_id: playableIdFromStream(stream) },
        isPlaying: true,
        isLoading: false,
        ...syncProgress(pendingMedia, track),
      });
      pendingMedia = null;
      void api.recordPlay(track).catch(() => undefined);
    } catch (error) {
      if (pendingMedia) disposeMedia(pendingMedia);
      if (!isActiveGeneration(generation)) return;

      const message = error instanceof Error ? error.message : "Playback failed";
      set({ isLoading: false, isPlaying: false, error: message });
    }
  },

  setStreamSelection: async (patch) => {
    const { current, stream, media, streamSelection, positionSec, isPlaying } = get();
    if (!current || !stream) return;

    const nextSelection = normalizeSelection({ ...streamSelection, ...patch }, stream);
    const unchanged =
      nextSelection.video === streamSelection.video && nextSelection.audio === streamSelection.audio;
    if (unchanged) {
      set({ streamSelection: nextSelection });
      return;
    }

    const generation = ++playGeneration;
    const resumeSec = media?.currentTime ?? positionSec;
    disposeMedia(media);
    set({ media: null, isLoading: true, streamSelection: nextSelection, error: null });

    let pendingMedia: HTMLMediaElement | null = null;
    try {
      pendingMedia = await loadMediaAt(
        stream,
        current,
        nextSelection,
        generation,
        set,
        get,
        resumeSec,
        isPlaying,
      );
      if (!pendingMedia) return;

      set({
        media: pendingMedia,
        isLoading: false,
        isPlaying,
        ...syncProgress(pendingMedia, current),
      });
    } catch (error) {
      if (pendingMedia) disposeMedia(pendingMedia);
      if (!isActiveGeneration(generation)) return;
      const message = error instanceof Error ? error.message : "Could not switch stream";
      set({ isLoading: false, isPlaying: false, error: message });
    }
  },

  togglePlayback: () => {
    const { media, isPlaying } = get();
    if (!media) return;
    if (isPlaying) media.pause();
    else void media.play();
  },

  seek: (seconds: number) => {
    const { media, durationSec, current } = get();
    if (!media || !current) return;

    const max = durationSec || media.duration || 0;
    const clamped = max > 0 ? Math.max(0, Math.min(seconds, max)) : Math.max(0, seconds);
    media.currentTime = clamped;
    set({ positionSec: clamped });
  },

  playPrevious: async () => {
    const { current, queue, media, positionSec } = get();
    if (!current) return;

    if (media && positionSec > 3) {
      media.currentTime = 0;
      set({ positionSec: 0 });
      return;
    }

    if (queue.length <= 1) {
      if (media) {
        media.currentTime = 0;
        set({ positionSec: 0 });
      }
      return;
    }

    const index = queue.findIndex((t) => t.video_id === current.video_id);
    const previous = queue[index - 1];
    if (!previous) {
      if (media) {
        media.currentTime = 0;
        set({ positionSec: 0 });
      }
      return;
    }

    await get().playTrack(previous, queue);
  },

  playNext: async () => {
    const { current, queue } = get();
    if (!current || queue.length <= 1) {
      set({ isPlaying: false });
      return;
    }
    const index = queue.findIndex((t) => t.video_id === current.video_id);
    const next = queue[index + 1];
    if (!next) {
      set({ isPlaying: false });
      return;
    }
    await get().playTrack(next, queue);
  },

  stop: () => {
    playGeneration += 1;
    disposeMedia(get().media);
    set({
      media: null,
      stream: null,
      current: null,
      isPlaying: false,
      isLoading: false,
      positionSec: 0,
      durationSec: 0,
      queue: [],
      streamSelection: DEFAULT_SELECTION,
    });
  },
}));
