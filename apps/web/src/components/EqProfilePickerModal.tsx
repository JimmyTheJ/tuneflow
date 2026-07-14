import { useEffect, useState } from "react";
import { Button } from "@/components/ui/Button";
import { cn } from "@/lib/cn";
import type { EqProfile } from "@/types";

type Props = {
  visible: boolean;
  title: string;
  profiles: EqProfile[];
  selectedProfileId?: number | null;
  allowClear?: boolean;
  clearLabel?: string;
  onClose: () => void;
  onSelect: (profileId: number | null) => void | Promise<void>;
};

export function EqProfilePickerModal({
  visible,
  title,
  profiles,
  selectedProfileId = null,
  allowClear = true,
  clearLabel = "Remove EQ assignment",
  onClose,
  onSelect,
}: Props) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!visible) {
      setBusy(false);
      setError(null);
    }
  }, [visible]);

  if (!visible) return null;

  const handleSelect = async (profileId: number | null) => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await onSelect(profileId);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not update EQ profile");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[90] flex items-end justify-center bg-black/60 p-4 sm:items-center">
      <div
        className="w-full max-w-md rounded-2xl border border-border bg-elevated p-5 shadow-elevated"
        role="dialog"
        aria-modal="true"
        aria-labelledby="eq-picker-title"
      >
        <h2 id="eq-picker-title" className="m-0 text-lg font-bold">
          {title}
        </h2>
        <p className="mt-2 mb-0 text-sm text-text-secondary">
          Choose a saved equalizer profile.
        </p>
        <div className="mt-4 max-h-[min(360px,50vh)] space-y-1 overflow-y-auto">
          {profiles.map((profile) => (
            <button
              key={profile.id}
              type="button"
              disabled={busy}
              className={cn(
                "flex w-full items-center justify-between rounded-lg px-3 py-2.5 text-left text-sm transition-colors",
                "hover:bg-highlight disabled:opacity-50",
                selectedProfileId === profile.id && "bg-accent/10 text-accent",
              )}
              onClick={() => void handleSelect(profile.id)}
            >
              <span className="font-medium">{profile.name}</span>
              {profile.is_default ? (
                <span className="text-xs text-text-muted">Default</span>
              ) : null}
            </button>
          ))}
          {profiles.length === 0 ? (
            <p className="m-0 px-1 py-2 text-sm text-text-secondary">No EQ profiles yet.</p>
          ) : null}
        </div>
        {allowClear ? (
          <Button
            variant="ghost"
            size="sm"
            className="mt-3"
            disabled={busy}
            onClick={() => void handleSelect(null)}
          >
            {clearLabel}
          </Button>
        ) : null}
        {error ? <p className="mt-3 text-sm text-danger-fg">{error}</p> : null}
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="secondary" size="sm" disabled={busy} onClick={onClose}>
            Cancel
          </Button>
        </div>
      </div>
    </div>
  );
}
