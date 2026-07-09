import { Audio } from "expo-av";
import { create } from "zustand";

import { api } from "@/lib/api";
import { getAccessToken, getApiUrl } from "@/lib/settings";
import type { Track } from "@/types";

type PlayerState = {
  current: Track | null;
  audioUrl: string | null;
  isPlaying: boolean;
  isLoading: boolean;
  queue: Track[];
  sound: Audio.Sound | null;
  playTrack: (track: Track, queue?: Track[]) => Promise<void>;
  togglePlayback: () => Promise<void>;
  playNext: () => Promise<void>;
  stop: () => Promise<void>;
};

async function configureAudio() {
  await Audio.setAudioModeAsync({
    playsInSilentModeIOS: true,
    staysActiveInBackground: true,
    shouldDuckAndroid: true,
  });
}

export const usePlayerStore = create<PlayerState>((set, get) => ({
  current: null,
  audioUrl: null,
  isPlaying: false,
  isLoading: false,
  queue: [],
  sound: null,

  playTrack: async (track, queue = []) => {
    const { sound: existing } = get();
    if (existing) {
      await existing.unloadAsync();
    }

    set({ isLoading: true, current: track, queue: queue.length ? queue : [track] });
    await configureAudio();

    try {
      const stream = await api.getStream(track.video_id);
      const token = getAccessToken();
      const audioUrl = `${getApiUrl()}${stream.audio_url}?token=${encodeURIComponent(token)}`;
      const { sound } = await Audio.Sound.createAsync(
        { uri: audioUrl },
        { shouldPlay: true },
      );

      sound.setOnPlaybackStatusUpdate((status) => {
        if (!status.isLoaded) {
          return;
        }
        set({ isPlaying: status.isPlaying });
        if (status.didJustFinish) {
          void get().playNext();
        }
      });

      set({ sound, audioUrl, isPlaying: true, isLoading: false });
      void api.recordPlay(track).catch(() => undefined);
    } catch (error) {
      set({ isLoading: false, isPlaying: false });
      throw error;
    }
  },

  togglePlayback: async () => {
    const { sound, isPlaying } = get();
    if (!sound) {
      return;
    }
    if (isPlaying) {
      await sound.pauseAsync();
    } else {
      await sound.playAsync();
    }
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
    const { sound } = get();
    if (sound) {
      await sound.unloadAsync();
    }
    set({ sound: null, current: null, audioUrl: null, isPlaying: false, queue: [] });
  },
}));
