import { Audio } from "expo-av";
import { create } from "zustand";

import { api } from "@/lib/api";
import { getAccessToken, getApiUrl } from "@/lib/settings";
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
  const { sound } = await Audio.Sound.createAsync({ uri: mediaUrl }, { shouldPlay: autoplay });
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
    set({
      sound: null,
      mediaUrl: null,
      stream: null,
      isLoading: true,
      isPlaying: false,
      current: track,
      queue: queue.length ? queue : [track],
      streamSelection: selection,
    });

    await configureAudio();

    try {
      const stream = await api.getStream(track.video_id);
      if (!isActiveGeneration(generation)) return;

      const resolvedSelection = normalizeSelection(selection, stream);
      const mediaUrl = buildMediaUrl(stream, resolvedSelection);
      const playbackKind = resolvedSelection.video ? "video" : "audio";

      if (playbackKind === "audio") {
        const sound = await loadAudioPlayback(mediaUrl, generation, set, get, true);
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
