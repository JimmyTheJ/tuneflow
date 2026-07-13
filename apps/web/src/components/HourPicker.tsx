type Props = {
  label: string;
  value: number;
  onChange: (hour: number) => void;
};

function formatHour(hour: number): string {
  if (hour === 0) return "12 AM";
  if (hour < 12) return `${hour} AM`;
  if (hour === 12) return "12 PM";
  return `${hour - 12} PM`;
}

export function HourPicker({ label, value, onChange }: Props) {
  return (
    <div className="mb-3">
      <span className="mb-1 block text-sm text-text-secondary">{label}</span>
      <div className="flex items-center gap-4">
        <button
          type="button"
          className="inline-flex size-10 items-center justify-center rounded-lg border-0 bg-highlight text-text cursor-pointer hover:bg-hover"
          onClick={() => onChange((value + 23) % 24)}
        >
          −
        </button>
        <span className="min-w-16 text-center font-semibold tabular-nums">{formatHour(value)}</span>
        <button
          type="button"
          className="inline-flex size-10 items-center justify-center rounded-lg border-0 bg-highlight text-text cursor-pointer hover:bg-hover"
          onClick={() => onChange((value + 1) % 24)}
        >
          +
        </button>
      </div>
    </div>
  );
}
