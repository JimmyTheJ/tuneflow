import { Button } from "@/components/ui/Button";
import { DEFAULT_SEARCH_OPTIONS } from "@/lib/searchOptions";
import type { SearchOptions, SearchPlayOnSelect } from "@/types";

const VERSION_OPTIONS: Array<{ label: string; value: number | null }> = [
  { label: "1", value: 1 },
  { label: "2", value: 2 },
  { label: "3 (default)", value: 3 },
  { label: "5", value: 5 },
  { label: "Unlimited", value: null },
];

const PAGE_SIZE_OPTIONS = [20, 30, 50] as const;

const PLAY_ON_SELECT_OPTIONS: Array<{ label: string; value: SearchPlayOnSelect; hint: string }> = [
  {
    label: "All search results",
    value: "all_results",
    hint: "Selecting a track starts a queue from the loaded search results (great for discovery).",
  },
  {
    label: "Only the selected track",
    value: "single_track",
    hint: "Selecting a track plays just that song. Use the menu to queue more.",
  },
];

type Props = {
  value: SearchOptions;
  onChange: (next: SearchOptions) => void;
  onReset?: () => void;
  disabled?: boolean;
  compact?: boolean;
  /** Household settings only — not shown for per-search session overrides. */
  showPlayOnSelect?: boolean;
};

export function SearchOptionsPanel({
  value,
  onChange,
  onReset,
  disabled,
  compact,
  showPlayOnSelect = false,
}: Props) {
  return (
    <div className={compact ? "space-y-4" : "space-y-5 rounded-xl border border-border bg-elevated p-4"}>
      <div className="space-y-2">
        <label className="block text-sm font-semibold text-text">Versions per song</label>
        <div className="flex flex-wrap gap-2">
          {VERSION_OPTIONS.map((option) => {
            const active = value.max_per_song === option.value;
            return (
              <button
                key={option.label}
                type="button"
                disabled={disabled}
                className={
                  active
                    ? "rounded-full border border-accent bg-accent/15 px-3 py-1.5 text-sm font-medium text-accent"
                    : "rounded-full border border-border bg-transparent px-3 py-1.5 text-sm text-text-secondary hover:bg-highlight"
                }
                onClick={() => onChange({ ...value, max_per_song: option.value })}
              >
                {option.label}
              </button>
            );
          })}
        </div>
      </div>

      <div className="space-y-2">
        <label className="block text-sm font-semibold text-text">Results per page</label>
        <div className="flex flex-wrap gap-2">
          {PAGE_SIZE_OPTIONS.map((size) => (
            <button
              key={size}
              type="button"
              disabled={disabled}
              className={
                value.results_per_page === size
                  ? "rounded-full border border-accent bg-accent/15 px-3 py-1.5 text-sm font-medium text-accent"
                  : "rounded-full border border-border bg-transparent px-3 py-1.5 text-sm text-text-secondary hover:bg-highlight"
              }
              onClick={() => onChange({ ...value, results_per_page: size })}
            >
              {size}
            </button>
          ))}
        </div>
      </div>

      <div className="space-y-2">
        <label className="flex items-center justify-between gap-3 text-sm">
          <span className="font-semibold text-text">Hide covers & karaoke</span>
          <input
            type="checkbox"
            checked={value.hide_covers}
            disabled={disabled}
            onChange={(e) => onChange({ ...value, hide_covers: e.target.checked })}
          />
        </label>
        <label className="flex items-center justify-between gap-3 text-sm">
          <span className="font-semibold text-text">Hide long mixes & loops</span>
          <input
            type="checkbox"
            checked={value.hide_loops}
            disabled={disabled}
            onChange={(e) => onChange({ ...value, hide_loops: e.target.checked })}
          />
        </label>
      </div>

      {showPlayOnSelect ? (
        <div className="space-y-2">
          <label className="block text-sm font-semibold text-text">When you play a search result</label>
          <div className="space-y-2">
            {PLAY_ON_SELECT_OPTIONS.map((option) => {
              const active = value.play_on_select === option.value;
              return (
                <button
                  key={option.value}
                  type="button"
                  disabled={disabled}
                  className={
                    active
                      ? "flex w-full flex-col items-start gap-0.5 rounded-lg border border-accent bg-accent/15 px-3 py-2.5 text-left"
                      : "flex w-full flex-col items-start gap-0.5 rounded-lg border border-border bg-transparent px-3 py-2.5 text-left hover:bg-highlight"
                  }
                  onClick={() => onChange({ ...value, play_on_select: option.value })}
                >
                  <span className={active ? "text-sm font-medium text-accent" : "text-sm font-medium text-text"}>
                    {option.label}
                  </span>
                  <span className="text-xs text-text-secondary">{option.hint}</span>
                </button>
              );
            })}
          </div>
        </div>
      ) : null}

      {onReset ? (
        <Button type="button" variant="secondary" disabled={disabled} onClick={onReset}>
          Reset to defaults
        </Button>
      ) : null}
    </div>
  );
}

export function isDefaultSearchOptions(options: SearchOptions): boolean {
  return (
    options.max_per_song === DEFAULT_SEARCH_OPTIONS.max_per_song &&
    options.hide_covers === DEFAULT_SEARCH_OPTIONS.hide_covers &&
    options.hide_loops === DEFAULT_SEARCH_OPTIONS.hide_loops &&
    options.results_per_page === DEFAULT_SEARCH_OPTIONS.results_per_page &&
    options.version_preference === DEFAULT_SEARCH_OPTIONS.version_preference &&
    options.play_on_select === DEFAULT_SEARCH_OPTIONS.play_on_select
  );
}
