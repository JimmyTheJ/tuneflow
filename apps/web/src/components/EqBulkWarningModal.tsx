import { AlertTriangle } from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";

type Props = {
  visible: boolean;
  title: string;
  description: string;
  trackCount: number;
  confirmLabel: string;
  confirmPhrase: string;
  onClose: () => void;
  onConfirm: () => void | Promise<void>;
};

export function EqBulkWarningModal({
  visible,
  title,
  description,
  trackCount,
  confirmLabel,
  confirmPhrase,
  onClose,
  onConfirm,
}: Props) {
  const [acknowledged, setAcknowledged] = useState(false);
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!visible) {
      setAcknowledged(false);
      setTyped("");
      setBusy(false);
      setError(null);
    }
  }, [visible]);

  if (!visible) return null;

  const canConfirm = acknowledged && typed.trim().toUpperCase() === confirmPhrase;

  const handleConfirm = async () => {
    if (!canConfirm || busy) return;
    setBusy(true);
    setError(null);
    try {
      await onConfirm();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Action failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[95] flex items-end justify-center bg-black/70 p-4 sm:items-center">
      <div
        className="w-full max-w-lg rounded-2xl border border-danger/40 bg-elevated p-5 shadow-elevated"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="eq-warning-title"
      >
        <div className="flex items-start gap-3">
          <AlertTriangle className="mt-0.5 size-5 shrink-0 text-danger-fg" />
          <div>
            <h2 id="eq-warning-title" className="m-0 text-lg font-bold text-danger-fg">
              {title}
            </h2>
            <p className="mt-3 mb-0 text-sm leading-relaxed text-text">{description}</p>
            <p className="mt-3 mb-0 text-sm font-semibold text-text">
              This affects {trackCount} {trackCount === 1 ? "track" : "tracks"} permanently.
            </p>
          </div>
        </div>

        <label className="mt-5 flex items-start gap-3 text-sm text-text-secondary">
          <input
            type="checkbox"
            className="mt-1"
            checked={acknowledged}
            onChange={(event) => setAcknowledged(event.target.checked)}
          />
          <span>
            I understand this permanently changes individual track EQ assignments and cannot be undone
            automatically.
          </span>
        </label>

        <div className="mt-4">
          <label className="mb-2 block text-sm text-text-secondary">
            Type <span className="font-mono font-semibold text-text">{confirmPhrase}</span> to confirm
          </label>
          <Input
            value={typed}
            onChange={(event) => setTyped(event.target.value)}
            placeholder={confirmPhrase}
            autoComplete="off"
          />
        </div>

        {error ? <p className="mt-3 text-sm text-danger-fg">{error}</p> : null}

        <div className="mt-5 flex justify-end gap-2">
          <Button variant="secondary" size="sm" disabled={busy} onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="danger"
            size="sm"
            disabled={!canConfirm || busy}
            onClick={() => void handleConfirm()}
          >
            {confirmLabel}
          </Button>
        </div>
      </div>
    </div>
  );
}
