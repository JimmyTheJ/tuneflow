import { ArrowLeft, Disc3, Heart, Play, Search, UserRound } from "lucide-react";
import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { LibraryGroups, LibrarySongs, LibraryViewPicker, useLibraryViewMode, type LibraryGroupItem } from "@/components/LibraryBrowse";
import { TrackThumb } from "@/components/TrackThumb";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { useLikedTracks } from "@/hooks/useLikedTracks";
import { api } from "@/lib/api";
import { libraryAlbumsForArtist, libraryQueue } from "@/lib/library";
import { usePlayerStore } from "@/stores/playerStore";
import type { LibraryAlbum, Playlist, Track } from "@/types";

function BackToLibrary({ section }: { section: "artists" | "albums" | "playlists" }) {
  const navigate = useNavigate();
  return <div className="flex items-center gap-3 text-sm">
    <Button variant="ghost" size="sm" onClick={() => navigate(-1)}><ArrowLeft className="size-4" />Back</Button>
    <Link to={`/library?view=${section}`} className="text-accent hover:underline">{section === "artists" ? "All artists" : section === "albums" ? "All albums" : "All playlists"}</Link>
  </div>;
}

export function LibraryArtistPage() {
  const { artist = "" } = useParams<{ artist: string }>();
  const [albums, setAlbums] = useState<LibraryAlbum[]>([]);
  const [tracks, setTracks] = useState<Track[]>([]);
  const [playlists, setPlaylists] = useState<Playlist[]>([]);
  const [filter, setFilter] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [albumMode, setAlbumMode] = useLibraryViewMode("albums");
  const [songMode, setSongMode] = useLibraryViewMode("songs", "list");
  const { likedVideoIds, refresh: refreshLikedTracks } = useLikedTracks();
  const playTrack = usePlayerStore((state) => state.playTrack);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);
    void Promise.all([libraryAlbumsForArtist(artist), libraryQueue({ artist }), api.listPlaylists().catch(() => [])])
      .then(([foundAlbums, foundTracks, foundPlaylists]) => {
        if (!active) return;
        setAlbums(foundAlbums);
        setTracks(foundTracks);
        setPlaylists(foundPlaylists);
      })
      .catch((cause) => { if (active) setError(cause instanceof Error ? cause.message : "Could not load artist"); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [artist]);

  const filteredAlbums = albums.filter((album) => album.title.toLocaleLowerCase().includes(filter.toLocaleLowerCase()));
  const playable = tracks.filter((track) => !track.blocked_reason);
  const albumItems: LibraryGroupItem[] = filteredAlbums.map((album) => {
    const albumTracks = playable.filter((track) => track.album_id === album.id);
    return { id: album.id, title: album.title, subtitle: `${album.track_count} songs`,
      detail: `${album.artist} · ${album.track_count} songs`, videoId: `jf_${album.item_id}`,
      href: `/library/album/${encodeURIComponent(album.id)}`,
      onPlay: albumTracks.length ? () => void playTrack(albumTracks[0], albumTracks, { queueSource: null, ordered: true }) : undefined };
  });

  return <div className="space-y-7">
    <BackToLibrary section="artists" />
    <div className="flex flex-wrap items-center gap-5 rounded-2xl bg-elevated p-5">
      {tracks[0] ? <TrackThumb videoId={tracks[0].video_id} className="size-28 rounded-xl" fallbackClassName="size-28 rounded-xl" />
        : <div className="flex size-28 items-center justify-center rounded-xl bg-highlight"><UserRound className="size-10 text-text-muted" /></div>}
      <div className="min-w-0 flex-1">
        <p className="m-0 text-xs font-bold uppercase tracking-widest text-text-muted">Library artist</p>
        <h1 className="m-0 truncate text-3xl font-bold md:text-4xl">{artist}</h1>
        <p className="mt-1 text-sm text-text-secondary">{albums.length} albums · {tracks.length} songs</p>
        <Button disabled={!playable.length} onClick={() => void playTrack(playable[0], playable, { queueSource: null, ordered: true })}>
          <Play className="size-4 fill-current" />Play all songs
        </Button>
      </div>
    </div>
    {error ? <p role="alert" className="text-danger-fg">{error}</p> : null}
    {loading ? <p role="status" className="text-text-secondary">Loading artist library…</p> : null}
    {!loading && !error ? <>
      <section className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="m-0 text-xl font-bold">Albums</h2><LibraryViewPicker mode={albumMode} onChange={setAlbumMode} />
        </div>
        {albums.length > 6 ? <div className="relative max-w-md"><Search className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-text-muted" />
          <Input value={filter} onChange={(event) => setFilter(event.target.value)} placeholder="Filter this artist's albums" aria-label="Filter albums" className="pl-10" /></div> : null}
        {filteredAlbums.length ? <LibraryGroups items={albumItems} mode={albumMode} />
          : <p className="text-text-secondary">{filter ? "No albums match your filter." : "No albums found. Songs are listed below."}</p>}
      </section>
      <section className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3"><h2 className="m-0 text-xl font-bold">All songs</h2>
          <LibraryViewPicker mode={songMode} onChange={setSongMode} /></div>
        <LibrarySongs tracks={tracks} mode={songMode} likedVideoIds={likedVideoIds} playlists={playlists}
          onLikedChange={() => void refreshLikedTracks()} onPlaylistsChange={() => void api.listPlaylists().then(setPlaylists).catch(() => undefined)} />
      </section>
    </> : null}
  </div>;
}

export function LibraryAlbumPage() {
  const { albumId = "" } = useParams<{ albumId: string }>();
  const [tracks, setTracks] = useState<Track[]>([]);
  const [playlists, setPlaylists] = useState<Playlist[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useLibraryViewMode("songs", "list");
  const { likedVideoIds, refresh: refreshLikedTracks } = useLikedTracks();
  const playTrack = usePlayerStore((state) => state.playTrack);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);
    void Promise.all([libraryQueue({ album_id: albumId }), api.listPlaylists().catch(() => [])])
      .then(([foundTracks, foundPlaylists]) => { if (active) { setTracks(foundTracks); setPlaylists(foundPlaylists); } })
      .catch((cause) => { if (active) setError(cause instanceof Error ? cause.message : "Could not load album"); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [albumId]);

  const first = tracks[0];
  const playable = tracks.filter((track) => !track.blocked_reason);
  const artist = first?.album_artist || first?.artist || "Unknown artist";
  const discs = [...new Set(tracks.map((track) => track.disc_number ?? 1))].sort((a, b) => a - b);
  const songList = (items: Track[]) => <LibrarySongs tracks={items} mode={mode} likedVideoIds={likedVideoIds} playlists={playlists}
    showTrackNumbers onLikedChange={() => void refreshLikedTracks()}
    onPlaylistsChange={() => void api.listPlaylists().then(setPlaylists).catch(() => undefined)} />;
  return <div className="space-y-7">
    <BackToLibrary section="albums" />
    <div className="flex flex-wrap items-center gap-5 rounded-2xl bg-elevated p-5">
      {first ? <TrackThumb videoId={first.video_id} className="size-28 rounded-xl" fallbackClassName="size-28 rounded-xl" />
        : <div className="flex size-28 items-center justify-center rounded-xl bg-highlight"><Disc3 className="size-10 text-text-muted" /></div>}
      <div className="min-w-0 flex-1">
        <p className="m-0 text-xs font-bold uppercase tracking-widest text-text-muted">Library album</p>
        <h1 className="m-0 truncate text-3xl font-bold md:text-4xl">{first?.album || "Album"}</h1>
        <Link to={`/library/artist/${encodeURIComponent(artist)}`} className="mt-1 block text-sm text-accent hover:underline">{artist}</Link>
        <p className="mt-1 text-sm text-text-secondary">{tracks.length} songs</p>
        <Button disabled={!playable.length} onClick={() => void playTrack(playable[0], playable, { queueSource: null, ordered: true })}>
          <Play className="size-4 fill-current" />Play album
        </Button>
      </div>
    </div>
    {error ? <p role="alert" className="text-danger-fg">{error}</p> : null}
    {loading ? <p role="status" className="text-text-secondary">Loading album…</p> : null}
    {!loading && tracks.some((track) => track.track_number == null) ? <p className="rounded-xl border border-border bg-elevated p-3 text-sm text-text-secondary">
      Sync your Jellyfin library again in <Link to="/settings" className="text-accent hover:underline">Settings</Link> to load album track order.
    </p> : null}
    {!loading && !error ? <section className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3"><h2 className="m-0 text-xl font-bold">Tracklist</h2>
        <LibraryViewPicker mode={mode} onChange={setMode} /></div>
      {tracks.length ? discs.length > 1 ? <div className="space-y-6">
        {discs.map((disc) => <div key={disc} className="space-y-2">
          <h3 className="m-0 text-sm font-semibold text-text-secondary">Disc {disc}</h3>
          {songList(tracks.filter((track) => (track.disc_number ?? 1) === disc))}
        </div>)}
      </div> : songList(tracks)
        : <p className="text-text-secondary">No songs found in this album.</p>}
    </section> : null}
  </div>;
}

export function LibraryLikedPage() {
  const [tracks, setTracks] = useState<Track[]>([]);
  const [playlists, setPlaylists] = useState<Playlist[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useLibraryViewMode("liked", "list");
  const { likedVideoIds, refresh: refreshLikedTracks } = useLikedTracks();
  const playTrack = usePlayerStore((state) => state.playTrack);
  useEffect(() => {
    let active = true;
    void Promise.all([api.listLikes(), api.listPlaylists().catch(() => [])])
      .then(([liked, foundPlaylists]) => { if (active) { setTracks(liked); setPlaylists(foundPlaylists); } })
      .catch((cause) => { if (active) setError(cause instanceof Error ? cause.message : "Could not load liked songs"); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, []);
  const refreshLikes = async () => {
    const liked = await api.listLikes();
    setTracks(liked);
    await refreshLikedTracks();
  };
  return <div className="space-y-6">
    <BackToLibrary section="playlists" />
    <div className="flex flex-wrap items-center gap-5 rounded-2xl bg-elevated p-5">
      <div className="flex size-28 items-center justify-center rounded-xl bg-accent-dim"><Heart className="size-12 text-accent" /></div>
      <div><p className="m-0 text-xs font-bold uppercase tracking-widest text-text-muted">Your library</p>
        <h1 className="m-0 text-3xl font-bold md:text-4xl">Liked Songs</h1>
        <p className="mt-1 text-sm text-text-secondary">{tracks.length} songs</p>
        <Button disabled={!tracks.length} onClick={() => void playTrack(tracks[0], tracks, { queueSource: null })}><Play className="size-4 fill-current" />Play all</Button>
      </div>
    </div>
    {error ? <p role="alert" className="text-danger-fg">{error}</p> : null}
    {loading ? <p className="text-text-secondary">Loading liked songs…</p> : null}
    {!loading && !error ? <>
      <div className="flex justify-end"><LibraryViewPicker mode={mode} onChange={setMode} /></div>
      {tracks.length ? <LibrarySongs tracks={tracks} mode={mode} likedVideoIds={likedVideoIds} playlists={playlists}
        onLikedChange={() => void refreshLikes()} onPlaylistsChange={() => void api.listPlaylists().then(setPlaylists).catch(() => undefined)} />
        : <p className="text-text-secondary">Songs you like will appear here.</p>}
    </> : null}
  </div>;
}
