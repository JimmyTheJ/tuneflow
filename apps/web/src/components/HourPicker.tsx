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
    <div className="hour-picker">
      <span className="label">{label}</span>
      <div className="hour-picker-row">
        <button type="button" onClick={() => onChange((value + 23) % 24)}>
          −
        </button>
        <span>{formatHour(value)}</span>
        <button type="button" onClick={() => onChange((value + 1) % 24)}>
          +
        </button>
      </div>
    </div>
  );
}
