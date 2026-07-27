export interface DonutSlice {
  label: string;
  value: number;
  color: string;
}

export default function Donut({ slices, size = 140 }: { slices: DonutSlice[]; size?: number }) {
  const total = slices.reduce((s, x) => s + x.value, 0) || 1;
  const radius = size / 2;
  const stroke = size * 0.22;
  const r = radius - stroke / 2;
  const circumference = 2 * Math.PI * r;
  let offset = 0;

  return (
    <div className="flex items-center gap-4">
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        <circle cx={radius} cy={radius} r={r} fill="none" stroke="#dce3e0" strokeWidth={stroke} />
        {slices.map((s) => {
          const frac = s.value / total;
          const dash = frac * circumference;
          const circle = (
            <circle
              key={s.label}
              cx={radius}
              cy={radius}
              r={r}
              fill="none"
              stroke={s.color}
              strokeWidth={stroke}
              strokeDasharray={`${dash} ${circumference - dash}`}
              strokeDashoffset={-offset}
              transform={`rotate(-90 ${radius} ${radius})`}
            />
          );
          offset += dash;
          return circle;
        })}
      </svg>
      <ul className="flex flex-col gap-1.5 text-xs">
        {slices.map((s) => (
          <li key={s.label} className="flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-full" style={{ backgroundColor: s.color }} />
            <span className="text-ink-soft">{s.label}</span>
            <span className="font-data tabular-nums text-ink">{s.value}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
