import TrackPlayer, { Event } from "react-native-track-player";

/**
 * Runs in TrackPlayer's background/headless context on Android.
 * Keep this lean: prefer TrackPlayer APIs, and only reach into the app store
 * for queue navigation (process stays alive via the media foreground service).
 */
export async function playbackService(): Promise<void> {
  TrackPlayer.addEventListener(Event.RemotePlay, () => {
    void TrackPlayer.play();
  });

  TrackPlayer.addEventListener(Event.RemotePause, () => {
    void TrackPlayer.pause();
  });

  TrackPlayer.addEventListener(Event.RemoteStop, () => {
    void import("@/stores/player").then(({ usePlayerStore }) => {
      void usePlayerStore.getState().stop();
    });
  });

  TrackPlayer.addEventListener(Event.RemoteNext, () => {
    void import("@/stores/player").then(({ usePlayerStore }) => {
      void usePlayerStore.getState().playNext();
    });
  });

  TrackPlayer.addEventListener(Event.RemotePrevious, () => {
    void import("@/stores/player").then(({ usePlayerStore }) => {
      void usePlayerStore.getState().playPrevious();
    });
  });

  TrackPlayer.addEventListener(Event.RemoteSeek, (event) => {
    void TrackPlayer.seekTo(event.position);
  });

  TrackPlayer.addEventListener(Event.RemoteDuck, (event) => {
    // Transient ducks (notifications, nav prompts) should not leave us paused.
    // Permanent loss of audio focus still pauses.
    if (event.permanent) {
      void TrackPlayer.pause();
    }
  });
}
