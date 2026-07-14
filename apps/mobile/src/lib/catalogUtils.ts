import type { AlbumDetail, ArtistDetail, CatalogTrack, ReleaseSummary, Track } from "@/types";

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

function releaseSortKey(a: ReleaseSummary, b: ReleaseSummary): number {
  const dateA = a.release_date ?? "0000";
  const dateB = b.release_date ?? "0000";
  if (dateA !== dateB) return dateB.localeCompare(dateA);
  return a.title.localeCompare(b.title);
}

export function mergeArtistDiscography(
  artist: ArtistDetail,
  chunk: Pick<ArtistDetail, "albums" | "eps" | "singles">,
): ArtistDetail {
  const merge = (current: ReleaseSummary[], incoming: ReleaseSummary[]) =>
    [...current, ...incoming].sort(releaseSortKey);
  const albums = merge(artist.albums, chunk.albums);
  const eps = merge(artist.eps, chunk.eps);
  const image_url = artist.image_url ?? albums[0]?.cover_url ?? eps[0]?.cover_url ?? null;
  return {
    ...artist,
    albums,
    eps,
    singles: merge(artist.singles, chunk.singles),
    image_url,
  };
}
