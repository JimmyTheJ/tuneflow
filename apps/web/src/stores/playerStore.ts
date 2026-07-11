import { create } from "zustand";
import { api } from "@/lib/api";
import {
  clearPlayerSession,
  findDetachedTuneflowMedia,
  getPlayerRuntime,
  getPlayGeneration,
  isPlayGenerationActive,
  loadPlayerSession,
  nextPlayGeneration,
  parseTrackFromMediaUrl,
  savePlayerSession,
  setRuntimeMedia,
  type PlayerSessionSnapshot,
} from "@/lib/playerRuntime";
import { getAccessToken, getApiUrl } from "@/lib/settings";
import type { StreamInfo, StreamSelection, Track } from "@/types";

export type RepeatMode = "none" | "one" | "all";

type PlayerState = {
  current: Track | null;
  stream: StreamInfo | null;
  streamSelection: StreamSelection;
  isPlaying: boolean;
  isLoading: boolean;
  positionSec: number;
  durationSec: number;
  queue: Track[];
  shuffle: boolean;
  shuffleOrder: number[];
  shuffleStep: number;
  repeatMode: RepeatMode;
  volume: number;
  media: HTMLMediaElement | null;
  error: string | null;
  playTrack: (track: Track, queue?: Track[], options?: { fromNavigation?: boolean }) => Promise<void>;
  togglePlayback: () => void;
  setStreamSelection: (selection: Partial<StreamSelection>) => Promise<void>;
  playPrevious: () => Promise<void>;
  playNext: (fromAutoAdvance?: boolean) => Promise<void>;
  onTrackEnded: () => Promise<void>;
  seek: (seconds: number) => void;
  setVolume: (volume: number) => void;
  toggleShuffle: () => void;
  cycleRepeatMode: () => void;
  stop: () => void;
  recoverSession: () => boolean;
  stopOrphanedPlayback: () => void;
  clearError: () => void;
};

const DEFAULT_SELECTION: StreamSelection = { video: false, audio: true };
const VOLUME_KEY = "tuneflow.volume";

type MediaWithListeners = HTMLMediaElement & { __tuneflowListeners?: AbortController };

function isActiveGeneration(generation: number): boolean {
  return isPlayGenerationActive(generation);
}
function getStoredVolume(): number {
  const raw = localStorage.getItem(VOLUME_KEY);
  if (raw == null) return 1;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) return 1;
  return Math.max(0, Math.min(1, parsed));
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

function buildMediaUrl(stream: StreamInfo, selection: StreamSelection, track?: Track | null): string {
  const token = encodeURIComponent(getAccessToken() ?? "");
  const base = getApiUrl();
  const playableId = playableIdFromStream(stream);
  const params = new URLSearchParams({ token });
  if (track?.title) params.set("title", track.title);
  if (track?.artist) params.set("artist", track.artist);

  if (selection.video) {
    const videoOnly = !selection.audio;
    if (videoOnly) params.set("video_only", "true");
    return `${base}/api/music/video/${playableId}?${params.toString()}`;
  }

  return `${base}/api/music/audio/${playableId}?${params.toString()}`;
}

function applyVolume(
  media: HTMLMediaElement,
  volume: number,
  selection: StreamSelection,
): void {
  const clamped = Math.max(0, Math.min(1, volume));
  media.volume = clamped;
  if (media instanceof HTMLVideoElement) {
    media.muted = selection.video && !selection.audio ? true : clamped === 0;
  }
}

function disposeMedia(media: HTMLMediaElement | null): void {
  if (!media) return;
  const tagged = media as MediaWithListeners;
  tagged.__tuneflowListeners?.abort();
  tagged.__tuneflowListeners = undefined;
  if (getPlayerRuntime().media === media) {
    setRuntimeMedia(null);
  }
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

function snapshotFromState(state: PlayerState): PlayerSessionSnapshot | null {
  if (!state.current) return null;
  return {
    current: state.current,
    queue: state.queue,
    stream: state.stream,
    streamSelection: state.streamSelection,
    shuffle: state.shuffle,
    shuffleOrder: state.shuffleOrder,
    shuffleStep: state.shuffleStep,
    repeatMode: state.repeatMode,
  };
}

function persistSnapshot(state: PlayerState): void {
  const snapshot = snapshotFromState(state);
  if (snapshot) savePlayerSession(snapshot);
  else clearPlayerSession();
}

function syncProgress(media: HTMLMediaElement, track: Track) {
  const duration = Number.isFinite(media.duration) ? media.duration : (track.duration_sec ?? 0);
  return {
    positionSec: media.currentTime || 0,
    durationSec: duration > 0 ? duration : (track.duration_sec ?? 0),
  };
}

function currentQueueIndex(state: Pick<PlayerState, "current" | "queue">): number {
  if (!state.current) return -1;
  return state.queue.findIndex((track) => track.video_id === state.current!.video_id);
}

function buildShuffleOrder(length: number, currentIndex: number): number[] {
  if (length <= 0) return [];
  if (length === 1) return [0];

  const order = Array.from({ length }, (_, index) => index);
  for (let index = order.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1));
    [order[index], order[swapIndex]] = [order[swapIndex], order[index]];
  }

  const currentPosition = order.indexOf(currentIndex);
  if (currentPosition > 0) {
    order.splice(currentPosition, 1);
    order.unshift(currentIndex);
  }

  return order;
}

type NextAction =
  | { type: "track"; queueIndex: number; shuffleStep: number }
  | { type: "repeat-one" }
  | { type: "stop" };

function resolveNextAction(state: PlayerState): NextAction {
  const queueIndex = currentQueueIndex(state);
  if (queueIndex < 0) return { type: "stop" };

  if (state.queue.length <= 1) {
    if (state.repeatMode === "one") return { type: "repeat-one" };
    if (state.repeatMode === "all") {
      return { type: "track", queueIndex: 0, shuffleStep: 0 };
    }
    return { type: "stop" };
  }

  if (state.shuffle && state.shuffleOrder.length > 1) {
    const step = state.shuffleOrder.indexOf(queueIndex);
    const activeStep = step >= 0 ? step : state.shuffleStep;

    if (activeStep < state.shuffleOrder.length - 1) {
      const nextIndex = state.shuffleOrder[activeStep + 1];
      return { type: "track", queueIndex: nextIndex, shuffleStep: activeStep + 1 };
    }
    if (state.repeatMode === "all") {
      return { type: "track", queueIndex: state.shuffleOrder[0], shuffleStep: 0 };
    }
    if (state.repeatMode === "one") return { type: "repeat-one" };
    return { type: "stop" };
  }

  if (queueIndex < state.queue.length - 1) {
    return { type: "track", queueIndex: queueIndex + 1, shuffleStep: queueIndex + 1 };
  }
  if (state.repeatMode === "all") {
    return { type: "track", queueIndex: 0, shuffleStep: 0 };
  }
  if (state.repeatMode === "one") return { type: "repeat-one" };
  return { type: "stop" };
}

type PreviousAction =
  | { type: "track"; queueIndex: number; shuffleStep: number }
  | { type: "restart" };

function resolvePreviousAction(state: PlayerState): PreviousAction {
  const queueIndex = currentQueueIndex(state);
  if (queueIndex < 0) return { type: "restart" };

  if (state.media && state.positionSec > 3) {
    return { type: "restart" };
  }

  if (state.queue.length <= 1) {
    return { type: "restart" };
  }

  if (state.shuffle && state.shuffleOrder.length > 1) {
    const step = state.shuffleOrder.indexOf(queueIndex);
    const activeStep = step >= 0 ? step : state.shuffleStep;

    if (activeStep > 0) {
      const previousIndex = state.shuffleOrder[activeStep - 1];
      return { type: "track", queueIndex: previousIndex, shuffleStep: activeStep - 1 };
    }
    if (state.repeatMode === "all") {
      const lastStep = state.shuffleOrder.length - 1;
      return {
        type: "track",
        queueIndex: state.shuffleOrder[lastStep],
        shuffleStep: lastStep,
      };
    }
    return { type: "restart" };
  }

  if (queueIndex > 0) {
    return { type: "track", queueIndex: queueIndex - 1, shuffleStep: queueIndex - 1 };
  }
  if (state.repeatMode === "all") {
    const lastIndex = state.queue.length - 1;
    return { type: "track", queueIndex: lastIndex, shuffleStep: lastIndex };
  }
  return { type: "restart" };
}

function attachMediaListeners(
  media: HTMLMediaElement,
  track: Track,
  generation: number,
  set: (partial: Partial<PlayerState>) => void,
  get: () => PlayerState,
) {
  const tagged = media as MediaWithListeners;
  tagged.__tuneflowListeners?.abort();
  const abort = new AbortController();
  tagged.__tuneflowListeners = abort;
  const { signal } = abort;

  const shouldHandle = () => isActiveGeneration(generation);

  const updateProgress = () => {
    if (!shouldHandle()) return;
    set(syncProgress(media, track));
  };

  media.addEventListener("loadedmetadata", updateProgress, { signal });
  media.addEventListener("durationchange", updateProgress, { signal });
  media.addEventListener("timeupdate", updateProgress, { signal });
  media.addEventListener(
    "ended",
    () => {
      if (!shouldHandle()) return;
      void get().onTrackEnded();
    },
    { signal },
  );
  media.addEventListener(
    "play",
    () => {
      if (!shouldHandle()) return;
      set({ isPlaying: true });
    },
    { signal },
  );
  media.addEventListener(
    "pause",
    () => {
      if (!shouldHandle()) return;
      set({ isPlaying: false });
    },
    { signal },
  );
  media.addEventListener(
    "error",
    () => {
      if (!shouldHandle()) return;
      set({ isLoading: false, isPlaying: false, error: "Playback failed — try another track" });
    },
    { signal },
  );
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
  const mediaUrl = buildMediaUrl(stream, selection, track);
  const media = createMediaElement(mediaUrl, selection);
  applyVolume(media, get().volume, selection);
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

  setRuntimeMedia(media);
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
  shuffle: false,
  shuffleOrder: [],
  shuffleStep: 0,
  repeatMode: "none",
  volume: getStoredVolume(),
  media: null,
  error: null,

  clearError: () => set({ error: null }),

  setVolume: (volume) => {
    const clamped = Math.max(0, Math.min(1, volume));
    localStorage.setItem(VOLUME_KEY, String(clamped));
    const { media, streamSelection } = get();
    if (media) applyVolume(media, clamped, streamSelection);
    set({ volume: clamped });
  },

  toggleShuffle: () => {
    const state = get();
    if (state.queue.length <= 1) return;

    if (state.shuffle) {
      set({ shuffle: false, shuffleOrder: [], shuffleStep: currentQueueIndex(state) });
      return;
    }

    const queueIndex = currentQueueIndex(state);
    const shuffleOrder = buildShuffleOrder(state.queue.length, queueIndex >= 0 ? queueIndex : 0);
    set({ shuffle: true, shuffleOrder, shuffleStep: 0 });
  },

  cycleRepeatMode: () => {
    const next: Record<RepeatMode, RepeatMode> = {
      none: "all",
      all: "one",
      one: "none",
    };
    set({ repeatMode: next[get().repeatMode] });
  },

  playTrack: async (track, queue = [], options) => {
    const generation = nextPlayGeneration();
    disposeMedia(get().media);

    const nextQueue = queue.length ? queue : [track];
    const selection = normalizeSelection(get().streamSelection, get().stream);
    const queueIndex = nextQueue.findIndex((item) => item.video_id === track.video_id);
    const activeIndex = queueIndex >= 0 ? queueIndex : 0;

    let shuffleOrder = get().shuffleOrder;
    let shuffleStep = get().shuffleStep;
    if (get().shuffle && nextQueue.length > 1) {
      if (options?.fromNavigation && shuffleOrder.length === nextQueue.length) {
        shuffleStep = shuffleOrder.indexOf(activeIndex);
        if (shuffleStep < 0) shuffleStep = 0;
      } else {
        shuffleOrder = buildShuffleOrder(nextQueue.length, activeIndex);
        shuffleStep = 0;
      }
    } else {
      shuffleOrder = [];
      shuffleStep = activeIndex;
    }

    set({
      media: null,
      stream: null,
      isLoading: true,
      isPlaying: false,
      current: track,
      queue: nextQueue,
      shuffleOrder,
      shuffleStep,
      streamSelection: selection,
      error: null,
      positionSec: 0,
      durationSec: track.duration_sec ?? 0,
    });

    let pendingMedia: HTMLMediaElement | null = null;

    try {
      const stream = await api.getStream(track.video_id, track);
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
      persistSnapshot(get());
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
    const { current, stream, media, streamSelection, positionSec, isPlaying, volume } = get();
    if (!current || !stream) return;

    const nextSelection = normalizeSelection({ ...streamSelection, ...patch }, stream);
    const unchanged =
      nextSelection.video === streamSelection.video && nextSelection.audio === streamSelection.audio;
    if (unchanged) {
      set({ streamSelection: nextSelection });
      return;
    }

    const generation = nextPlayGeneration();
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

      applyVolume(pendingMedia, volume, nextSelection);
      set({
        media: pendingMedia,
        isLoading: false,
        isPlaying,
        ...syncProgress(pendingMedia, current),
      });
      persistSnapshot(get());
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

  onTrackEnded: async () => {
    if (get().repeatMode === "one") {
      const { media } = get();
      if (!media) return;
      media.currentTime = 0;
      set({ positionSec: 0 });
      await media.play();
      return;
    }
    await get().playNext(true);
  },

  playPrevious: async () => {
    const action = resolvePreviousAction(get());
    if (action.type === "restart") {
      const { media } = get();
      if (!media) return;
      media.currentTime = 0;
      set({ positionSec: 0 });
      return;
    }

    const track = get().queue[action.queueIndex];
    if (!track) return;
    set({ shuffleStep: action.shuffleStep });
    await get().playTrack(track, get().queue, { fromNavigation: true });
  },

  playNext: async (fromAutoAdvance = false) => {
    const action = resolveNextAction(get());
    if (action.type === "repeat-one") {
      const { media } = get();
      if (!media) return;
      media.currentTime = 0;
      set({ positionSec: 0 });
      if (fromAutoAdvance) await media.play();
      else void media.play();
      return;
    }
    if (action.type === "stop") {
      set({ isPlaying: false });
      return;
    }

    const track = get().queue[action.queueIndex];
    if (!track) {
      set({ isPlaying: false });
      return;
    }
    set({ shuffleStep: action.shuffleStep });
    await get().playTrack(track, get().queue, { fromNavigation: true });
  },

  recoverSession: () => {
    const state = get();
    if (state.media) {
      setRuntimeMedia(state.media);
      persistSnapshot(state);
      return true;
    }

    const orphan = findDetachedTuneflowMedia();
    if (!orphan?.src) return false;

    const snapshot = loadPlayerSession();
    const parsed = parseTrackFromMediaUrl(orphan.src);
    const track = snapshot?.current ?? parsed?.track;
    if (!track) return false;

    const streamSelection = snapshot?.streamSelection ?? parsed?.streamSelection ?? DEFAULT_SELECTION;
    const generation = getPlayGeneration();

    attachMediaListeners(orphan, track, generation, set, get);
    applyVolume(orphan, state.volume, streamSelection);
    setRuntimeMedia(orphan);

    const nextState: Partial<PlayerState> = {
      media: orphan,
      current: track,
      queue: snapshot?.queue ?? [track],
      stream: snapshot?.stream ?? null,
      streamSelection,
      shuffle: snapshot?.shuffle ?? false,
      shuffleOrder: snapshot?.shuffleOrder ?? [],
      shuffleStep: snapshot?.shuffleStep ?? 0,
      repeatMode: snapshot?.repeatMode ?? "none",
      isPlaying: !orphan.paused,
      isLoading: false,
      error: null,
      ...syncProgress(orphan, track),
    };
    set(nextState);
    persistSnapshot({ ...get(), ...nextState } as PlayerState);
    return true;
  },

  stopOrphanedPlayback: () => {
    nextPlayGeneration();
    const orphan = findDetachedTuneflowMedia();
    if (orphan) disposeMedia(orphan);
    clearPlayerSession();
  },

  stop: () => {
    nextPlayGeneration();
    disposeMedia(get().media);
    clearPlayerSession();
    set({
      media: null,
      stream: null,
      current: null,
      isPlaying: false,
      isLoading: false,
      positionSec: 0,
      durationSec: 0,
      queue: [],
      shuffleOrder: [],
      shuffleStep: 0,
      streamSelection: DEFAULT_SELECTION,
    });
  },
}));

if (import.meta.hot) {
  import.meta.hot.accept(() => {
    usePlayerStore.getState().recoverSession();
  });
}

export function hasActivePlayback(
  state: Pick<PlayerState, "current" | "media" | "isLoading">,
): boolean {
  return state.current != null || state.media != null || state.isLoading;
}

export function hasOrphanedPlayback(state: Pick<PlayerState, "media">): boolean {
  if (state.media) return false;
  return findDetachedTuneflowMedia() != null;
}

export function canPlayNext(state: Pick<PlayerState, "current" | "queue" | "repeatMode" | "shuffle" | "shuffleOrder" | "shuffleStep">): boolean {
  return resolveNextAction(state as PlayerState).type !== "stop";
}

export function canPlayPrevious(state: Pick<PlayerState, "current" | "queue" | "positionSec" | "repeatMode" | "shuffle" | "shuffleOrder" | "shuffleStep">): boolean {
  if (!state.current) return false;
  if (state.positionSec > 3) return true;
  if (state.queue.length <= 1) return false;

  const queueIndex = currentQueueIndex(state);
  if (queueIndex < 0) return false;

  if (state.shuffle && state.shuffleOrder.length > 1) {
    const step = state.shuffleOrder.indexOf(queueIndex);
    if (step > 0) return true;
    return state.repeatMode === "all";
  }

  if (queueIndex > 0) return true;
  return state.repeatMode === "all";
}
