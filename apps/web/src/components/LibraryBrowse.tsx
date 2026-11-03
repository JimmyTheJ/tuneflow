import { LayoutGrid, List, Music2, Play, Rows3 } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router-dom";
import { MediaCard } from "@/components/MediaCard";
import { TrackRowWithActions } from "@/components/TrackRowWithActions";
import { TrackThumb } from "@/components/TrackThumb";
import { cn } from "@/lib/cn";
import { formatTime } from "@/lib/time";
import { usePlayerStore } from "@/stores/playerStore";
import type { Playlist, Track } from "@/types";

export type LibraryViewMode = "tiles" | "list" | "details";

export function useLibraryViewMode(section: string, initial: LibraryViewMode = "tiles") {
  const key = `tuneflow.library.view.${section}`;
  const [mode, setMode] = useState<LibraryViewMode>(() => {
    const saved = localStorage.getItem(key);
    return saved === "tiles" || saved === "list" || saved === "details" ? saved : initial;
  });
  const changeMode = (next: LibraryViewMode) => {
    localStorage.setItem(key, next);
    setMode(next);
  };
  return [mode, changeMode] as const;
}

export function LibraryViewPicker({ mode, onChange }: {
  mode: LibraryViewMode;
  onChange: (mode: LibraryViewMode) => void;
}) {
  const options = [
    { mode: "tiles" as const, label: "Large tiles", icon: LayoutGrid },
    { mode: "list" as const, label: "List", icon: List },
    { mode: "details" as const, label: "Details", icon: Rows3 },
  ];
  return <div className="inline-flex flex-wrap gap-1 rounded-xl border border-border bg-elevated p-1" aria-label="Library view">
    {options.map(({ mode: value, label, icon: Icon }) => <button key={value} type="button" aria-pressed={mode === value}
      className={cn("inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-sm transition-colors", mode === value ? "bg-accent text-accent-fg" : "text-text-secondary hover:bg-highlight hover:text-text")}
      onClick={() => onChange(value)}><Icon className="size-4" /><span>{label}</span></button>)}
  </div>;
}

export type LibraryGroupItem = {
  id: string;
  title: string;
  subtitle: string;
  detail: string;
  videoId?: string;
  href: string;
  onPlay?: () => void;
};

export function LibraryGroups({ items, mode }: { items: LibraryGroupItem[]; mode: LibraryViewMode }) {
  if (mode === "tiles") return <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
    {items.map((item) => <MediaCard key={item.id} title={item.title} subtitle={item.subtitle}
      videoId={item.videoId} href={item.href} onPlay={item.onPlay} />)}
  </div>;

  return <div className="overflow-hidden rounded-xl border border-border bg-elevated">
    {mode === "details" ? <div className="grid grid-cols-[minmax(0,2fr)_minmax(0,1fr)_auto] gap-3 border-b border-border px-4 py-2 text-xs font-semibold uppercase tracking-wide text-text-muted">
      <span>Name</span><span>Details</span><span className="w-12" />
    </div> : null}
    {items.map((item) => <div key={item.id} className="flex items-center gap-3 border-b border-border/60 px-3 py-2 last:border-b-0 hover:bg-highlight/60">
      <Link to={item.href} className="flex min-w-0 flex-1 items-center gap-3 text-text">
        {mode === "list" ? item.videoId
          ? <TrackThumb videoId={item.videoId} className="size-12 shrink-0 rounded-md" fallbackClassName="size-12 shrink-0 rounded-md" />
          : <span className="flex size-12 shrink-0 items-center justify-center rounded-md bg-highlight"><Music2 className="size-5 text-text-muted" /></span> : null}
        {mode === "list" ? <span className="flex min-w-0 flex-1 flex-col">
          <span className="truncate font-semibold">{item.title}</span>
          <span className="truncate text-sm font-normal text-text-secondary">{item.subtitle}</span>
        </span> : <>
          <span className="min-w-0 flex-1 truncate font-semibold">{item.title}</span>
          <span className="min-w-0 flex-1 truncate text-sm font-normal text-text-secondary">{item.detail}</span>
        </>}
      </Link>
      {item.onPlay ? <button type="button" onClick={item.onPlay} aria-label={`Play ${item.title}`}
        className="flex size-10 shrink-0 items-center justify-center rounded-full text-accent hover:bg-accent-dim"><Play className="size-5 fill-current" /></button> : null}
    </div>)}
  </div>;
}

export function LibrarySongs({ tracks, mode, likedVideoIds, playlists, onLikedChange, onPlaylistsChange, showTrackNumbers = false }: {
  tracks: Track[];
  mode: LibraryViewMode;
  likedVideoIds: Set<string>;
  playlists: Playlist[];
  onLikedChange: () => void;
  onPlaylistsChange: () => void;
  showTrackNumbers?: boolean;
}) {
  const playTrack = usePlayerStore((state) => state.playTrack);
  const playSong = (track: Track) => void playTrack(track, [track]);

  if (mode === "tiles") return <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
    {tracks.map((track) => <MediaCard key={track.video_id} title={track.title}
      subtitle={[track.artist, track.album].filter(Boolean).join(" · ")} videoId={track.video_id}
      onPlay={track.blocked_reason ? undefined : () => playSong(track)} />)}
  </div>;

  if (mode === "list") return <div className="space-y-0.5">
    {tracks.map((track, index) => <TrackRowWithActions key={track.video_id} track={track} playQueue={[track]}
      likedVideoIds={likedVideoIds} playlists={playlists} disabled={!!track.blocked_reason}
      index={showTrackNumbers ? track.track_number ?? index + 1 : undefined}
      subtitle={[track.artist, track.album].filter(Boolean).join(" · ")}
      onPlay={() => playSong(track)} onLikedChange={onLikedChange} onPlaylistsChange={onPlaylistsChange} />)}
  </div>;

  return <div className="overflow-hidden rounded-xl border border-border bg-elevated">
    <div className="grid grid-cols-[minmax(0,2fr)_minmax(0,1fr)_auto] gap-3 border-b border-border px-4 py-2 text-xs font-semibold uppercase tracking-wide text-text-muted sm:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,1fr)_auto]">
      <span>Title</span><span>Artist</span><span className="hidden sm:block">Album</span><span>Time</span>
    </div>
    {tracks.map((track, index) => <div key={track.video_id}
      className="grid grid-cols-[minmax(0,2fr)_minmax(0,1fr)_auto] items-center gap-3 border-b border-border/60 px-4 py-2 text-sm last:border-b-0 hover:bg-highlight/60 sm:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,1fr)_auto]">
      <button type="button" disabled={!!track.blocked_reason} onClick={() => playSong(track)}
        className="flex min-w-0 items-center gap-2 text-left font-semibold text-text disabled:opacity-50">
        <Play className="size-4 shrink-0 text-accent" />{showTrackNumbers ? <span className="w-6 shrink-0 text-text-muted">{track.track_number ?? index + 1}</span> : null}<span className="truncate">{track.title}</span>
      </button>
      <span className="truncate text-text-secondary">{track.artist || "Unknown artist"}</span>
      {track.album_id && track.album ? <Link to={`/library/album/${encodeURIComponent(track.album_id)}`}
        className="hidden truncate text-text-secondary hover:text-accent sm:block">{track.album}</Link>
        : <span className="hidden truncate text-text-muted sm:block">{track.album || "—"}</span>}
      <span className="text-right tabular-nums text-text-secondary">{track.duration_sec ? formatTime(track.duration_sec) : "—"}</span>
    </div>)}
  </div>;
}
