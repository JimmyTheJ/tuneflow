import { PermissionsAndroid, Platform } from "react-native";
import TrackPlayer, {
  AppKilledPlaybackBehavior,
  Capability,
  Event,
  IOSCategory,
  IOSCategoryMode,
  State,
  type AddTrack,
} from "react-native-track-player";

import type { Track } from "@/types";
import { trackThumbnailUrl } from "@/lib/thumbnails";

let setupPromise: Promise<void> | null = null;
let listenersAttached = false;

export type AudioEngineHandlers = {
  onProgress: (positionSec: number, durationSec: number) => void;
  onPlayingChange: (isPlaying: boolean) => void;
  onTrackEnded: () => void;
  onError: (message: string) => void;
};

function artworkFor(track: Track): string {
  return track.thumbnail_url || trackThumbnailUrl(track.video_id);
}

export function toPlayerTrack(track: Track, url: string): AddTrack {
  return {
    id: track.video_id,
    url,
    title: track.title,
    artist: track.artist ?? "Unknown artist",
    artwork: artworkFor(track),
    duration: track.duration_sec ?? undefined,
  };
}

async function ensureNotificationPermission(): Promise<void> {
  if (Platform.OS !== "android" || Platform.Version < 33) return;
  try {
    const status = await PermissionsAndroid.request(
      PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS,
    );
    if (status !== PermissionsAndroid.RESULTS.GRANTED) {
      console.warn("Notification permission denied; background playback may be limited");
    }
  } catch {
    /* ignore */
  }
}

export async function ensureTrackPlayerSetup(): Promise<void> {
  if (!setupPromise) {
    setupPromise = (async () => {
      await ensureNotificationPermission();
      try {
        await TrackPlayer.setupPlayer({
          autoHandleInterruptions: true,
          iosCategory: IOSCategory.Playback,
          iosCategoryMode: IOSCategoryMode.Default,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        // setupPlayer throws if already initialized
        if (!message.toLowerCase().includes("already")) {
          setupPromise = null;
          throw error;
        }
      }

      await TrackPlayer.updateOptions({
        android: {
          appKilledPlaybackBehavior: AppKilledPlaybackBehavior.ContinuePlayback,
          alwaysPauseOnInterruption: true,
        },
        capabilities: [
          Capability.Play,
          Capability.Pause,
          Capability.Stop,
          Capability.SeekTo,
          Capability.SkipToNext,
          Capability.SkipToPrevious,
        ],
        compactCapabilities: [Capability.Play, Capability.Pause, Capability.SkipToNext],
        notificationCapabilities: [
          Capability.Play,
          Capability.Pause,
          Capability.SkipToNext,
          Capability.SkipToPrevious,
          Capability.SeekTo,
        ],
        progressUpdateEventInterval: 1,
      });
    })();
  }

  await setupPromise;
}

export function attachAudioEngineListeners(handlers: AudioEngineHandlers): () => void {
  if (listenersAttached) {
    return () => undefined;
  }
  listenersAttached = true;

  const progressSub = TrackPlayer.addEventListener(Event.PlaybackProgressUpdated, (event) => {
    handlers.onProgress(event.position, event.duration);
  });

  const stateSub = TrackPlayer.addEventListener(Event.PlaybackState, (event) => {
    const state = event.state;
    if (state === State.Playing) {
      handlers.onPlayingChange(true);
      return;
    }
    if (
      state === State.Paused ||
      state === State.Stopped ||
      state === State.Ready ||
      state === State.None ||
      state === State.Ended
    ) {
      handlers.onPlayingChange(false);
    }
  });

  const endedSub = TrackPlayer.addEventListener(Event.PlaybackQueueEnded, () => {
    handlers.onTrackEnded();
  });

  const errorSub = TrackPlayer.addEventListener(Event.PlaybackError, (event) => {
    handlers.onError(event.message || "Playback failed");
  });

  return () => {
    progressSub.remove();
    stateSub.remove();
    endedSub.remove();
    errorSub.remove();
    listenersAttached = false;
  };
}

export async function loadAndPlayTrack(
  track: Track,
  url: string,
  options: { autoplay: boolean; volume: number; positionSec?: number },
): Promise<void> {
  await ensureTrackPlayerSetup();
  await TrackPlayer.reset();
  await TrackPlayer.add(toPlayerTrack(track, url));
  await TrackPlayer.setVolume(options.volume);
  if (options.positionSec && options.positionSec > 0) {
    await TrackPlayer.seekTo(options.positionSec);
  }
  if (options.autoplay) {
    await TrackPlayer.play();
  }
}

export async function stopAudioEngine(): Promise<void> {
  try {
    await TrackPlayer.reset();
  } catch {
    /* player may not be ready */
  }
}

export async function pauseAudioEngine(): Promise<void> {
  await TrackPlayer.pause();
}

export async function resumeAudioEngine(): Promise<void> {
  await TrackPlayer.play();
}

export async function seekAudioEngine(seconds: number): Promise<void> {
  await TrackPlayer.seekTo(seconds);
}

export async function setAudioEngineVolume(volume: number): Promise<void> {
  await TrackPlayer.setVolume(volume);
}
