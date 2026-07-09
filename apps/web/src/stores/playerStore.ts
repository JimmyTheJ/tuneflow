import { create } from "zustand";
import { api } from "@/lib/api";
import type { Track } from "@/types";

type PlayerState = {
  current: Track | null;
  isPlaying: boolean;
  isLoading: boolean;
  queue: Track[];
  audio: HTMLAudioElement | null;
  playTrack: (track: Track, queue?: Track[]) => Promise<void>;
  togglePlayback: () => void;
  playNext: () => Promise<void>;
  stop: () => void;
};

export const usePlayerStore = create<PlayerState>((set, get) => ({
  current: null,
  isPlaying: false,
  isLoading: false,
  queue: [],
  audio: null,

  playTrack: async (track, queue = []) => {
    const { audio: existing } = get();
    if (existing) {
      existing.pause();
      existing.src = "";
    }

    set({ isLoading: true, current: track, queue: queue.length ? queue : [track] });

    try {
      const stream = await api.getStream(track.video_id);
      const audio = new Audio(stream.audio_url);
      audio.addEventListener("ended", () => void get().playNext());
      audio.addEventListener("play", () => set({ isPlaying: true }));
      audio.addEventListener("pause", () => set({ isPlaying: false }));
      await audio.play();
      set({ audio, isPlaying: true, isLoading: false });
      void api.recordPlay(track).catch(() => undefined);
    } catch (error) {
      set({ isLoading: false, isPlaying: false });
      throw error;
    }
  },

  togglePlayback: () => {
    const { audio, isPlaying } = get();
    if (!audio) return;
    if (isPlaying) audio.pause();
    else void audio.play();
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
    const { audio } = get();
    if (audio) {
      audio.pause();
      audio.src = "";
    }
    set({ audio: null, current: null, isPlaying: false, queue: [] });
  },
}));
