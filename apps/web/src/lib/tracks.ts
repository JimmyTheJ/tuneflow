import type { Track } from "@/types";

const TOPIC_ARTIST_RE = /\s*-\s*Topic\s*$/i;
const LIVE_VERSION_RE =
  /\blive\s+(at|from|in|on)\b|[\(\[][^)\]]*\blive\b[^)\]]*[)\]]|[-–—|:]\s*live\b|\blive\s*(version|recording|performance|session)\b|\bunplugged\b/i;

const BADGE_PATTERNS: Array<{ pattern: RegExp; label: string }> = [
  { pattern: /\blive\b/i, label: "Live" },
  { pattern: /\bcover\b/i, label: "Cover" },
  { pattern: /remaster/i, label: "Remaster" },
  { pattern: /official music video|official video/i, label: "Music video" },
  { pattern: /lyric video|\blyrics\b/i, label: "Lyrics" },
  { pattern: /acoustic/i, label: "Acoustic" },
  { pattern: /instrumental/i, label: "Instrumental" },
  { pattern: /karaoke/i, label: "Karaoke" },
  { pattern: /piano/i, label: "Piano" },
  { pattern: /8d audio/i, label: "8D" },
];

export function trackDisplayTitle(track: Track): string {
  return track.source_title?.trim() || track.title;
}

export function formatTrackArtist(artist?: string | null): string {
  if (!artist) return "Unknown artist";
  return artist.replace(TOPIC_ARTIST_RE, "").trim() || artist;
}

export function isTopicUpload(artist?: string | null): boolean {
  return Boolean(artist && TOPIC_ARTIST_RE.test(artist.trim()));
}

export function looksLikeLiveVersion(title?: string | null): boolean {
  return Boolean(title && LIVE_VERSION_RE.test(title));
}

/** Search subtitle: for live uploads, emphasize the YouTube channel to tell versions apart. */
export function formatSearchSubtitle(track: Track): string {
  const channel = formatTrackArtist(track.artist);
  if (looksLikeLiveVersion(trackDisplayTitle(track))) {
    return channel === "Unknown artist" ? channel : `via ${channel}`;
  }
  return channel;
}

export function extractTrackBadges(title: string, artist?: string | null): string[] {
  const badges: string[] = [];
  if (isTopicUpload(artist)) {
    badges.push("Official");
  }

  for (const { pattern, label } of BADGE_PATTERNS) {
    if (pattern.test(title) && !badges.includes(label)) {
      badges.push(label);
    }
  }

  return badges.slice(0, 3);
}

export function trackDetailLine(track: Track): string | null {
  const description = track.short_description?.trim();
  if (!description) return null;

  const displayTitle = trackDisplayTitle(track).toLowerCase();
  if (description.toLowerCase() === displayTitle) return null;

  return description;
}
