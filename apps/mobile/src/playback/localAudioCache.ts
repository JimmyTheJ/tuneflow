import * as FileSystem from "expo-file-system";

const AUDIO_CACHE_DIR = `${FileSystem.cacheDirectory ?? ""}tuneflow-audio/`;
const MAX_CACHED_FILES = 24;

type ActiveDownload = {
  videoId: string;
  download: FileSystem.DownloadResumable;
};

let activeDownload: ActiveDownload | null = null;
let dirReady = false;

async function ensureCacheDir(): Promise<string> {
  if (!FileSystem.cacheDirectory) {
    throw new Error("Local audio cache is unavailable on this device");
  }
  if (!dirReady) {
    const info = await FileSystem.getInfoAsync(AUDIO_CACHE_DIR);
    if (!info.exists) {
      await FileSystem.makeDirectoryAsync(AUDIO_CACHE_DIR, { intermediates: true });
    }
    dirReady = true;
  }
  return AUDIO_CACHE_DIR;
}

function cachePathFor(videoId: string): string {
  const safeId = videoId.replace(/[^a-zA-Z0-9_-]/g, "_");
  return `${AUDIO_CACHE_DIR}${safeId}.bin`;
}

async function pruneAudioCache(keepVideoId?: string): Promise<void> {
  try {
    const entries = await FileSystem.readDirectoryAsync(AUDIO_CACHE_DIR);
    if (entries.length <= MAX_CACHED_FILES) return;

    const ranked = await Promise.all(
      entries.map(async (name) => {
        const uri = `${AUDIO_CACHE_DIR}${name}`;
        const info = await FileSystem.getInfoAsync(uri);
        const modified = info.exists && "modificationTime" in info ? info.modificationTime ?? 0 : 0;
        return { name, uri, modified };
      }),
    );

    ranked.sort((a, b) => a.modified - b.modified);
    const keepName = keepVideoId ? `${keepVideoId.replace(/[^a-zA-Z0-9_-]/g, "_")}.bin` : null;
    let remaining = ranked.length;
    for (const entry of ranked) {
      if (remaining <= MAX_CACHED_FILES) break;
      if (keepName && entry.name === keepName) continue;
      await FileSystem.deleteAsync(entry.uri, { idempotent: true });
      remaining -= 1;
    }
  } catch {
    /* best-effort cleanup */
  }
}

export async function cancelActiveAudioDownload(): Promise<void> {
  if (!activeDownload) return;
  const current = activeDownload;
  activeDownload = null;
  try {
    await current.download.cancelAsync();
  } catch {
    /* already finished/cancelled */
  }
}

/**
 * Ensure the remote audio URL is fully on disk, then return a local file:// URI.
 * Screen-off / Doze cannot underrun a completed local file the way they can a
 * progressive HTTP stream with a small ExoPlayer buffer.
 */
export async function resolveLocalAudioUri(
  videoId: string,
  remoteUrl: string,
  isCurrent: () => boolean,
): Promise<string> {
  await ensureCacheDir();
  const path = cachePathFor(videoId);

  const existing = await FileSystem.getInfoAsync(path);
  if (existing.exists && "size" in existing && (existing.size ?? 0) > 0) {
    void pruneAudioCache(videoId);
    return path;
  }

  await cancelActiveAudioDownload();
  if (!isCurrent()) {
    throw new Error("Playback cancelled");
  }

  const download = FileSystem.createDownloadResumable(remoteUrl, path, {
    cache: false,
    sessionType: FileSystem.FileSystemSessionType.BACKGROUND,
  });
  activeDownload = { videoId, download };

  try {
    const result = await download.downloadAsync();
    if (!isCurrent()) {
      throw new Error("Playback cancelled");
    }
    if (!result?.uri) {
      throw new Error("Audio download failed");
    }
    const info = await FileSystem.getInfoAsync(result.uri);
    if (!info.exists || ("size" in info && (info.size ?? 0) <= 0)) {
      throw new Error("Downloaded audio file is empty");
    }
    void pruneAudioCache(videoId);
    return result.uri;
  } catch (error) {
    await FileSystem.deleteAsync(path, { idempotent: true }).catch(() => undefined);
    throw error;
  } finally {
    if (activeDownload?.videoId === videoId) {
      activeDownload = null;
    }
  }
}
