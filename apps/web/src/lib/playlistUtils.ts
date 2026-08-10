import { ApiError } from "@/lib/retry";
import type { Playlist, PlaylistTrack, Track } from "@/types";

export function filterPlaylists(playlists: Playlist[], query: string): Playlist[] {
  const normalized = query.trim().toLowerCase();
  if (!normalized) return playlists;
  return playlists.filter((playlist) => playlist.name.toLowerCase().includes(normalized));
}

export function suggestedPlaylistName(existingCount: number): string {
  return `Playlist ${existingCount + 1}`;
}

export function isPlayablePlaylistTrack(
  track: PlaylistTrack,
): track is PlaylistTrack & { video_id: string } {
  return Boolean(track.video_id) && (track.match_status ?? "matched") !== "unmatched";
}

export function playablePlaylistTracks(tracks: PlaylistTrack[]): Track[] {
  return tracks.filter(isPlayablePlaylistTrack).map((track) => ({
    video_id: track.video_id,
    title: track.title,
    artist: track.artist,
    thumbnail_url: track.thumbnail_url,
    duration_sec: track.duration_sec,
  }));
}

export function asTrackRow(track: PlaylistTrack): Track {
  return {
    video_id: track.video_id || `unmatched-${track.id}`,
    title: track.title,
    artist: track.artist,
    thumbnail_url: track.thumbnail_url,
    duration_sec: track.duration_sec,
  };
}

export type BulkAddResult = {
  added: number;
  skipped: number;
};

export async function addTracksToPlaylist(
  playlistId: number,
  tracks: Track[],
  addTrack: (playlistId: number, track: Track) => Promise<unknown>,
): Promise<BulkAddResult> {
  let added = 0;
  let skipped = 0;

  for (const track of tracks) {
    try {
      await addTrack(playlistId, track);
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) {
        skipped += 1;
        continue;
      }
      throw err;
    }
  }

  return { added, skipped };
}

export function formatBulkAddMessage(playlistName: string, result: BulkAddResult): string {
  const { added, skipped } = result;
  if (added === 0 && skipped > 0) {
    return `All tracks already in ${playlistName}`;
  }
  if (skipped > 0) {
    return `Added ${added} to ${playlistName} (${skipped} already there)`;
  }
  if (added === 1) {
    return `Added to ${playlistName}`;
  }
  return `Added ${added} tracks to ${playlistName}`;
}
