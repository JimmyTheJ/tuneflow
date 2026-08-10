import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { api } from "@/lib/api";
import { cn } from "@/lib/cn";
import type { ImportJob, ImportProvidersStatus, PlaylistVisibility } from "@/types";

type Props = {
  visible: boolean;
  onClose: () => void;
};

type Provider = "youtube" | "spotify";

export function ImportPlaylistWizard({ visible, onClose }: Props) {
  const navigate = useNavigate();
  const [providers, setProviders] = useState<ImportProvidersStatus | null>(null);
  const [provider, setProvider] = useState<Provider>("youtube");
  const [url, setUrl] = useState("");
  const [name, setName] = useState("");
  const [visibility, setVisibility] = useState<PlaylistVisibility>("private");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [job, setJob] = useState<ImportJob | null>(null);

  useEffect(() => {
    if (!visible) return;
    setUrl("");
    setName("");
    setVisibility("private");
    setBusy(false);
    setError(null);
    setJob(null);
    void api
      .getImportProviders()
      .then((status) => {
        setProviders(status);
        setProvider(status.spotify ? "spotify" : "youtube");
      })
      .catch(() => {
        setProviders({ youtube: true, spotify: false });
        setProvider("youtube");
      });
  }, [visible]);

  useEffect(() => {
    if (!job || job.status === "completed" || job.status === "failed" || job.status === "cancelled") {
      return;
    }
    const timer = window.setInterval(() => {
      void api
        .getImportJob(job.id)
        .then((next) => {
          setJob(next);
          if (next.status === "completed" && next.result_playlist_id) {
            onClose();
            navigate(`/playlist/${next.result_playlist_id}`);
          }
          if (next.status === "failed") {
            setBusy(false);
            setError(next.error || "Import failed");
          }
        })
        .catch((err) => {
          setBusy(false);
          setError(err instanceof Error ? err.message : "Could not poll import job");
        });
    }, 1000);
    return () => window.clearInterval(timer);
  }, [job, navigate, onClose]);

  if (!visible) return null;

  const spotifyReady = providers?.spotify ?? false;
  const canSubmit = url.trim().length > 8 && !busy && (provider !== "spotify" || spotifyReady);

  const startImport = async () => {
    if (!canSubmit) return;
    setBusy(true);
    setError(null);
    try {
      const created = await api.createImportJob({
        provider,
        url: url.trim(),
        name: name.trim() || undefined,
        visibility,
      });
      setJob(created);
      if (created.status === "completed" && created.result_playlist_id) {
        onClose();
        navigate(`/playlist/${created.result_playlist_id}`);
      }
      if (created.status === "failed") {
        setBusy(false);
        setError(created.error || "Import failed");
      }
    } catch (err) {
      setBusy(false);
      setError(err instanceof Error ? err.message : "Could not start import");
    }
  };

  const progressLabel =
    job && job.progress_total > 0
      ? `${job.progress_done}/${job.progress_total}`
      : job?.message || "Working…";

  return (
    <div
      className="fixed inset-0 z-[110] grid place-items-center bg-black/70 p-6 backdrop-blur-sm"
      onClick={busy ? undefined : onClose}
    >
      <div
        className="w-full max-w-lg rounded-2xl border border-border bg-elevated p-6 shadow-elevated"
        onClick={(event) => event.stopPropagation()}
      >
        <h3 className="m-0 text-xl font-bold tracking-tight">Import playlist</h3>
        <p className="mt-2 mb-0 text-sm text-text-secondary">
          Paste a YouTube or Spotify playlist URL. Spotify tracks are matched to YouTube
          automatically.
        </p>

        <div className="mt-4 flex gap-2">
          <Button
            type="button"
            size="sm"
            variant={provider === "youtube" ? "primary" : "secondary"}
            className={cn("flex-1", provider === "youtube" && "!rounded-full")}
            disabled={busy}
            onClick={() => setProvider("youtube")}
          >
            YouTube
          </Button>
          <Button
            type="button"
            size="sm"
            variant={provider === "spotify" ? "primary" : "secondary"}
            className="flex-1"
            disabled={busy || !spotifyReady}
            onClick={() => setProvider("spotify")}
            title={spotifyReady ? undefined : "Set SPOTIFY_CLIENT_ID and SPOTIFY_CLIENT_SECRET on the server"}
          >
            Spotify{spotifyReady ? "" : " (not configured)"}
          </Button>
        </div>

        <div className="mt-4 space-y-3">
          <Input
            value={url}
            onChange={(event) => setUrl(event.target.value)}
            placeholder={
              provider === "spotify"
                ? "https://open.spotify.com/playlist/…"
                : "https://www.youtube.com/playlist?list=…"
            }
            disabled={busy}
            autoFocus
          />
          <Input
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="Playlist name (optional)"
            disabled={busy}
            maxLength={200}
          />
          <div className="flex gap-2">
            <Button
              type="button"
              size="sm"
              variant={visibility === "private" ? "primary" : "secondary"}
              className="flex-1"
              disabled={busy}
              onClick={() => setVisibility("private")}
            >
              Private
            </Button>
            <Button
              type="button"
              size="sm"
              variant={visibility === "household" ? "primary" : "secondary"}
              className="flex-1"
              disabled={busy}
              onClick={() => setVisibility("household")}
            >
              Household
            </Button>
          </div>
        </div>

        {job && (job.status === "queued" || job.status === "running") ? (
          <p className="mt-4 text-sm text-accent" role="status" aria-live="polite">
            {job.message || "Importing…"} {progressLabel}
          </p>
        ) : null}

        {error ? <p className="mt-3 text-sm text-danger-fg">{error}</p> : null}

        <div className="mt-6 flex gap-3">
          <Button variant="secondary" className="flex-1" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button className="flex-1" onClick={() => void startImport()} disabled={!canSubmit}>
            {busy ? "Importing…" : "Start import"}
          </Button>
        </div>
      </div>
    </div>
  );
}
