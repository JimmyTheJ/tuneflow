import type { Track } from "@/types";

const TOPIC_ARTIST_RE = /\s*-\s*Topic\s*$/i;

const BADGE_PATTERNS: Array<{ pattern: RegExp; label: string }> = [
  { pattern: /\blive\b/i, label: "Live" },
  { pattern: /\bcover\b/i, label: "Cover" },
  { pattern: /remaster/i, label: "Remaster" },
  { pattern: /official music video|official video/i, label: "Music video" },
  { pattern: /lyric video|\blyrics\b/i, label: "Lyrics" },
  { pattern: /acoustic/i, label: "Acoustic" },
  { pattern: /instrumental/i, label: "Instrumental" },
  { pattern: /karaoke/i, label: "Karaoke" },
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
