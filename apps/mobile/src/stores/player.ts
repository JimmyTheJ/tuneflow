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

let playGeneration = 0;

function isActiveGeneration(generation: number): boolean {
  return generation === playGeneration;
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

export const usePlayerStore = create<PlayerState>((set, get) => ({
  current: null,
  audioUrl: null,
  isPlaying: false,
  isLoading: false,
  queue: [],
  sound: null,

  playTrack: async (track, queue = []) => {
    const generation = ++playGeneration;

    await disposeSound(get().sound);

    set({
      sound: null,
      audioUrl: null,
      isLoading: true,
      isPlaying: false,
      current: track,
      queue: queue.length ? queue : [track],
    });

    await configureAudio();

    let pendingSound: Audio.Sound | null = null;

    try {
      const stream = await api.getStream(track.video_id);
      if (!isActiveGeneration(generation)) return;

      const token = getAccessToken();
      const audioUrl = `${getApiUrl()}${stream.audio_url}?token=${encodeURIComponent(token)}`;
      const { sound } = await Audio.Sound.createAsync({ uri: audioUrl }, { shouldPlay: true });
      pendingSound = sound;

      if (!isActiveGeneration(generation)) {
        await disposeSound(pendingSound);
        return;
      }

      sound.setOnPlaybackStatusUpdate((status) => {
        if (!isActiveGeneration(generation)) return;
        if (!status.isLoaded) return;

        set({ isPlaying: status.isPlaying });
        if (status.didJustFinish) {
          void get().playNext();
        }
      });

      set({ sound, audioUrl, isPlaying: true, isLoading: false });
      pendingSound = null;
      void api.recordPlay(track).catch(() => undefined);
    } catch (error) {
      if (pendingSound) await disposeSound(pendingSound);
      if (!isActiveGeneration(generation)) return;

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
    playGeneration += 1;
    await disposeSound(get().sound);
    set({ sound: null, current: null, audioUrl: null, isPlaying: false, isLoading: false, queue: [] });
  },
}));
