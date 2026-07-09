import { create } from "zustand";
import { api } from "@/lib/api";
import { getAccessToken, getApiUrl } from "@/lib/settings";
import type { Track } from "@/types";

type PlayerState = {
  current: Track | null;
  isPlaying: boolean;
  isLoading: boolean;
  positionSec: number;
  durationSec: number;
  queue: Track[];
  audio: HTMLAudioElement | null;
  error: string | null;
  playTrack: (track: Track, queue?: Track[]) => Promise<void>;
  togglePlayback: () => void;
  playPrevious: () => Promise<void>;
  playNext: () => Promise<void>;
  seek: (seconds: number) => void;
  stop: () => void;
  clearError: () => void;
};

let playGeneration = 0;

function isActiveGeneration(generation: number): boolean {
  return generation === playGeneration;
}

function disposeAudio(audio: HTMLAudioElement | null): void {
  if (!audio) return;
  audio.pause();
  audio.removeAttribute("src");
  audio.load();
}

function syncProgress(audio: HTMLAudioElement, track: Track) {
  const duration = Number.isFinite(audio.duration) ? audio.duration : (track.duration_sec ?? 0);
  return {
    positionSec: audio.currentTime || 0,
    durationSec: duration > 0 ? duration : (track.duration_sec ?? 0),
  };
}

function attachAudioListeners(
  audio: HTMLAudioElement,
  track: Track,
  generation: number,
  set: (partial: Partial<PlayerState>) => void,
  get: () => PlayerState,
) {
  const shouldHandle = () => isActiveGeneration(generation);

  const updateProgress = () => {
    if (!shouldHandle()) return;
    set(syncProgress(audio, track));
  };

  audio.addEventListener("loadedmetadata", updateProgress);
  audio.addEventListener("durationchange", updateProgress);
  audio.addEventListener("timeupdate", updateProgress);
  audio.addEventListener("ended", () => {
    if (!shouldHandle()) return;
    void get().playNext();
  });
  audio.addEventListener("play", () => {
    if (!shouldHandle()) return;
    set({ isPlaying: true });
  });
  audio.addEventListener("pause", () => {
    if (!shouldHandle()) return;
    set({ isPlaying: false });
  });
  audio.addEventListener("error", () => {
    if (!shouldHandle()) return;
    set({ isLoading: false, isPlaying: false, error: "Playback failed — try another track" });
  });
}

export const usePlayerStore = create<PlayerState>((set, get) => ({
  current: null,
  isPlaying: false,
  isLoading: false,
  positionSec: 0,
  durationSec: 0,
  queue: [],
  audio: null,
  error: null,

  clearError: () => set({ error: null }),

  playTrack: async (track, queue = []) => {
    const generation = ++playGeneration;

    disposeAudio(get().audio);

    const nextQueue = queue.length ? queue : [track];
    set({
      audio: null,
      isLoading: true,
      isPlaying: false,
      current: track,
      queue: nextQueue,
      error: null,
      positionSec: 0,
      durationSec: track.duration_sec ?? 0,
    });

    let pendingAudio: HTMLAudioElement | null = null;

    try {
      const stream = await api.getStream(track.video_id);
      if (!isActiveGeneration(generation)) return;

      const token = getAccessToken();
      const audioUrl = `${getApiUrl()}${stream.audio_url}?token=${encodeURIComponent(token)}`;
      pendingAudio = new Audio(audioUrl);
      attachAudioListeners(pendingAudio, track, generation, set, get);

      await pendingAudio.play();
      if (!isActiveGeneration(generation)) {
        disposeAudio(pendingAudio);
        return;
      }

      set({
        audio: pendingAudio,
        isPlaying: true,
        isLoading: false,
        ...syncProgress(pendingAudio, track),
      });
      pendingAudio = null;
      void api.recordPlay(track).catch(() => undefined);
    } catch (error) {
      if (pendingAudio) disposeAudio(pendingAudio);
      if (!isActiveGeneration(generation)) return;

      const message = error instanceof Error ? error.message : "Playback failed";
      set({ isLoading: false, isPlaying: false, error: message });
    }
  },

  togglePlayback: () => {
    const { audio, isPlaying } = get();
    if (!audio) return;
    if (isPlaying) audio.pause();
    else void audio.play();
  },

  seek: (seconds: number) => {
    const { audio, durationSec, current } = get();
    if (!audio || !current) return;

    const max = durationSec || audio.duration || 0;
    const clamped = max > 0 ? Math.max(0, Math.min(seconds, max)) : Math.max(0, seconds);
    audio.currentTime = clamped;
    set({ positionSec: clamped });
  },

  playPrevious: async () => {
    const { current, queue, audio, positionSec } = get();
    if (!current) return;

    if (audio && positionSec > 3) {
      audio.currentTime = 0;
      set({ positionSec: 0 });
      return;
    }

    if (queue.length <= 1) {
      if (audio) {
        audio.currentTime = 0;
        set({ positionSec: 0 });
      }
      return;
    }

    const index = queue.findIndex((t) => t.video_id === current.video_id);
    const previous = queue[index - 1];
    if (!previous) {
      if (audio) {
        audio.currentTime = 0;
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
    disposeAudio(get().audio);
    set({
      audio: null,
      current: null,
      isPlaying: false,
      isLoading: false,
      positionSec: 0,
      durationSec: 0,
      queue: [],
    });
  },
}));
