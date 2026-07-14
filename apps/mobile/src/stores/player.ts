import AsyncStorage from "@react-native-async-storage/async-storage";
import { Audio } from "expo-av";
import { create } from "zustand";

import { api } from "@/lib/api";
import { getAccessToken, getApiUrl } from "@/lib/settings";
import { withRetry } from "@/lib/retry";
import type { StreamInfo, StreamSelection, Track } from "@/types";

export type RepeatMode = "none" | "one" | "all";

type VideoControls = {
  play: () => Promise<void>;
  pause: () => Promise<void>;
  getPositionSec: () => number;
  setPositionSec: (seconds: number) => Promise<void>;
};

type PlayerState = {
  current: Track | null;
  stream: StreamInfo | null;
  streamSelection: StreamSelection;
  mediaUrl: string | null;
  playbackKind: "audio" | "video";
  isPlaying: boolean;
  isLoading: boolean;
  positionSec: number;
  durationSec: number;
  volume: number;
  queue: Track[];
  shuffle: boolean;
  shuffleOrder: number[];
  shuffleStep: number;
  repeatMode: RepeatMode;
  sound: Audio.Sound | null;
  videoControls: VideoControls | null;
  error: string | null;
  playTrack: (track: Track, queue?: Track[], options?: { fromNavigation?: boolean }) => Promise<void>;
  togglePlayback: () => Promise<void>;
  setStreamSelection: (selection: Partial<StreamSelection>) => Promise<void>;
  registerVideoControls: (controls: VideoControls | null) => void;
  seek: (seconds: number) => Promise<void>;
  setVolume: (volume: number) => Promise<void>;
  toggleShuffle: () => void;
  cycleRepeatMode: () => void;
  playPrevious: () => Promise<void>;
  playNext: (fromAutoAdvance?: boolean) => Promise<void>;
  onTrackEnded: () => Promise<void>;
  playQueueIndex: (queueIndex: number) => Promise<void>;
  removeQueueIndex: (queueIndex: number) => Promise<void>;
  clearUpcoming: () => void;
  reorderQueue: (fromQueueIndex: number, toQueueIndex: number) => void;
  moveQueueToTop: (queueIndex: number) => void;
  addToQueue: (track: Track) => void;
  queueInsertIndex: number | null;
  stop: () => Promise<void>;
  clearError: () => void;
  reportProgress: (positionSec: number, durationSec?: number) => void;
};

const DEFAULT_SELECTION: StreamSelection = { video: false, audio: true };
const VOLUME_KEY = "tuneflow.volume";

let playGeneration = 0;
let storedVolume = 1;

void AsyncStorage.getItem(VOLUME_KEY).then((raw) => {
  if (raw == null) return;
  const parsed = Number(raw);
  if (Number.isFinite(parsed)) {
    storedVolume = Math.max(0, Math.min(1, parsed));
    usePlayerStore.setState({ volume: storedVolume });
  }
});

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
  const token = encodeURIComponent(getAccessTokenSync());
  const base = apiUrlCache;
  const playableId = playableIdFromStream(stream);

  if (selection.video) {
    const query = new URLSearchParams({ token });
    if (!selection.audio) {
      query.set("video_only", "true");
    }
    return `${base}/api/music/video/${playableId}?${query.toString()}`;
  }

  return `${base}/api/music/audio/${playableId}?token=${token}`;
}

let apiUrlCache = "http://localhost:8000";
let accessTokenCache = "";

void getApiUrl().then((url) => {
  apiUrlCache = url;
});
void getAccessToken().then((token) => {
  accessTokenCache = token;
});

function getAccessTokenSync(): string {
  return accessTokenCache;
}

export async function refreshPlayerMediaConfig(): Promise<void> {
  apiUrlCache = await getApiUrl();
  accessTokenCache = await getAccessToken();
}

async function disposeSound(sound: Audio.Sound | null): Promise<void> {
  if (!sound) return;
  try {
    await sound.stopAsync();
  } catch {
    /* already stopped */
  }
  try {
    await sound.unloadAsync();
  } catch {
    /* already unloaded */
  }
}

async function configureAudio() {
  await Audio.setAudioModeAsync({
    playsInSilentModeIOS: true,
    staysActiveInBackground: true,
    shouldDuckAndroid: true,
  });
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

  if (state.positionSec > 3) {
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

function expectedNextTrack(state: PlayerState): Track | null {
  const action = resolveNextAction(state);
  if (action.type !== "track") return null;
  return state.queue[action.queueIndex] ?? null;
}

type PrefetchEntry = {
  track: Track;
  stream: StreamInfo;
  selection: StreamSelection;
  mediaUrl: string;
  playbackKind: "audio" | "video";
  sound: Audio.Sound | null;
};

let prefetchToken = 0;
let prefetchEntry: PrefetchEntry | null = null;

async function clearPrefetch(): Promise<void> {
  if (!prefetchEntry) return;
  await disposeSound(prefetchEntry.sound);
  prefetchEntry = null;
}

function invalidatePrefetch(): void {
  prefetchToken += 1;
  void clearPrefetch();
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

async function prefetchNextTrack(get: () => PlayerState): Promise<void> {
  const token = prefetchToken + 1;
  prefetchToken = token;
  await clearPrefetch();

  const state = get();
  const track = expectedNextTrack(state);
  if (!track) return;

  const selection = normalizeSelection(state.streamSelection, state.stream);

  try {
    await refreshPlayerMediaConfig();
    const stream = await api.getStream(track.video_id, track);
    if (token !== prefetchToken) return;

    const resolvedSelection = normalizeSelection(selection, stream);
    const mediaUrl = buildMediaUrl(stream, resolvedSelection);
    const playbackKind = resolvedSelection.video ? "video" : "audio";

    let sound: Audio.Sound | null = null;
    if (playbackKind === "audio") {
      const created = await withRetry(
        () => Audio.Sound.createAsync({ uri: mediaUrl }, { shouldPlay: false, volume: get().volume }),
        {
          maxAttempts: 2,
          shouldRetry: (error) => error instanceof Error,
        },
      );
      if (token !== prefetchToken) {
        await disposeSound(created.sound);
        return;
      }
      sound = created.sound;
    }

    const latest = get();
    const latestTrack = expectedNextTrack(latest);
    if (!latestTrack || latestTrack.video_id !== track.video_id) {
      await disposeSound(sound);
      return;
    }

    const latestSelection = normalizeSelection(latest.streamSelection, latest.stream);
    if (!selectionMatches(latestSelection, resolvedSelection)) {
      await disposeSound(sound);
      return;
    }

    prefetchEntry = {
      track,
      stream,
      selection: resolvedSelection,
      mediaUrl,
      playbackKind,
      sound,
    };
  } catch {
    /* prefetch failure is non-fatal */
  }
}

function schedulePrefetchNext(get: () => PlayerState): void {
  syncPrefetchWithQueue(get);
}

async function loadAudioPlayback(
  mediaUrl: string,
  generation: number,
  set: (partial: Partial<PlayerState>) => void,
  get: () => PlayerState,
  autoplay: boolean,
): Promise<Audio.Sound | null> {
  const { sound } = await withRetry(
    () =>
      Audio.Sound.createAsync(
        { uri: mediaUrl },
        { shouldPlay: autoplay, volume: get().volume },
      ),
    {
      maxAttempts: 2,
      shouldRetry: (error) => error instanceof Error,
    },
  );
  if (!isActiveGeneration(generation)) {
    await disposeSound(sound);
    return null;
  }

  sound.setOnPlaybackStatusUpdate((status) => {
    if (!isActiveGeneration(generation)) return;
    if (!status.isLoaded) return;
    set({
      isPlaying: status.isPlaying,
      positionSec: (status.positionMillis ?? 0) / 1000,
      durationSec: (status.durationMillis ?? 0) / 1000 || get().durationSec,
    });
    if (status.didJustFinish) {
      void get().onTrackEnded();
    }
  });

  return sound;
}

export const usePlayerStore = create<PlayerState>((set, get) => ({
  current: null,
  stream: null,
  streamSelection: DEFAULT_SELECTION,
  mediaUrl: null,
  playbackKind: "audio",
  isPlaying: false,
  isLoading: false,
  positionSec: 0,
  durationSec: 0,
  volume: storedVolume,
  queue: [],
  queueInsertIndex: null,
  shuffle: false,
  shuffleOrder: [],
  shuffleStep: 0,
  repeatMode: "none",
  sound: null,
  videoControls: null,
  error: null,

  clearError: () => set({ error: null }),

  reportProgress: (positionSec, durationSec) => {
    set({
      positionSec,
      ...(durationSec != null && durationSec > 0 ? { durationSec } : {}),
    });
  },

  registerVideoControls: (controls) => set({ videoControls: controls }),

  setVolume: async (volume) => {
    const clamped = Math.max(0, Math.min(1, volume));
    storedVolume = clamped;
    void AsyncStorage.setItem(VOLUME_KEY, String(clamped));
    const { sound } = get();
    if (sound) {
      try {
        await sound.setVolumeAsync(clamped);
      } catch {
        /* ignore */
      }
    }
    set({ volume: clamped });
  },

  seek: async (seconds) => {
    const { sound, videoControls, playbackKind, durationSec } = get();
    const max = durationSec || 0;
    const clamped = max > 0 ? Math.max(0, Math.min(seconds, max)) : Math.max(0, seconds);
    set({ positionSec: clamped });

    if (playbackKind === "video") {
      await videoControls?.setPositionSec(clamped);
      return;
    }
    if (!sound) return;
    try {
      await sound.setPositionAsync(clamped * 1000);
    } catch {
      /* ignore */
    }
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

    const generation = ++playGeneration;
    await disposeSound(get().sound);
    get().videoControls?.pause().catch(() => undefined);
    await refreshPlayerMediaConfig();

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
      sound: null,
      mediaUrl: null,
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

    await configureAudio();

    try {
      const stream = adopted?.stream ?? (await api.getStream(track.video_id, track));
      if (!isActiveGeneration(generation)) return;

      const resolvedSelection = adopted?.selection ?? normalizeSelection(selection, stream);
      const mediaUrl = adopted?.mediaUrl ?? buildMediaUrl(stream, resolvedSelection);
      const playbackKind = adopted?.playbackKind ?? (resolvedSelection.video ? "video" : "audio");

      if (playbackKind === "audio") {
        let sound = adopted?.sound ?? null;
        if (!sound) {
          sound = await loadAudioPlayback(mediaUrl, generation, set, get, true);
        } else {
          sound.setOnPlaybackStatusUpdate((status) => {
            if (!isActiveGeneration(generation)) return;
            if (!status.isLoaded) return;
            set({
              isPlaying: status.isPlaying,
              positionSec: (status.positionMillis ?? 0) / 1000,
              durationSec: (status.durationMillis ?? 0) / 1000 || get().durationSec,
            });
            if (status.didJustFinish) {
              void get().onTrackEnded();
            }
          });
          await sound.setVolumeAsync(get().volume);
          await sound.playAsync();
        }
        if (!sound) return;
        set({
          sound,
          stream,
          mediaUrl,
          playbackKind,
          streamSelection: resolvedSelection,
          current: { ...track, video_id: playableIdFromStream(stream) },
          isPlaying: true,
          isLoading: false,
        });
      } else {
        set({
          sound: null,
          stream,
          mediaUrl,
          playbackKind,
          streamSelection: resolvedSelection,
          current: { ...track, video_id: playableIdFromStream(stream) },
          isPlaying: true,
          isLoading: false,
        });
      }

      void api.recordPlay(track).catch(() => undefined);
      schedulePrefetchNext(get);
    } catch (error) {
      if (!isActiveGeneration(generation)) return;
      const message = error instanceof Error ? error.message : "Playback failed";
      set({ isLoading: false, isPlaying: false, error: message });
    }
  },

  setStreamSelection: async (patch) => {
    const { current, stream, streamSelection, sound, videoControls, isPlaying, positionSec } = get();
    if (!current || !stream) return;

    const nextSelection = normalizeSelection({ ...streamSelection, ...patch }, stream);
    const unchanged =
      nextSelection.video === streamSelection.video && nextSelection.audio === streamSelection.audio;
    if (unchanged) {
      set({ streamSelection: nextSelection });
      return;
    }

    const generation = ++playGeneration;
    invalidatePrefetch();
    await refreshPlayerMediaConfig();
    const resumeSec =
      get().playbackKind === "video"
        ? (videoControls?.getPositionSec() ?? positionSec)
        : positionSec;

    await disposeSound(sound);
    videoControls?.pause().catch(() => undefined);

    const mediaUrl = buildMediaUrl(stream, nextSelection);
    const playbackKind = nextSelection.video ? "video" : "audio";
    set({ sound: null, mediaUrl, playbackKind, streamSelection: nextSelection, isLoading: true, error: null });

    try {
      if (playbackKind === "audio") {
        const nextSound = await loadAudioPlayback(mediaUrl, generation, set, get, isPlaying);
        if (!nextSound) return;
        if (resumeSec > 0) {
          await nextSound.setPositionAsync(resumeSec * 1000);
        }
        set({ sound: nextSound, isLoading: false, isPlaying, positionSec: resumeSec });
      } else {
        if (resumeSec > 0) {
          await videoControls?.setPositionSec(resumeSec);
        }
        if (isPlaying) {
          await videoControls?.play();
        }
        set({ sound: null, isLoading: false, isPlaying, positionSec: resumeSec });
      }
      schedulePrefetchNext(get);
    } catch (error) {
      if (!isActiveGeneration(generation)) return;
      const message = error instanceof Error ? error.message : "Could not switch stream";
      set({ isLoading: false, isPlaying: false, error: message });
    }
  },

  togglePlayback: async () => {
    const { playbackKind, sound, videoControls, isPlaying } = get();
    if (playbackKind === "video") {
      if (!videoControls) return;
      if (isPlaying) await videoControls.pause();
      else await videoControls.play();
      set({ isPlaying: !isPlaying });
      return;
    }
    if (!sound) return;
    if (isPlaying) await sound.pauseAsync();
    else await sound.playAsync();
  },

  onTrackEnded: async () => {
    if (get().repeatMode === "one") {
      await get().seek(0);
      const { playbackKind, sound, videoControls } = get();
      if (playbackKind === "video") await videoControls?.play();
      else await sound?.playAsync();
      set({ isPlaying: true });
      return;
    }
    await get().playNext(true);
  },

  playPrevious: async () => {
    const action = resolvePreviousAction(get());
    if (action.type === "restart") {
      await get().seek(0);
      return;
    }

    const track = get().queue[action.queueIndex];
    if (!track) return;
    set({ shuffleStep: action.shuffleStep });
    await get().playTrack(track, get().queue, { fromNavigation: true });
  },

  playNext: async (_fromAutoAdvance = false) => {
    const action = resolveNextAction(get());
    if (action.type === "repeat-one") {
      await get().seek(0);
      const { playbackKind, sound, videoControls } = get();
      if (playbackKind === "video") await videoControls?.play();
      else await sound?.playAsync();
      set({ isPlaying: true });
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

  playQueueIndex: async (queueIndex) => {
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

  removeQueueIndex: async (queueIndex) => {
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
        await get().stop();
        return;
      }

      const action = resolveNextAction(state);
      set({ queue: nextQueue, shuffleOrder, shuffleStep });

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
    syncPrefetchWithQueue(get);
  },

  clearUpcoming: () => {
    const state = get();
    if (state.queue.length === 0) return;

    const currentIndex = currentQueueIndex(state);
    if (currentIndex < 0) {
      void get().stop();
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
    syncPrefetchWithQueue(get);
  },

  moveQueueToTop: (queueIndex) => {
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

  reorderQueue: (fromQueueIndex, toQueueIndex) => {
    const state = get();
    if (fromQueueIndex === toQueueIndex) return;
    if (fromQueueIndex < 0 || toQueueIndex < 0) return;
    if (fromQueueIndex >= state.queue.length || toQueueIndex >= state.queue.length) return;

    const currentIndex = currentQueueIndex(state);
    if (fromQueueIndex === currentIndex || toQueueIndex === currentIndex) return;

    if (state.shuffle && state.shuffleOrder.length > 1) {
      const nextOrder = moveInShuffleOrder(state.shuffleOrder, fromQueueIndex, toQueueIndex);
      set({ shuffleOrder: nextOrder, queueInsertIndex: null });
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
    syncPrefetchWithQueue(get);
  },

  addToQueue: (track) => {
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
    if (state.current) {
      syncPrefetchWithQueue(get);
    }
  },

  stop: async () => {
    playGeneration += 1;
    invalidatePrefetch();
    await disposeSound(get().sound);
    get().videoControls?.pause().catch(() => undefined);
    set({
      sound: null,
      current: null,
      stream: null,
      mediaUrl: null,
      playbackKind: "audio",
      isPlaying: false,
      isLoading: false,
      positionSec: 0,
      durationSec: 0,
      queue: [],
      queueInsertIndex: null,
      shuffleOrder: [],
      shuffleStep: 0,
      streamSelection: DEFAULT_SELECTION,
      error: null,
    });
  },
}));

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

export function canPlayNext(
  state: Pick<
    PlayerState,
    "current" | "queue" | "repeatMode" | "shuffle" | "shuffleOrder" | "shuffleStep"
  >,
): boolean {
  return resolveNextAction(state as PlayerState).type !== "stop";
}

export function canPlayPrevious(
  state: Pick<
    PlayerState,
    "current" | "queue" | "positionSec" | "repeatMode" | "shuffle" | "shuffleOrder" | "shuffleStep"
  >,
): boolean {
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
