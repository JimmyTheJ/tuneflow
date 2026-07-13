import { Download, Loader2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/Button";
import {
  canPickDownloadDirectory,
  downloadPlaylist,
  type DownloadProgress,
} from "@/lib/playlistDownload";
import type { PlaylistDetail } from "@/types";

type Props = {
  playlist: PlaylistDetail;
  disabled?: boolean;
};

function progressLabel(progress: DownloadProgress | null): string {
  if (!progress) return "Download";
  if (progress.phase === "preparing") return "Preparing…";
  if (progress.phase === "writing" && progress.message) return progress.message;
  if (progress.phase === "done") return "Downloaded";
  if (progress.phase === "error") return "Download failed";
  if (progress.total === 0) return "Downloading…";
  return `Downloading ${progress.current}/${progress.total}`;
}

export function PlaylistDownloadButton({ playlist, disabled = false }: Props) {
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<DownloadProgress | null>(null);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    return () => {
      abortRef.current?.abort();
    };
  }, []);

  const startDownload = async () => {
    if (busy || playlist.tracks.length === 0) return;

    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setBusy(true);
    setError(null);
    setProgress({
      phase: "preparing",
      current: 0,
      total: playlist.tracks.length,
      trackTitle: "",
    });

    try {
      await downloadPlaylist(playlist, {
        signal: controller.signal,
        onProgress: setProgress,
        preferDirectory: canPickDownloadDirectory(),
      });
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") return;
      setError(err instanceof Error ? err.message : "Download failed");
      setProgress((current) =>
        current
          ? { ...current, phase: "error" }
          : {
              phase: "error",
              current: 0,
              total: playlist.tracks.length,
              trackTitle: "",
            },
      );
    } finally {
      setBusy(false);
      abortRef.current = null;
    }
  };

  const hint = canPickDownloadDirectory()
    ? "Save tracks as files in a folder you choose, with a metadata JSON sidecar per track."
    : "Save tracks as a zip file with readable names and metadata JSON sidecars.";

  return (
    <div className="flex flex-col items-start gap-2">
      <Button
        variant="secondary"
        size="lg"
        disabled={disabled || busy || playlist.tracks.length === 0}
        onClick={() => void startDownload()}
        className="!rounded-full gap-2"
        title={hint}
      >
        {busy ? <Loader2 className="size-5 animate-spin" /> : <Download className="size-5" />}
        {progressLabel(progress)}
      </Button>
      {busy && progress?.trackTitle ? (
        <p className="m-0 max-w-md truncate text-xs text-text-secondary">{progress.trackTitle}</p>
      ) : null}
      {!busy ? <p className="m-0 max-w-md text-xs text-text-secondary">{hint}</p> : null}
      {error ? <p className="m-0 text-xs text-danger-fg">{error}</p> : null}
    </div>
  );
}
