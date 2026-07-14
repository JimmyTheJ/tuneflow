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
import { isRetryablePlaybackFailure, withRetry } from "@/lib/retry";
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
  playQueueIndex: (queueIndex: number) => Promise<void>;
  removeQueueIndex: (queueIndex: number) => Promise<void>;
  clearUpcoming: () => void;
  reorderQueue: (fromQueueIndex: number, toQueueIndex: number) => void;
  moveQueueToTop: (queueIndex: number) => void;
  addToQueue: (track: Track) => void;
  queueInsertIndex: number | null;
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

function removeIndexFromShuffleOrder(
  shuffleOrder: number[],
  removedIndex: number,
  shuffleStep: number,
): { shuffleOrder: number[]; shuffleStep: number } {
  const removedStep = shuffleOrder.indexOf(removedIndex);
  const nextOrder = shuffleOrder
    .filter((index) => index !== removedIndex)
    .map((index) => (index > removedIndex ? index - 1 : index));

  let nextStep = shuffleStep;
  if (removedStep >= 0 && removedStep < shuffleStep) {
    nextStep = shuffleStep - 1;
  }

  return { shuffleOrder: nextOrder, shuffleStep: Math.max(0, nextStep) };
}

function moveInShuffleOrder(
  shuffleOrder: number[],
  fromQueueIndex: number,
  toQueueIndex: number,
): number[] {
  const fromStep = shuffleOrder.indexOf(fromQueueIndex);
  const toStep = shuffleOrder.indexOf(toQueueIndex);
  if (fromStep < 0 || toStep < 0 || fromStep === toStep) return shuffleOrder;

  const next = [...shuffleOrder];
  const [item] = next.splice(fromStep, 1);
  next.splice(toStep, 0, item);
  return next;
}

function moveInQueue(queue: Track[], fromIndex: number, toIndex: number): Track[] {
  if (fromIndex === toIndex) return queue;
  const next = [...queue];
  const [item] = next.splice(fromIndex, 1);
  next.splice(toIndex, 0, item);
  return next;
}

function resolveQueueInsertIndex(
  state: Pick<PlayerState, "current" | "queue" | "queueInsertIndex">,
): number {
  const currentIndex = currentQueueIndex(state);
  if (currentIndex < 0) return state.queue.length;

  const nextSlot = currentIndex + 1;
  if (state.queueInsertIndex == null || state.queueInsertIndex < nextSlot) {
    return nextSlot;
  }
  return Math.min(state.queueInsertIndex, state.queue.length);
}

function insertIndexIntoShuffleOrder(
  shuffleOrder: number[],
  shuffleStep: number,
  insertAt: number,
): number[] {
  const next = shuffleOrder.map((index) => (index >= insertAt ? index + 1 : index));
  next.splice(shuffleStep + 1, 0, insertAt);
  return next;
}

function adjustQueueInsertIndexAfterRemoval(
  queueInsertIndex: number | null,
  removedIndex: number,
): number | null {
  if (queueInsertIndex == null) return null;
  if (removedIndex < queueInsertIndex) return queueInsertIndex - 1;
  return queueInsertIndex;
}

function rotateQueueToIndex(queue: Track[], index: number): Track[] {
  if (index <= 0 || queue.length <= 1) return queue;
  return [...queue.slice(index), ...queue.slice(0, index)];
}

function rotateQueueFrom(
  state: Pick<PlayerState, "queue" | "shuffle" | "shuffleOrder">,
  queueIndex: number,
): { queue: Track[]; shuffleOrder: number[]; shuffleStep: number } {
  const clampedIndex = Math.max(0, Math.min(queueIndex, state.queue.length - 1));

  if (state.shuffle && state.shuffleOrder.length > 1) {
    const step = state.shuffleOrder.indexOf(clampedIndex);
    if (step >= 0) {
      const rotatedOrder = [
        ...state.shuffleOrder.slice(step),
        ...state.shuffleOrder.slice(0, step),
      ];
      const queue = rotatedOrder.map((index) => state.queue[index]!);
      return {
        queue,
        shuffleOrder: queue.map((_, index) => index),
        shuffleStep: 0,
      };
    }
  }

  const queue = rotateQueueToIndex(state.queue, clampedIndex);
  return { queue, shuffleOrder: [], shuffleStep: 0 };
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
  const audio = new Audio(url);
  audio.preload = "auto";
  return audio;
}

type PrefetchEntry = {
  track: Track;
  stream: StreamInfo;
  selection: StreamSelection;
  media: HTMLMediaElement;
};

let prefetchToken = 0;
let prefetchEntry: PrefetchEntry | null = null;

function clearPrefetch(): void {
  if (!prefetchEntry) return;
  disposeMedia(prefetchEntry.media);
  prefetchEntry = null;
}

function invalidatePrefetch(): void {
  prefetchToken += 1;
  clearPrefetch();
}

function selectionMatches(a: StreamSelection, b: StreamSelection): boolean {
  return a.video === b.video && a.audio === b.audio;
}

function tryAdoptPrefetch(track: Track, selection: StreamSelection): PrefetchEntry | null {
  if (!prefetchEntry || prefetchEntry.track.video_id !== track.video_id) return null;
  if (!selectionMatches(prefetchEntry.selection, selection)) {
    invalidatePrefetch();
    return null;
  }

  const entry = prefetchEntry;
  prefetchEntry = null;
  prefetchToken += 1;
  return entry;
}

function expectedNextTrack(state: PlayerState): Track | null {
  const action = resolveNextAction(state);
  if (action.type !== "track") return null;
  return state.queue[action.queueIndex] ?? null;
}

function prefetchMatchesNext(state: PlayerState): boolean {
  if (!prefetchEntry) return false;
  const next = expectedNextTrack(state);
  if (!next || next.video_id !== prefetchEntry.track.video_id) return false;
  const selection = normalizeSelection(state.streamSelection, state.stream);
  return selectionMatches(prefetchEntry.selection, selection);
}

function syncPrefetchWithQueue(get: () => PlayerState): void {
  if (!get().current) {
    invalidatePrefetch();
    return;
  }

  const state = get();
  if (!expectedNextTrack(state)) {
    invalidatePrefetch();
    return;
  }

  if (prefetchMatchesNext(state)) return;

  invalidatePrefetch();
  void prefetchNextTrack(get);
}

async function preloadMediaElement(
  stream: StreamInfo,
  track: Track,
  selection: StreamSelection,
  isStale: () => boolean,
): Promise<HTMLMediaElement | null> {
  const mediaUrl = buildMediaUrl(stream, selection, track);
  const media = createMediaElement(mediaUrl, selection);

  try {
    await withRetry(() => waitForMediaReady(media), {
      maxAttempts: 2,
      shouldRetry: isRetryablePlaybackFailure,
    });
  } catch {
    disposeMedia(media);
    return null;
  }

  if (isStale()) {
    disposeMedia(media);
    return null;
  }

  return media;
}

async function prefetchNextTrack(get: () => PlayerState): Promise<void> {
  const token = prefetchToken + 1;
  prefetchToken = token;
  clearPrefetch();

  const state = get();
  const action = resolveNextAction(state);
  if (action.type !== "track") return;

  const track = state.queue[action.queueIndex];
  if (!track) return;

  const selection = normalizeSelection(state.streamSelection, state.stream);

  try {
    const stream = await api.getStream(track.video_id, track);
    if (token !== prefetchToken) return;

    const resolvedSelection = normalizeSelection(selection, stream);
    const media = await preloadMediaElement(stream, track, resolvedSelection, () => token !== prefetchToken);
    if (!media) return;

    const latest = get();
    const latestAction = resolveNextAction(latest);
    if (latestAction.type !== "track") {
      disposeMedia(media);
      return;
    }

    const latestTrack = latest.queue[latestAction.queueIndex];
    if (!latestTrack || latestTrack.video_id !== track.video_id) {
      disposeMedia(media);
      return;
    }

    const latestSelection = normalizeSelection(latest.streamSelection, latest.stream);
    if (!selectionMatches(latestSelection, resolvedSelection)) {
      disposeMedia(media);
      return;
    }

    prefetchEntry = { track, stream, selection: resolvedSelection, media };
  } catch {
    /* prefetch failure is non-fatal; playNext falls back to a normal load */
  }
}

function schedulePrefetchNext(get: () => PlayerState): void {
  syncPrefetchWithQueue(get);
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

  await withRetry(() => waitForMediaReady(media), {
    maxAttempts: 2,
    shouldRetry: isRetryablePlaybackFailure,
  });
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
  queueInsertIndex: null,
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
      invalidatePrefetch();
      syncPrefetchWithQueue(get);
      return;
    }

    const queueIndex = currentQueueIndex(state);
    const shuffleOrder = buildShuffleOrder(state.queue.length, queueIndex >= 0 ? queueIndex : 0);
    set({ shuffle: true, shuffleOrder, shuffleStep: 0 });
    syncPrefetchWithQueue(get);
  },

  cycleRepeatMode: () => {
    const next: Record<RepeatMode, RepeatMode> = {
      none: "all",
      all: "one",
      one: "none",
    };
    set({ repeatMode: next[get().repeatMode] });
    syncPrefetchWithQueue(get);
  },

  playTrack: async (track, queue = [], options) => {
    if (!options?.fromNavigation) {
      const state = get();
      if (state.current && state.queue.length > 0) {
        const existingIndex = state.queue.findIndex((item) => item.video_id === track.video_id);
        if (existingIndex >= 0) {
          await get().playQueueIndex(existingIndex);
          return;
        }
      }
    }

    const generation = nextPlayGeneration();
    disposeMedia(get().media);

    const selection = normalizeSelection(get().streamSelection, get().stream);
    const adopted = tryAdoptPrefetch(track, selection);
    if (!adopted) {
      invalidatePrefetch();
    }

    let nextQueue = queue.length ? queue : [track];
    const queueIndex = nextQueue.findIndex((item) => item.video_id === track.video_id);
    let activeIndex = queueIndex >= 0 ? queueIndex : 0;

    if (!options?.fromNavigation && activeIndex > 0) {
      nextQueue = rotateQueueToIndex(nextQueue, activeIndex);
      activeIndex = 0;
    }

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
      queueInsertIndex: activeIndex + 1,
      shuffleOrder,
      shuffleStep,
      streamSelection: adopted?.selection ?? selection,
      error: null,
      positionSec: 0,
      durationSec: track.duration_sec ?? 0,
    });

    let pendingMedia: HTMLMediaElement | null = adopted?.media ?? null;

    try {
      let stream = adopted?.stream ?? null;
      if (!stream) {
        stream = await api.getStream(track.video_id, track);
      }
      if (!isActiveGeneration(generation)) return;

      const resolvedSelection = adopted?.selection ?? normalizeSelection(selection, stream);

      if (!pendingMedia) {
        pendingMedia = await loadMediaAt(
          stream,
          track,
          resolvedSelection,
          generation,
          set,
          get,
        );
      } else {
        applyVolume(pendingMedia, get().volume, resolvedSelection);
        attachMediaListeners(pendingMedia, track, generation, set, get);
        await pendingMedia.play();
        if (!isActiveGeneration(generation)) {
          disposeMedia(pendingMedia);
          return;
        }
        setRuntimeMedia(pendingMedia);
      }
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
      schedulePrefetchNext(get);
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
    invalidatePrefetch();
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
      schedulePrefetchNext(get);
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

  playQueueIndex: async (queueIndex: number) => {
    const state = get();
    if (queueIndex < 0 || queueIndex >= state.queue.length) return;

    const rotated = rotateQueueFrom(state, queueIndex);
    const track = rotated.queue[0];
    if (!track) return;

    set({
      shuffleOrder: rotated.shuffleOrder,
      shuffleStep: rotated.shuffleStep,
      queueInsertIndex: 1,
    });

    await get().playTrack(track, rotated.queue, { fromNavigation: true });
  },

  removeQueueIndex: async (queueIndex: number) => {
    const state = get();
    if (queueIndex < 0 || queueIndex >= state.queue.length) return;

    const currentIndex = currentQueueIndex(state);
    const isCurrent = queueIndex === currentIndex;
    const nextQueue = state.queue.filter((_, index) => index !== queueIndex);

    let shuffleOrder = state.shuffleOrder;
    let shuffleStep = state.shuffleStep;
    if (state.shuffle && shuffleOrder.length > 0) {
      ({ shuffleOrder, shuffleStep } = removeIndexFromShuffleOrder(
        shuffleOrder,
        queueIndex,
        shuffleStep,
      ));
    } else if (!isCurrent && queueIndex < shuffleStep) {
      shuffleStep = Math.max(0, shuffleStep - 1);
    }

    if (isCurrent) {
      if (nextQueue.length === 0) {
        get().stop();
        return;
      }

      const action = resolveNextAction(state);
      set({ queue: nextQueue, shuffleOrder, shuffleStep });
      persistSnapshot(get());

      if (action.type === "track" && action.queueIndex !== queueIndex) {
        const nextTrack = state.queue[action.queueIndex];
        const nextIndex = nextQueue.findIndex((track) => track.video_id === nextTrack.video_id);
        if (nextIndex >= 0) {
          if (state.shuffle && shuffleOrder.length > 1) {
            const step = shuffleOrder.indexOf(nextIndex);
            if (step >= 0) set({ shuffleStep: step });
          }
          await get().playTrack(nextTrack, nextQueue, { fromNavigation: true });
          return;
        }
      }

      const fallbackIndex = Math.min(queueIndex, nextQueue.length - 1);
      await get().playTrack(nextQueue[fallbackIndex], nextQueue, { fromNavigation: true });
      return;
    }

    const queueInsertIndex = adjustQueueInsertIndexAfterRemoval(
      state.queueInsertIndex,
      queueIndex,
    );
    set({ queue: nextQueue, shuffleOrder, shuffleStep, queueInsertIndex });
    persistSnapshot(get());
    syncPrefetchWithQueue(get);
  },

  clearUpcoming: () => {
    const state = get();
    if (state.queue.length === 0) return;

    const currentIndex = currentQueueIndex(state);
    if (currentIndex < 0) {
      get().stop();
      return;
    }

    if (currentIndex >= state.queue.length - 1) return;

    const nextQueue = [state.queue[currentIndex]];
    set({
      queue: nextQueue,
      queueInsertIndex: 1,
      shuffle: false,
      shuffleOrder: [],
      shuffleStep: 0,
    });
    persistSnapshot(get());
    syncPrefetchWithQueue(get);
  },

  moveQueueToTop: (queueIndex: number) => {
    const state = get();
    const currentIndex = currentQueueIndex(state);
    if (currentIndex < 0) return;
    if (queueIndex === currentIndex) return;

    if (state.shuffle && state.shuffleOrder.length > 1) {
      const fromStep = state.shuffleOrder.indexOf(queueIndex);
      const targetStep = state.shuffleStep + 1;
      if (fromStep < 0 || fromStep === targetStep) return;
      const toQueueIndex = state.shuffleOrder[targetStep];
      if (toQueueIndex == null) return;
      get().reorderQueue(queueIndex, toQueueIndex);
      return;
    }

    const targetIndex = currentIndex + 1;
    if (queueIndex <= currentIndex || queueIndex === targetIndex) return;

    get().reorderQueue(queueIndex, targetIndex);
  },

  reorderQueue: (fromQueueIndex: number, toQueueIndex: number) => {
    const state = get();
    if (fromQueueIndex === toQueueIndex) return;
    if (fromQueueIndex < 0 || toQueueIndex < 0) return;
    if (fromQueueIndex >= state.queue.length || toQueueIndex >= state.queue.length) return;

    const currentIndex = currentQueueIndex(state);
    if (fromQueueIndex === currentIndex || toQueueIndex === currentIndex) return;

    if (state.shuffle && state.shuffleOrder.length > 1) {
      const nextOrder = moveInShuffleOrder(state.shuffleOrder, fromQueueIndex, toQueueIndex);
      set({ shuffleOrder: nextOrder, queueInsertIndex: null });
      persistSnapshot(get());
      syncPrefetchWithQueue(get);
      return;
    }

    const nextQueue = moveInQueue(state.queue, fromQueueIndex, toQueueIndex);
    let shuffleStep = state.shuffleStep;
    if (fromQueueIndex === shuffleStep) {
      shuffleStep = toQueueIndex;
    } else if (fromQueueIndex < shuffleStep && toQueueIndex >= shuffleStep) {
      shuffleStep -= 1;
    } else if (fromQueueIndex > shuffleStep && toQueueIndex <= shuffleStep) {
      shuffleStep += 1;
    }

    set({ queue: nextQueue, shuffleStep, queueInsertIndex: null });
    persistSnapshot(get());
    syncPrefetchWithQueue(get);
  },

  addToQueue: (track: Track) => {
    const state = get();
    const currentIndex = currentQueueIndex(state);

    if (currentIndex < 0) {
      const nextQueue = [...state.queue, track];
      const nextIndex = nextQueue.length - 1;

      let shuffleOrder = state.shuffleOrder;
      if (state.shuffle) {
        shuffleOrder = shuffleOrder.length > 0 ? [...shuffleOrder, nextIndex] : [nextIndex];
      }

      set({ queue: nextQueue, shuffleOrder });
      return;
    }

    const insertAt = resolveQueueInsertIndex(state);
    const nextQueue = [...state.queue];
    nextQueue.splice(insertAt, 0, track);

    let shuffleOrder = state.shuffleOrder;
    let shuffleStep = state.shuffleStep;
    if (state.shuffle && shuffleOrder.length > 0) {
      shuffleOrder = insertIndexIntoShuffleOrder(shuffleOrder, shuffleStep, insertAt);
    } else if (!state.shuffle && insertAt <= shuffleStep) {
      shuffleStep += 1;
    }

    set({
      queue: nextQueue,
      shuffleOrder,
      shuffleStep,
      queueInsertIndex: insertAt + 1,
    });
    persistSnapshot(get());
    syncPrefetchWithQueue(get);
  },

  stop: () => {
    nextPlayGeneration();
    invalidatePrefetch();
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
      queueInsertIndex: null,
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

export type QueueViewItem = {
  track: Track;
  queueIndex: number;
  status: "playing" | "upcoming";
};

export function getQueueView(
  state: Pick<PlayerState, "current" | "queue" | "shuffle" | "shuffleOrder" | "shuffleStep">,
): QueueViewItem[] {
  if (!state.current || state.queue.length === 0) return [];

  const currentIndex = currentQueueIndex(state);
  if (currentIndex < 0) {
    return [{ track: state.current, queueIndex: 0, status: "playing" }];
  }

  const items: QueueViewItem[] = [];

  if (state.shuffle && state.shuffleOrder.length > 1) {
    const step = state.shuffleOrder.indexOf(currentIndex);
    const activeStep = step >= 0 ? step : state.shuffleStep;

    items.push({ track: state.queue[currentIndex], queueIndex: currentIndex, status: "playing" });
    for (let index = activeStep + 1; index < state.shuffleOrder.length; index += 1) {
      const queueIndex = state.shuffleOrder[index];
      items.push({ track: state.queue[queueIndex], queueIndex, status: "upcoming" });
    }
    return items;
  }

  for (let index = currentIndex; index < state.queue.length; index += 1) {
    items.push({
      track: state.queue[index],
      queueIndex: index,
      status: index === currentIndex ? "playing" : "upcoming",
    });
  }
  return items;
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
