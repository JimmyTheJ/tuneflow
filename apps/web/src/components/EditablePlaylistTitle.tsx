import { Pencil } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { IconButton } from "@/components/ui/IconButton";
import { Input } from "@/components/ui/Input";
import { cn } from "@/lib/cn";

type Props = {
  name: string;
  onSave: (name: string) => Promise<void>;
  className?: string;
};

export function EditablePlaylistTitle({ name, onSave, className }: Props) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(name);
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!editing) setDraft(name);
  }, [name, editing]);

  useEffect(() => {
    if (editing) inputRef.current?.focus();
  }, [editing]);

  const commit = async () => {
    const trimmed = draft.trim();
    if (!trimmed || trimmed === name) {
      setDraft(name);
      setEditing(false);
      return;
    }

    setBusy(true);
    try {
      await onSave(trimmed);
      setEditing(false);
    } catch {
      setDraft(name);
      setEditing(false);
    } finally {
      setBusy(false);
    }
  };

  if (editing) {
    return (
      <Input
        ref={inputRef}
        value={draft}
        disabled={busy}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={() => void commit()}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            void commit();
          }
          if (event.key === "Escape") {
            setDraft(name);
            setEditing(false);
          }
        }}
        className={cn(
          "mt-2 mb-2 text-4xl font-extrabold tracking-tight md:text-5xl",
          "border-0 bg-transparent px-0 py-0 focus:border-0",
          className,
        )}
        aria-label="Playlist name"
      />
    );
  }

  return (
    <div className="group/title mt-2 mb-2 flex min-w-0 items-center gap-2">
      <h1 className={cn("m-0 text-4xl font-extrabold tracking-tight md:text-5xl", className)}>
        {name}
      </h1>
      <IconButton
        label="Rename playlist"
        size="sm"
        className="opacity-60 group-hover/title:opacity-100"
        onClick={() => setEditing(true)}
      >
        <Pencil className="size-4" />
      </IconButton>
    </div>
  );
}
