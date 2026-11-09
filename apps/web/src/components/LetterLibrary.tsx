import { ChevronDown, ChevronRight } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Button } from "@/components/ui/Button";
import { api } from "@/lib/api";
import type { LibraryAlbum, LibraryArtist, Track } from "@/types";

export const libraryLetters = [..."ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789", "#"];
export type LibraryEntry = LibraryArtist | LibraryAlbum | Track;
type Section = "artists" | "albums" | "songs";
const PAGE_SIZE = 60;

function LetterEntries({ section, query, initial, count, render }: {
  section: Section; query: string; initial: string; count: number;
  render: (entries: LibraryEntry[]) => ReactNode;
}) {
  const [entries, setEntries] = useState<LibraryEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [retry, setRetry] = useState(0);
  const [offset, setOffset] = useState(0);
  const [complete, setComplete] = useState(false);
  useEffect(() => {
    let active = true;
    setLoading(true); setError(null);
    const options = { q: query, initial, limit: PAGE_SIZE, offset };
    const request = section === "artists" ? api.libraryArtists(options)
      : section === "albums" ? api.libraryAlbums(options) : api.libraryTracks(options);
    void request.then((page) => {
      if (!active) return;
      setEntries((previous) => offset === 0 ? page : [...previous.slice(0, offset), ...page]);
      setComplete(page.length < PAGE_SIZE || offset + page.length >= count);
    }).catch((cause: unknown) => {
      if (active) setError(cause instanceof Error ? cause.message : `Could not load ${section}`);
    }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [section, query, initial, offset, count, retry]);
  return <div className="space-y-3 pb-3">
    {render(entries)}
    {error ? <p role="alert" className="text-danger-fg">{error}</p> : null}
    {loading ? <p role="status" className="text-sm text-text-secondary">Loading {section}…</p>
      : error ? <Button variant="secondary" size="sm" onClick={() => setRetry((value) => value + 1)}>Retry</Button>
        : !complete ? <Button variant="secondary" size="sm" onClick={() => setOffset(entries.length)}>Load more {section}</Button> : null}
  </div>;
}

/** Counts are cheap; entry pages and artwork load only for expanded groups. */
export function LetterLibrary({ section, query, render, empty }: {
  section: Section; query: string; render: (entries: LibraryEntry[]) => ReactNode; empty: ReactNode;
}) {
  const storageKey = `tuneflow.library.expanded.${section}.${query}`;
  const [expanded, setExpanded] = useState<Set<string>>(() => {
    try {
      const saved: unknown = JSON.parse(sessionStorage.getItem(storageKey) ?? "[]");
      return new Set(Array.isArray(saved) ? saved.filter((key): key is string => typeof key === "string" && libraryLetters.includes(key)) : []);
    } catch { return new Set(); }
  });
  const [opened, setOpened] = useState(() => new Set(expanded));
  const [counts, setCounts] = useState<Record<string, number> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [retry, setRetry] = useState(0);
  const headers = useRef(new Map<string, HTMLButtonElement>());
  useEffect(() => {
    let active = true;
    setCounts(null); setError(null);
    void api.libraryInitials(section, query).then((index) => {
      if (active) setCounts(Object.fromEntries(index.groups.map((group) => [group.initial, group.count])));
    }).catch((cause: unknown) => {
      if (active) setError(cause instanceof Error ? cause.message : "Could not load letters");
    });
    return () => { active = false; };
  }, [section, query, retry]);
  const updateExpanded = (next: Set<string>) => {
    setExpanded(next);
    setOpened((previous) => new Set([...previous, ...next]));
    sessionStorage.setItem(storageKey, JSON.stringify([...next]));
  };
  const jump = (initial: string) => {
    updateExpanded(new Set([...expanded, initial]));
    const header = headers.current.get(initial);
    header?.scrollIntoView({ block: "start", behavior: "smooth" });
    header?.focus({ preventScroll: true });
  };
  if (error) return <div role="alert" className="space-y-3"><p className="text-danger-fg">{error}</p>
    <Button variant="secondary" onClick={() => setRetry((value) => value + 1)}>Retry</Button></div>;
  if (!counts) return <p role="status" className="text-text-secondary">Loading letters…</p>;
  if (!Object.values(counts).some((count) => count > 0)) return <>{empty}</>;
  return <div className="space-y-4">
    <nav aria-label={`Jump to ${section} by initial`} className="flex flex-wrap gap-1 rounded-xl border border-border bg-elevated p-2">
      {libraryLetters.map((initial) => <button key={initial} type="button" disabled={!counts[initial]}
        aria-label={`Jump to ${section} ${initial === "#" ? "special characters" : initial}`}
        onClick={() => jump(initial)} className="size-10 rounded-lg font-semibold text-accent hover:bg-highlight disabled:opacity-30 disabled:cursor-default">{initial}</button>)}
    </nav>
    {libraryLetters.filter((initial) => !query || counts[initial]).map((initial) => {
      const count = counts[initial] ?? 0;
      const open = count > 0 && expanded.has(initial);
      const id = `library-${section}-${initial === "#" ? "special" : initial}`;
      return <section key={initial} className="space-y-3">
        <button ref={(element) => { if (element) headers.current.set(initial, element); else headers.current.delete(initial); }}
          type="button" disabled={!count} aria-expanded={open} aria-controls={id}
          onClick={() => { const next = new Set(expanded); if (open) next.delete(initial); else next.add(initial); updateExpanded(next); }}
          className="flex w-full scroll-mt-4 items-center gap-3 rounded-xl border border-border bg-elevated px-4 py-3 text-left hover:bg-highlight disabled:opacity-40">
          {open ? <ChevronDown className="size-5" /> : <ChevronRight className="size-5" />}
          <span className="w-9 text-xl font-bold">{initial}</span>
          <span className="text-sm text-text-secondary">{count} {count === 1 ? section === "songs" ? "song" : section.slice(0, -1) : section}</span>
        </button>
        <div id={id} hidden={!open}>
          {opened.has(initial) && count > 0 ? <LetterEntries section={section} query={query} initial={initial} count={count} render={render} /> : null}
        </div>
      </section>;
    })}
  </div>;
}
