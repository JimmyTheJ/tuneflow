import type { Track } from "../types";

export type ListeningProgress = Track & { session_id: string; listened_sec: number };
type Sink = {
  progress: (track: ListeningProgress) => Promise<unknown>;
  nowPlaying: (track: Track) => Promise<unknown>;
};

/** Count advancing audio time, excluding pauses, buffering and seeking. */
export class ListeningSession {
  private track: Track;
  private sink: Sink;
  private clock: () => number;
  private sessionId = crypto.randomUUID();
  private listened = 0;
  private reported = -1;
  private lastPosition = 0;
  private lastTime = 0;
  private lastNowPlaying = -Infinity;
  private media: HTMLMediaElement | null = null;
  private cleanup: (() => void) | null = null;
  private sending = Promise.resolve();

  constructor(track: Track, sink: Sink, clock = () => performance.now()) {
    this.track = track; this.sink = sink; this.clock = clock;
  }
  attach(media: HTMLMediaElement) {
    if (this.media) this.detach(this.media);
    this.media = media;
    this.lastPosition = media.currentTime; this.lastTime = this.clock();
    const sample = () => this.sample();
    const playing = () => {
      this.lastPosition = media.currentTime; this.lastTime = this.clock();
      if (this.clock() - this.lastNowPlaying >= 30_000) {
        this.lastNowPlaying = this.clock();
        void this.sink.nowPlaying(this.metadata()).catch(() => undefined);
      }
      this.flush();
    };
    const finish = () => { this.sample(); this.flush(); };
    for (const event of ["timeupdate", "seeking", "seeked", "waiting"]) media.addEventListener(event, sample);
    for (const event of ["pause", "ended"]) media.addEventListener(event, finish);
    media.addEventListener("playing", playing);
    const timer = setInterval(sample, 1000);
    const pageHide = () => { this.sample(); this.flush(); };
    window.addEventListener("pagehide", pageHide);
    this.cleanup = () => {
      clearInterval(timer);
      window.removeEventListener("pagehide", pageHide);
      for (const event of ["timeupdate", "seeking", "seeked", "waiting"]) media.removeEventListener(event, sample);
      for (const event of ["pause", "ended"]) media.removeEventListener(event, finish);
      media.removeEventListener("playing", playing);
    };
    if (!media.paused && media.readyState >= 3) playing();
  }
  private metadata(): Track {
    const duration = this.media?.duration;
    return { ...this.track, duration_sec: duration && Number.isFinite(duration) ? Math.floor(duration) : this.track.duration_sec };
  }
  sample() {
    const media = this.media;
    if (!media) return;
    const now = this.clock();
    const elapsed = Math.max(0, (now - this.lastTime) / 1000);
    const advanced = media.currentTime - this.lastPosition;
    // Pausing/ending can deliver the last small increment; a seek never counts.
    if (!media.seeking && advanced > 0 && advanced <= elapsed + 0.5) {
      this.listened += Math.min(advanced, elapsed);
    }
    this.lastTime = now; this.lastPosition = media.currentTime;
    if (Math.floor(this.listened) - this.reported >= 15) this.flush();
  }
  flush() {
    const listened = Math.floor(this.listened);
    if (listened === this.reported) return;
    const body = { ...this.metadata(), session_id: this.sessionId, listened_sec: listened };
    this.reported = listened;
    // Serialize updates; a failed request can be retried by the next sample.
    this.sending = this.sending.then(async () => {
      try { await this.sink.progress(body); }
      catch { if (this.reported === listened) this.reported = -1; }
    });
  }
  detach(media: HTMLMediaElement) {
    if (this.media !== media) return;
    this.sample(); this.flush(); this.cleanup?.(); this.cleanup = null; this.media = null;
  }
}
