import { cn } from "@/lib/cn";
import { formatBandLabel, gainDbToPercent } from "@/lib/eqBands";
import type { EqBand } from "@/types";

type Props = {
  band: EqBand;
  onChange: (gainDb: number) => void;
  onDragStart: () => void;
  onDragEnd: () => void;
};

export function EqBandSlider({ band, onChange, onDragStart, onDragEnd }: Props) {
  const fillPercent = (Math.abs(band.gainDb) / 12) * 50;
  const thumbPercent = gainDbToPercent(band.gainDb);

  return (
    <label className="flex min-w-[44px] flex-col items-center gap-2 text-xs text-text-muted">
      <div className="relative h-32 w-10">
        <div className="pointer-events-none absolute inset-y-1 left-1/2 w-1.5 -translate-x-1/2 rounded-full bg-border-strong">
          <div className="absolute inset-x-0 top-1/2 h-px -translate-y-1/2 bg-border" aria-hidden="true" />
          {band.gainDb > 0 ? (
            <div
              className="absolute inset-x-0 rounded-full bg-accent/75"
              style={{ bottom: "50%", height: `${fillPercent}%` }}
              aria-hidden="true"
            />
          ) : null}
          {band.gainDb < 0 ? (
            <div
              className="absolute inset-x-0 rounded-full bg-text-muted/50"
              style={{ top: "50%", height: `${fillPercent}%` }}
              aria-hidden="true"
            />
          ) : null}
        </div>
        <input
          type="range"
          min={-12}
          max={12}
          step={0.5}
          value={band.gainDb}
          aria-label={`${formatBandLabel(band.freq)} band`}
          aria-valuetext={`${band.gainDb > 0 ? "+" : ""}${band.gainDb.toFixed(1)} decibels`}
          className="tf-eq-slider-vertical absolute inset-0 z-10"
          onPointerDown={onDragStart}
          onPointerUp={onDragEnd}
          onPointerCancel={onDragEnd}
          onBlur={onDragEnd}
          onChange={(event) => onChange(Number(event.target.value))}
        />
        <div
          className={cn(
            "pointer-events-none absolute left-1/2 z-20 size-3 -translate-x-1/2 rounded-full border-2 border-accent bg-elevated shadow-sm",
            "transition-[bottom] duration-75",
          )}
          style={{ bottom: `calc(${thumbPercent}% - 6px)` }}
          aria-hidden="true"
        />
      </div>
      <span>{formatBandLabel(band.freq)}</span>
    </label>
  );
}
