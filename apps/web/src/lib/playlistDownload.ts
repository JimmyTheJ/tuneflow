import JSZip from "jszip";

import { api } from "@/lib/api";
import { getAccessToken, getApiUrl } from "@/lib/settings";
import {
  buildTrackBaseName,
  extensionFromMime,
  sanitizeDirectoryName,
  uniqueFilename,
} from "@/lib/trackFilenames";
import type { PlaylistDetail, StreamInfo, Track } from "@/types";

export type DownloadPhase = "preparing" | "fetching" | "writing" | "done" | "error";

export type DownloadProgress = {
  phase: DownloadPhase;
  current: number;
  total: number;
  trackTitle: string;
  message?: string;
};

export type TrackDownloadMetadata = {
  video_id: string;
  title: string;
  artist?: string | null;
  duration_sec?: number | null;
  thumbnail_url?: string | null;
  source_title?: string | null;
  short_description?: string | null;
  youtube_url: string;
  mime_type?: string | null;
  playable_video_id?: string | null;
  playlist: {
    id: number;
    name: string;
    position: number;
    track_id: number;
  };
  downloaded_at: string;
};

type FetchedTrack = {
  track: Track & { id: number; position: number };
  position: number;
  stream: StreamInfo;
  blob: Blob;
  extension: string;
  baseName: string;
  metadata: TrackDownloadMetadata;
};

type WriteTarget =
  | { mode: "directory"; dir: FileSystemDirectoryHandle }
  | { mode: "zip"; folder: JSZip };

function supportsDirectoryPicker(): boolean {
  return typeof window !== "undefined" && "showDirectoryPicker" in window;
}

async function pickDownloadDirectory(): Promise<FileSystemDirectoryHandle> {
  const picker = (
    window as Window & {
      showDirectoryPicker?: (options?: { mode?: "read" | "readwrite" }) => Promise<FileSystemDirectoryHandle>;
    }
  ).showDirectoryPicker;
  if (!picker) {
    throw new Error("Your browser does not support choosing a download folder");
  }
  return picker({ mode: "readwrite" });
}

function buildMetadata(
  track: Track & { id: number; position: number },
  stream: StreamInfo,
  playlist: PlaylistDetail,
  mimeType: string | null,
): TrackDownloadMetadata {
  return {
    video_id: stream.video_id,
    title: stream.title,
    artist: stream.artist,
    duration_sec: stream.duration_sec,
    thumbnail_url: stream.thumbnail_url,
    source_title: stream.source_title,
    short_description: stream.short_description,
    youtube_url: `https://www.youtube.com/watch?v=${stream.video_id}`,
    mime_type: mimeType,
    playable_video_id: stream.playable_video_id,
    playlist: {
      id: playlist.id,
      name: playlist.name,
      position: track.position,
      track_id: track.id,
    },
    downloaded_at: new Date().toISOString(),
  };
}

async function fetchTrackAudio(
  track: Track,
  position: number,
  playlist: PlaylistDetail,
): Promise<FetchedTrack> {
  const stream = await api.getStream(track.video_id, track);
  const token = getAccessToken();
  const base = getApiUrl();
  const playableId = stream.playable_video_id ?? stream.video_id;
  const params = new URLSearchParams({ token, download: "true" });
  if (track.title) params.set("title", track.title);
  if (track.artist) params.set("artist", track.artist);

  const response = await fetch(`${base}/api/music/audio/${playableId}?${params.toString()}`);
  if (!response.ok) {
    let detail = await response.text();
    try {
      const parsed = JSON.parse(detail) as { detail?: string };
      detail = parsed.detail ?? detail;
    } catch {
      /* keep */
    }
    throw new Error(detail || `Failed to download "${track.title}"`);
  }

  const mimeType = response.headers.get("content-type");
  const blob = await response.blob();
  const extension = extensionFromMime(mimeType ?? stream.mime_type);
  const baseName = buildTrackBaseName(stream.title, { artist: stream.artist, position });

  return {
    track: track as Track & { id: number; position: number },
    position,
    stream,
    blob,
    extension,
    baseName,
    metadata: buildMetadata(
      track as Track & { id: number; position: number },
      stream,
      playlist,
      mimeType ?? stream.mime_type ?? null,
    ),
  };
}

async function writeTrackFiles(
  target: WriteTarget,
  audioName: string,
  metadataName: string,
  fetched: FetchedTrack,
): Promise<void> {
  const metadataText = `${JSON.stringify(fetched.metadata, null, 2)}\n`;

  if (target.mode === "directory") {
    const audioHandle = await target.dir.getFileHandle(audioName, { create: true });
    const audioWritable = await audioHandle.createWritable();
    await audioWritable.write(fetched.blob);
    await audioWritable.close();

    const metadataHandle = await target.dir.getFileHandle(metadataName, { create: true });
    const metadataWritable = await metadataHandle.createWritable();
    await metadataWritable.write(metadataText);
    await metadataWritable.close();
    return;
  }

  target.folder.file(audioName, fetched.blob);
  target.folder.file(metadataName, metadataText);
}

async function writePlaylistManifest(target: WriteTarget, playlist: PlaylistDetail): Promise<void> {
  const manifest = {
    id: playlist.id,
    name: playlist.name,
    description: playlist.description,
    track_count: playlist.tracks.length,
    exported_at: new Date().toISOString(),
    tracks: playlist.tracks.map((track, index) => ({
      position: index + 1,
      video_id: track.video_id,
      title: track.title,
      artist: track.artist,
    })),
  };
  const text = `${JSON.stringify(manifest, null, 2)}\n`;

  if (target.mode === "directory") {
    const handle = await target.dir.getFileHandle("playlist.json", { create: true });
    const writable = await handle.createWritable();
    await writable.write(text);
    await writable.close();
    return;
  }

  target.folder.file("playlist.json", text);
}

function triggerZipDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

async function downloadToDirectory(
  playlist: PlaylistDetail,
  onProgress: (progress: DownloadProgress) => void,
  signal: AbortSignal,
): Promise<void> {
  const root = await pickDownloadDirectory();
  const dir = await root.getDirectoryHandle(sanitizeDirectoryName(playlist.name), { create: true });
  const target: WriteTarget = { mode: "directory", dir };
  await writePlaylistManifest(target, playlist);
  await downloadTracksWithPrefetch(playlist, target, onProgress, signal);
}

async function downloadAsZip(
  playlist: PlaylistDetail,
  onProgress: (progress: DownloadProgress) => void,
  signal: AbortSignal,
): Promise<void> {
  const zip = new JSZip();
  const folder = zip.folder(sanitizeDirectoryName(playlist.name));
  if (!folder) throw new Error("Could not create download archive");

  const target: WriteTarget = { mode: "zip", folder };
  await writePlaylistManifest(target, playlist);
  await downloadTracksWithPrefetch(playlist, target, onProgress, signal);

  onProgress({
    phase: "writing",
    current: playlist.tracks.length,
    total: playlist.tracks.length,
    trackTitle: "",
    message: "Creating zip archive…",
  });

  const blob = await zip.generateAsync({ type: "blob" });
  triggerZipDownload(blob, `${sanitizeDirectoryName(playlist.name)}.zip`);
}

async function downloadTracksWithPrefetch(
  playlist: PlaylistDetail,
  target: WriteTarget,
  onProgress: (progress: DownloadProgress) => void,
  signal: AbortSignal,
): Promise<void> {
  const tracks = playlist.tracks;
  const usedNames = new Set<string>();
  let prefetch: Promise<FetchedTrack> | null = null;

  for (let index = 0; index < tracks.length; index += 1) {
    if (signal.aborted) throw new DOMException("Download cancelled", "AbortError");

    const track = tracks[index];
    const position = index + 1;
    onProgress({
      phase: "fetching",
      current: position,
      total: tracks.length,
      trackTitle: track.title,
    });

    const currentFetch = prefetch ?? fetchTrackAudio(track, position, playlist);
    prefetch = index + 1 < tracks.length ? fetchTrackAudio(tracks[index + 1], index + 2, playlist) : null;

    const fetched = await currentFetch;
    const audioName = uniqueFilename(fetched.baseName, fetched.extension, usedNames);
    const metadataName = `${audioName.slice(0, -fetched.extension.length)}.json`;

    onProgress({
      phase: "writing",
      current: position,
      total: tracks.length,
      trackTitle: track.title,
    });

    await writeTrackFiles(target, audioName, metadataName, fetched);
  }
}

export function canPickDownloadDirectory(): boolean {
  return supportsDirectoryPicker();
}

export async function downloadPlaylist(
  playlist: PlaylistDetail,
  options: {
    onProgress?: (progress: DownloadProgress) => void;
    signal?: AbortSignal;
    preferDirectory?: boolean;
  } = {},
): Promise<void> {
  const onProgress =
    options.onProgress ??
    (() => {
      /* noop */
    });
  const signal = options.signal ?? new AbortController().signal;

  if (playlist.tracks.length === 0) {
    throw new Error("This playlist has no tracks to download");
  }

  onProgress({
    phase: "preparing",
    current: 0,
    total: playlist.tracks.length,
    trackTitle: "",
  });

  const useDirectory = options.preferDirectory !== false && supportsDirectoryPicker();
  if (useDirectory) {
    await downloadToDirectory(playlist, onProgress, signal);
  } else {
    await downloadAsZip(playlist, onProgress, signal);
  }

  onProgress({
    phase: "done",
    current: playlist.tracks.length,
    total: playlist.tracks.length,
    trackTitle: "",
  });
}
