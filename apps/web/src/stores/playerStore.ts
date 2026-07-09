import { create } from "zustand";
import { api } from "@/lib/api";
import { getAccessToken, getApiUrl } from "@/lib/settings";
import type { Track } from "@/types";

type PlayerState = {
  current: Track | null;
  isPlaying: boolean;
  isLoading: boolean;
  queue: Track[];
  audio: HTMLAudioElement | null;
  error: string | null;
  playTrack: (track: Track, queue?: Track[]) => Promise<void>;
  togglePlayback: () => void;
  playNext: () => Promise<void>;
  stop: () => void;
  clearError: () => void;
};

export const usePlayerStore = create<PlayerState>((set, get) => ({
  current: null,
  isPlaying: false,
  isLoading: false,
  queue: [],
  audio: null,
  error: null,

  clearError: () => set({ error: null }),

  playTrack: async (track, queue = []) => {
    const { audio: existing } = get();
    if (existing) {
      existing.pause();
      existing.src = "";
    }

    set({ isLoading: true, current: track, queue: queue.length ? queue : [track], error: null });

    try {
      const stream = await api.getStream(track.video_id);
      const token = getAccessToken();
      const audioUrl = `${getApiUrl()}${stream.audio_url}?token=${encodeURIComponent(token)}`;
      const audio = new Audio(audioUrl);
      audio.addEventListener("ended", () => void get().playNext());
      audio.addEventListener("play", () => set({ isPlaying: true }));
      audio.addEventListener("pause", () => set({ isPlaying: false }));
      audio.addEventListener("error", () => {
        set({ isLoading: false, isPlaying: false, error: "Playback failed — try another track" });
      });
      await audio.play();
      set({ audio, isPlaying: true, isLoading: false });
      void api.recordPlay(track).catch(() => undefined);
    } catch (error) {
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
