import type { AlbumDetail, CatalogTrack, Track } from "@/types";

export function catalogTrackToPlayable(
  track: CatalogTrack,
  artistName: string,
): Track | null {
  if (!track.video_id || track.blocked_reason) return null;
  return {
    video_id: track.video_id,
    title: track.title,
    artist: track.artist_name ?? artistName,
    thumbnail_url: track.thumbnail_url,
    duration_sec: track.duration_sec,
    blocked_reason: track.blocked_reason,
  };
}

export function albumPlayableTracks(album: AlbumDetail): Track[] {
  return album.tracks
    .map((track) => catalogTrackToPlayable(track, album.artist_name))
    .filter((track): track is Track => track !== null);
}

export function formatReleaseYear(releaseDate: string | null | undefined): string | undefined {
  if (!releaseDate) return undefined;
  return releaseDate.slice(0, 4);
}
