import { useEffect, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";

type Props = {
  visible: boolean;
  defaultName?: string;
  busy?: boolean;
  error?: string | null;
  onConfirm: (name: string) => void | Promise<void>;
  onCancel: () => void;
};

export function CreatePlaylistDialog({
  visible,
  defaultName = "",
  busy = false,
  error = null,
  onConfirm,
  onCancel,
}: Props) {
  const [name, setName] = useState(defaultName);

  useEffect(() => {
    if (visible) {
      setName(defaultName);
    }
  }, [defaultName, visible]);

  if (!visible) return null;

  const trimmed = name.trim();
  const canSubmit = trimmed.length > 0 && !busy;

  const submit = () => {
    if (!canSubmit) return;
    void onConfirm(trimmed);
  };

  return (
    <div
      className="fixed inset-0 z-[110] grid place-items-center bg-black/70 p-6 backdrop-blur-sm"
      onClick={busy ? undefined : onCancel}
    >
      <div
        className="w-full max-w-md rounded-2xl border border-border bg-elevated p-6 shadow-elevated"
        onClick={(event) => event.stopPropagation()}
      >
        <h3 className="m-0 text-xl font-bold tracking-tight">Name your playlist</h3>
        <p className="mt-2 mb-0 text-sm text-text-secondary">
          Choose a name before creating the playlist.
        </p>
        <div className="mt-4">
          <Input
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="Playlist name"
            autoFocus
            disabled={busy}
            maxLength={200}
            onKeyDown={(event) => {
              if (event.key === "Enter") submit();
            }}
          />
        </div>
        {error ? <p className="mt-3 text-sm text-danger-fg">{error}</p> : null}
        <div className="mt-6 flex gap-3">
          <Button variant="secondary" className="flex-1" onClick={onCancel} disabled={busy}>
            Cancel
          </Button>
          <Button className="flex-1" onClick={submit} disabled={!canSubmit}>
            {busy ? "Creating…" : "Create playlist"}
          </Button>
        </div>
      </div>
    </div>
  );
}
