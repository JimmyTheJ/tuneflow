import { Audio } from "expo-av";
import { create } from "zustand";

import { api } from "@/lib/api";
import { getAccessToken, getApiUrl } from "@/lib/settings";
import { withRetry } from "@/lib/retry";
import type { StreamInfo, StreamSelection, Track } from "@/types";

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
  queue: Track[];
  sound: Audio.Sound | null;
  videoControls: VideoControls | null;
  playTrack: (track: Track, queue?: Track[]) => Promise<void>;
  togglePlayback: () => Promise<void>;
  setStreamSelection: (selection: Partial<StreamSelection>) => Promise<void>;
  registerVideoControls: (controls: VideoControls | null) => void;
  playNext: () => Promise<void>;
  stop: () => Promise<void>;
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
    const query = new URLSearchParams({ token });
    if (!selection.audio) {
      query.set("video_only", "true");
    }
    return `${base}/api/music/video/${playableId}?${query.toString()}`;
  }

  return `${base}/api/music/audio/${playableId}?token=${token}`;
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

async function loadAudioPlayback(
  mediaUrl: string,
  generation: number,
  set: (partial: Partial<PlayerState>) => void,
  get: () => PlayerState,
  autoplay: boolean,
): Promise<Audio.Sound | null> {
  const { sound } = await withRetry(
    () => Audio.Sound.createAsync({ uri: mediaUrl }, { shouldPlay: autoplay }),
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
    set({ isPlaying: status.isPlaying });
    if (status.didJustFinish) {
      void get().playNext();
    }
  });

  return sound;
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

function getNextTrack(state: PlayerState): Track | null {
  const { current, queue } = state;
  if (!current || queue.length <= 1) return null;
  const index = queue.findIndex((track) => track.video_id === current.video_id);
  return queue[index + 1] ?? null;
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
  const next = getNextTrack(state);
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
  if (!getNextTrack(state)) {
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
  const track = getNextTrack(state);
  if (!track) return;

  const selection = normalizeSelection(state.streamSelection, state.stream);

  try {
    const stream = await api.getStream(track.video_id, track);
    if (token !== prefetchToken) return;

    const resolvedSelection = normalizeSelection(selection, stream);
    const mediaUrl = buildMediaUrl(stream, resolvedSelection);
    const playbackKind = resolvedSelection.video ? "video" : "audio";

    let sound: Audio.Sound | null = null;
    if (playbackKind === "audio") {
      const created = await withRetry(
        () => Audio.Sound.createAsync({ uri: mediaUrl }, { shouldPlay: false }),
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
    const latestTrack = getNextTrack(latest);
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

export const usePlayerStore = create<PlayerState>((set, get) => ({
  current: null,
  stream: null,
  streamSelection: DEFAULT_SELECTION,
  mediaUrl: null,
  playbackKind: "audio",
  isPlaying: false,
  isLoading: false,
  queue: [],
  sound: null,
  videoControls: null,

  registerVideoControls: (controls) => set({ videoControls: controls }),

  playTrack: async (track, queue = []) => {
    const generation = ++playGeneration;
    await disposeSound(get().sound);
    get().videoControls?.pause().catch(() => undefined);

    const selection = normalizeSelection(get().streamSelection, get().stream);
    const adopted = tryAdoptPrefetch(track, selection);
    if (!adopted) {
      invalidatePrefetch();
    }

    set({
      sound: null,
      mediaUrl: null,
      stream: null,
      isLoading: true,
      isPlaying: false,
      current: track,
      queue: queue.length ? queue : [track],
      streamSelection: adopted?.selection ?? selection,
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
            set({ isPlaying: status.isPlaying });
            if (status.didJustFinish) {
              void get().playNext();
            }
          });
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
      set({ isLoading: false, isPlaying: false });
      throw error;
    }
  },

  setStreamSelection: async (patch) => {
    const { current, stream, streamSelection, sound, videoControls, isPlaying } = get();
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
    const resumeSec =
      get().playbackKind === "video"
        ? (videoControls?.getPositionSec() ?? 0)
        : ((await sound?.getStatusAsync().catch(() => null))?.isLoaded
            ? ((await sound?.getStatusAsync()) as { positionMillis?: number }).positionMillis! / 1000
            : 0);

    await disposeSound(sound);
    videoControls?.pause().catch(() => undefined);

    const mediaUrl = buildMediaUrl(stream, nextSelection);
    const playbackKind = nextSelection.video ? "video" : "audio";
    set({ sound: null, mediaUrl, playbackKind, streamSelection: nextSelection, isLoading: true });

    try {
      if (playbackKind === "audio") {
        const nextSound = await loadAudioPlayback(mediaUrl, generation, set, get, isPlaying);
        if (!nextSound) return;
        if (resumeSec > 0) {
          await nextSound.setPositionAsync(resumeSec * 1000);
        }
        set({ sound: nextSound, isLoading: false, isPlaying });
      } else {
        if (resumeSec > 0) {
          await videoControls?.setPositionSec(resumeSec);
        }
        if (isPlaying) {
          await videoControls?.play();
        }
        set({ sound: null, isLoading: false, isPlaying });
      }
      schedulePrefetchNext(get);
    } catch {
      if (!isActiveGeneration(generation)) return;
      set({ isLoading: false, isPlaying: false });
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

  playNext: async () => {
    const { current, queue } = get();
    if (!current || queue.length <= 1) {
      set({ isPlaying: false });
      return;
    }

    const index = queue.findIndex((track) => track.video_id === current.video_id);
    const next = queue[index + 1];
    if (!next) {
      set({ isPlaying: false });
      return;
    }

    await get().playTrack(next, queue);
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
      queue: [],
      streamSelection: DEFAULT_SELECTION,
    });
  },
}));
