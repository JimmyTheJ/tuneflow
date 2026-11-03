import { Disc3, Download, ListMusic, Music2, Plus, Search, UserRound } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { CreatePlaylistDialog } from "@/components/CreatePlaylistDialog";
import { ImportPlaylistWizard } from "@/components/ImportPlaylistWizard";
import { LibraryGroups, LibrarySongs, LibraryViewPicker, useLibraryViewMode, type LibraryGroupItem } from "@/components/LibraryBrowse";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { MediaCardSkeleton } from "@/components/ui/Skeleton";
import { useLikedTracks } from "@/hooks/useLikedTracks";
import { api } from "@/lib/api";
import { libraryQueue } from "@/lib/library";
import { filterPlaylists, suggestedPlaylistName } from "@/lib/playlistUtils";
import { usePlayerStore } from "@/stores/playerStore";
import type { LibraryAlbum, LibraryArtist, LikeEntry, Playlist, Track } from "@/types";

type Tab = "artists" | "albums" | "songs" | "playlists";
const PAGE_SIZE = 60;
const tabs = [
  { id: "artists" as const, label: "Artists", icon: UserRound },
  { id: "albums" as const, label: "Albums", icon: Disc3 },
  { id: "songs" as const, label: "Songs", icon: Music2 },
  { id: "playlists" as const, label: "Playlists", icon: ListMusic },
];

export function LibraryPage() {
  const [params, setParams] = useSearchParams();
  const tab: Tab = tabs.find((entry) => entry.id === params.get("view"))?.id ?? "artists";
  const [search, setSearch] = useState("");
  const [query, setQuery] = useState("");
  const [artists, setArtists] = useState<LibraryArtist[]>([]);
  const [albums, setAlbums] = useState<LibraryAlbum[]>([]);
  const [songs, setSongs] = useState<Track[]>([]);
  const [playlists, setPlaylists] = useState<Playlist[]>([]);
  const [householdPlaylists, setHouseholdPlaylists] = useState<Playlist[]>([]);
  const [likes, setLikes] = useState<LikeEntry[]>([]);
  const [linked, setLinked] = useState<boolean | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [playlistError, setPlaylistError] = useState<string | null>(null);
  const [playingGroup, setPlayingGroup] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [createBusy, setCreateBusy] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const requestVersion = useRef(0);
  const [artistMode, setArtistMode] = useLibraryViewMode("artists");
  const [albumMode, setAlbumMode] = useLibraryViewMode("albums");
  const [songMode, setSongMode] = useLibraryViewMode("songs", "list");
  const [playlistMode, setPlaylistMode] = useLibraryViewMode("playlists");
  const { likedVideoIds, refresh: refreshLikedTracks } = useLikedTracks();
  const playTrack = usePlayerStore((state) => state.playTrack);

  const loadPlaylists = useCallback(async () => {
    try {
      const [mine, household, liked] = await Promise.all([
        api.listPlaylists("mine"), api.listPlaylists("household"), api.listLikes(),
      ]);
      setPlaylists(mine);
      setHouseholdPlaylists(household);
      setLikes(liked);
      setPlaylistError(null);
    } catch (cause) {
      setPlaylistError(cause instanceof Error ? cause.message : "Could not load playlists");
    }
  }, []);

  useEffect(() => {
    void loadPlaylists();
    void api.jellyfinStatus().then((status) => setLinked(status.linked)).catch(() => setLinked(null));
  }, [loadPlaylists]);

  useEffect(() => {
    const timer = window.setTimeout(() => setQuery(search.trim()), 250);
    return () => window.clearTimeout(timer);
  }, [search]);

  useEffect(() => {
    if (tab === "playlists") {
      setLoading(false);
      setLoadingMore(false);
      setHasMore(false);
      setError(null);
      return;
    }
    const version = ++requestVersion.current;
    setLoading(true);
    setLoadingMore(false);
    setError(null);
    setHasMore(false);
    setArtists([]);
    setAlbums([]);
    setSongs([]);
    const load = async () => {
      try {
        const options = { q: query, limit: PAGE_SIZE };
        if (tab === "artists") {
          const page = await api.libraryArtists(options);
          if (version === requestVersion.current) { setArtists(page); setHasMore(page.length === PAGE_SIZE); }
        } else if (tab === "albums") {
          const page = await api.libraryAlbums(options);
          if (version === requestVersion.current) { setAlbums(page); setHasMore(page.length === PAGE_SIZE); }
        } else {
          const page = await api.libraryTracks(options);
          if (version === requestVersion.current) { setSongs(page); setHasMore(page.length === PAGE_SIZE); }
        }
      } catch (cause) {
        if (version === requestVersion.current) setError(cause instanceof Error ? cause.message : "Could not load library");
      } finally {
        if (version === requestVersion.current) setLoading(false);
      }
    };
    void load();
    return () => { requestVersion.current += 1; };
  }, [tab, query]);

  const loadMore = async () => {
    if (!hasMore || loadingMore) return;
    const version = requestVersion.current;
    setLoadingMore(true);
    setError(null);
    try {
      const options = { q: query, limit: PAGE_SIZE };
      if (tab === "artists") {
        const page = await api.libraryArtists({ ...options, offset: artists.length });
        if (version === requestVersion.current) { setArtists((current) => [...current, ...page]); setHasMore(page.length === PAGE_SIZE); }
      } else if (tab === "albums") {
        const page = await api.libraryAlbums({ ...options, offset: albums.length });
        if (version === requestVersion.current) { setAlbums((current) => [...current, ...page]); setHasMore(page.length === PAGE_SIZE); }
      } else if (tab === "songs") {
        const page = await api.libraryTracks({ ...options, offset: songs.length });
        if (version === requestVersion.current) { setSongs((current) => [...current, ...page]); setHasMore(page.length === PAGE_SIZE); }
      }
    } catch (cause) {
      if (version === requestVersion.current) setError(cause instanceof Error ? cause.message : "Could not load more");
    } finally {
      if (version === requestVersion.current) setLoadingMore(false);
    }
  };

  const playGroup = async (selection: { artist?: string; album_id?: string }) => {
    if (playingGroup) return;
    setPlayingGroup(true);
    setError(null);
    try {
      const queue = (await libraryQueue(selection)).filter((track) => !track.blocked_reason);
      if (queue.length === 0) throw new Error("No playable songs in this selection");
      await playTrack(queue[0], queue, { queueSource: null, ordered: true });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not start playback");
    } finally {
      setPlayingGroup(false);
    }
  };

  const artistItems: LibraryGroupItem[] = artists.map((artist) => ({
    id: artist.id, title: artist.name, subtitle: `${artist.album_count} albums · ${artist.track_count} songs`,
    detail: `${artist.album_count} albums · ${artist.track_count} songs`, videoId: `jf_${artist.item_id}`,
    href: `/library/artist/${encodeURIComponent(artist.id)}`,
    onPlay: () => void playGroup({ artist: artist.id }),
  }));
  const albumItems: LibraryGroupItem[] = albums.map((album) => ({
    id: album.id, title: album.title, subtitle: album.artist,
    detail: `${album.artist} · ${album.track_count} songs`, videoId: `jf_${album.item_id}`,
    href: `/library/album/${encodeURIComponent(album.id)}`,
    onPlay: () => void playGroup({ album_id: album.id }),
  }));
  const playlistItems: LibraryGroupItem[] = [
    ...("liked songs".includes(search.toLocaleLowerCase()) ? [{ id: "liked", title: "Liked Songs", subtitle: `${likes.length} songs`, detail: `${likes.length} songs`, href: "/library/liked", onPlay: likes.length ? () => void playTrack(likes[0], likes, { queueSource: null }) : undefined }] : []),
    ...filterPlaylists(playlists, search).map((playlist) => ({ id: String(playlist.id), title: playlist.name, subtitle: `${playlist.track_count} songs`, detail: `${playlist.track_count} songs`, href: `/playlist/${playlist.id}` })),
    ...filterPlaylists(householdPlaylists, search).filter((playlist) => !playlists.some((mine) => mine.id === playlist.id)).map((playlist) => ({ id: `household-${playlist.id}`, title: playlist.name, subtitle: `${playlist.track_count} songs · Household`, detail: `${playlist.track_count} songs · ${playlist.owner_display_name ?? "Household"}`, href: `/playlist/${playlist.id}` })),
  ];
  const view = tab === "artists" ? artistMode : tab === "albums" ? albumMode : tab === "songs" ? songMode : playlistMode;
  const setView = tab === "artists" ? setArtistMode : tab === "albums" ? setAlbumMode : tab === "songs" ? setSongMode : setPlaylistMode;
  const count = tab === "artists" ? artists.length : tab === "albums" ? albums.length : tab === "songs" ? songs.length : playlistItems.length;

  const createPlaylist = async (name: string) => {
    setCreateBusy(true);
    setCreateError(null);
    try {
      await api.createPlaylist(name);
      setCreateOpen(false);
      await loadPlaylists();
    } catch (cause) {
      setCreateError(cause instanceof Error ? cause.message : "Could not create playlist");
    } finally {
      setCreateBusy(false);
    }
  };

  return <div className="space-y-6">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div><h1 className="m-0 text-3xl font-bold tracking-tight md:text-4xl">Your library</h1>
        <p className="mt-1 mb-0 text-sm text-text-secondary">Browse your Jellyfin music by artist, album, or song.</p></div>
      {tab === "playlists" ? <div className="flex gap-2">
        <Button variant="secondary" size="sm" onClick={() => setImportOpen(true)}><Download className="size-4" />Import</Button>
        <Button variant="secondary" size="sm" onClick={() => setCreateOpen(true)}><Plus className="size-4" />New playlist</Button>
      </div> : null}
    </div>
    <nav className="flex flex-wrap gap-2" aria-label="Library sections">
      {tabs.map(({ id, label, icon: Icon }) => <button key={id} type="button" aria-current={tab === id ? "page" : undefined}
        className={`inline-flex items-center gap-2 rounded-full px-4 py-2 text-sm font-semibold ${tab === id ? "bg-accent text-accent-fg" : "bg-elevated text-text-secondary hover:bg-highlight hover:text-text"}`}
        onClick={() => { setSearch(""); setQuery(""); setParams({ view: id }); }}><Icon className="size-4" />{label}</button>)}
    </nav>
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div className="relative w-full max-w-md">
        <Search className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-text-muted" />
        <Input value={search} onChange={(event) => setSearch(event.target.value)}
          placeholder={`Search ${tab}`} aria-label={`Search ${tab}`} className="pl-10" />
      </div>
      <LibraryViewPicker mode={view} onChange={setView} />
    </div>
    {error ? <p role="alert" className="text-danger-fg">{error}</p> : null}
    {tab === "playlists" && playlistError ? <p role="alert" className="text-danger-fg">{playlistError}</p> : null}
    {playingGroup ? <p role="status" className="text-sm text-text-secondary">Preparing your queue…</p> : null}
    {loading ? <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
      {Array.from({ length: 6 }).map((_, index) => <MediaCardSkeleton key={index} />)}
    </div> : count === 0 ? <p className="rounded-xl border border-border bg-elevated p-6 text-text-secondary">
      {tab !== "playlists" && linked === false ? <>Link Jellyfin in <Link to="/settings" className="text-accent">Settings</Link> to see your music.</>
        : search ? `No ${tab} match “${search}”.` : tab === "playlists" ? "No playlists yet." : `No ${tab} found. Sync your Jellyfin library in Settings.`}
    </p> : tab === "artists" ? <LibraryGroups items={artistItems} mode={artistMode} />
      : tab === "albums" ? <LibraryGroups items={albumItems} mode={albumMode} />
        : tab === "songs" ? <LibrarySongs tracks={songs} mode={songMode} likedVideoIds={likedVideoIds}
          playlists={playlists} onLikedChange={() => void refreshLikedTracks()} onPlaylistsChange={() => void loadPlaylists()} />
          : <LibraryGroups items={playlistItems} mode={playlistMode} />}
    {hasMore && !loading && tab !== "playlists" ? <div className="flex justify-center">
      <Button variant="secondary" disabled={loadingMore} onClick={() => void loadMore()}>{loadingMore ? "Loading…" : "Load more"}</Button>
    </div> : null}
    <CreatePlaylistDialog visible={createOpen} defaultName={suggestedPlaylistName(playlists.length)}
      busy={createBusy} error={createError} onConfirm={createPlaylist}
      onCancel={() => { if (!createBusy) { setCreateOpen(false); setCreateError(null); } }} />
    <ImportPlaylistWizard visible={importOpen} onClose={() => { setImportOpen(false); void loadPlaylists(); }} />
  </div>;
}
