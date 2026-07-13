import { Download, Loader2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/Button";
import { IconButton } from "@/components/ui/IconButton";
import {
  canPickDownloadDirectory,
  downloadTrack,
  type DownloadProgress,
} from "@/lib/playlistDownload";
import { cn } from "@/lib/cn";
import type { Track } from "@/types";

type Props = {
  track: Track;
  disabled?: boolean;
  variant?: "button" | "icon";
  size?: "sm" | "md" | "lg";
  className?: string;
};

function progressLabel(progress: DownloadProgress | null, busy: boolean): string {
  if (!busy) return "Download";
  if (!progress) return "Downloading…";
  if (progress.phase === "preparing" || progress.phase === "fetching") return "Downloading…";
  if (progress.phase === "writing") return progress.message ?? "Saving…";
  if (progress.phase === "done") return "Downloaded";
  return "Download failed";
}

export function TrackDownloadButton({
  track,
  disabled = false,
  variant = "button",
  size = "sm",
  className,
}: Props) {
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
    if (busy) return;

    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setBusy(true);
    setError(null);
    setProgress({
      phase: "preparing",
      current: 0,
      total: 1,
      trackTitle: track.title,
    });

    try {
      await downloadTrack(track, {
        signal: controller.signal,
        onProgress: setProgress,
        preferDirectory: canPickDownloadDirectory(),
      });
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") return;
      setError(err instanceof Error ? err.message : "Download failed");
      setProgress((current) =>
        current ? { ...current, phase: "error" } : { phase: "error", current: 0, total: 1, trackTitle: track.title },
      );
    } finally {
      setBusy(false);
      abortRef.current = null;
    }
  };

  const label = progressLabel(progress, busy);
  const title = error ?? (canPickDownloadDirectory()
    ? "Save this track and a metadata JSON sidecar to a folder"
    : "Download this track as a zip with metadata");

  if (variant === "icon") {
    return (
      <IconButton
        label={label}
        size={size}
        disabled={disabled || busy}
        className={className}
        title={title}
        onClick={() => void startDownload()}
      >
        {busy ? <Loader2 className="size-4 animate-spin" /> : <Download className="size-4" />}
      </IconButton>
    );
  }

  return (
    <div className={cn("flex flex-col items-start gap-1", className)}>
      <Button
        variant="secondary"
        size={size}
        disabled={disabled || busy}
        onClick={() => void startDownload()}
        className="gap-2"
        title={title}
      >
        {busy ? <Loader2 className="size-4 animate-spin" /> : <Download className="size-4" />}
        {label}
      </Button>
      {error ? <p className="m-0 text-xs text-danger-fg">{error}</p> : null}
    </div>
  );
}
