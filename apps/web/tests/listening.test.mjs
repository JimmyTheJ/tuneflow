import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ListeningSession } from '../src/lib/listening.ts';

globalThis.window = new EventTarget();
class Media extends EventTarget {
  currentTime = 0; duration = 200; paused = true; seeking = false; readyState = 4;
}
const settle = () => new Promise(resolve => setImmediate(resolve));
test('progress counts playback, excludes seeks/pauses, and keeps one session across stream changes', async () => {
  let now = 0; const reports = []; const nowPlaying = [];
  const session = new ListeningSession({ video_id: 'jf_song', title: 'Song', artist: 'Artist' }, {
    progress: async body => { reports.push(body); }, nowPlaying: async body => { nowPlaying.push(body); },
  }, () => now);
  const media = new Media(); session.attach(media);
  media.paused = false; media.dispatchEvent(new Event('playing')); await settle();
  assert.equal(reports[0].listened_sec, 0); assert.equal(nowPlaying.length, 1);
  const advance = seconds => { now += seconds * 1000; media.currentTime += seconds; session.sample(); };
  advance(15); await settle(); assert.equal(reports.at(-1).listened_sec, 15);
  media.paused = true; now += 100_000; session.sample(); session.flush(); await settle();
  assert.equal(reports.at(-1).listened_sec, 15);
  media.seeking = true; media.currentTime = 180; session.sample(); media.seeking = false;
  media.paused = false; media.dispatchEvent(new Event('playing')); advance(5);
  session.detach(media); await settle(); assert.equal(reports.at(-1).listened_sec, 20);
  const other = new Media(); other.currentTime = 185; session.attach(other);
  other.paused = false; other.dispatchEvent(new Event('playing')); now += 10_000; other.currentTime += 10; session.sample();
  session.detach(other); await settle();
  assert.equal(reports.at(-1).listened_sec, 30);
  assert.equal(new Set(reports.map(r => r.session_id)).size, 1);
  assert.equal(reports.at(-1).duration_sec, 200);
});
test('failed progress is retried with cumulative time and pagehide flushes the final increment', async () => {
  let now = 0, attempts = 0; const reports = [];
  const session = new ListeningSession({ video_id: 'id', title: 'Song' }, {
    progress: async body => { if (++attempts === 1) throw Error('offline'); reports.push(body); }, nowPlaying: async () => {},
  }, () => now);
  const media = new Media(); session.attach(media); media.paused = false; media.dispatchEvent(new Event('playing')); await settle();
  now = 15_000; media.currentTime = 15; session.sample(); await settle(); assert.equal(reports.at(-1).listened_sec, 15);
  now = 18_000; media.currentTime = 18; window.dispatchEvent(new Event('pagehide')); await settle();
  assert.equal(reports.at(-1).listened_sec, 18); session.detach(media);
});
