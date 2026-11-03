import { api, type LibraryQuery } from "@/lib/api";
import type { LibraryAlbum, Track } from "@/types";

const PAGE_SIZE = 500;

/** Fetch a complete artist or album queue in the order supplied by the library API. */
export async function libraryQueue(query: Pick<LibraryQuery, "artist" | "album_id">): Promise<Track[]> {
  const tracks: Track[] = [];
  for (let offset = 0; offset <= 1_000_000; offset += PAGE_SIZE) {
    const page = await api.libraryTracks({ ...query, limit: PAGE_SIZE, offset });
    tracks.push(...page);
    if (page.length < PAGE_SIZE) return tracks;
  }
  throw new Error("Library queue is too large to load");
}

export async function libraryAlbumsForArtist(artist: string): Promise<LibraryAlbum[]> {
  const albums: LibraryAlbum[] = [];
  for (let offset = 0; offset <= 1_000_000; offset += PAGE_SIZE) {
    const page = await api.libraryAlbums({ artist, limit: PAGE_SIZE, offset });
    albums.push(...page);
    if (page.length < PAGE_SIZE) return albums;
  }
  throw new Error("Artist has too many albums to load");
}
