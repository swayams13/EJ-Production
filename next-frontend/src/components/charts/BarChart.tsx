type Bar = { label: string; value: number; color?: string };

export function HorizontalBarChart({
  bars,
  maxValue,
  valueFormat = (v: number) => String(v),
}: {
  bars: Bar[];
  maxValue?: number;
  valueFormat?: (v: number) => string;
}) {
  const max = maxValue ?? Math.max(1, ...bars.map((b) => b.value));
  return (
    <div className="flex flex-col gap-2">
      {bars.map((b) => (
        <div key={b.label} className="flex items-center gap-3">
          <span className="w-36 shrink-0 truncate text-sm text-ink-soft">{b.label}</span>
          <div className="h-3 flex-1 rounded-full bg-line">
            <div
              className="h-3 rounded-full"
              style={{
                width: `${Math.max(0, Math.min(100, (b.value / max) * 100))}%`,
                backgroundColor: b.color ?? "#3e7c77",
              }}
            />
          </div>
          <span className="w-16 shrink-0 text-right font-data text-xs tabular-nums text-ink">
            {valueFormat(b.value)}
          </span>
        </div>
      ))}
    </div>
  );
}

export interface StackedDay {
  date: string;
  tig_feet: number;
  mig_feet: number;
  grinding_feet: number;
}

const SERIES: { key: keyof Omit<StackedDay, "date">; label: string; color: string }[] = [
  { key: "tig_feet", label: "TIG", color: "#2a78d6" },
  { key: "mig_feet", label: "MIG", color: "#008300" },
  { key: "grinding_feet", label: "Grinding", color: "#eda100" },
];

export function StackedTrendChart({ days }: { days: StackedDay[] }) {
  const max = Math.max(1, ...days.map((d) => d.tig_feet + d.mig_feet + d.grinding_feet));
  return (
    <div>
      <div className="mb-3 flex gap-4 text-xs">
        {SERIES.map((s) => (
          <span key={s.key} className="flex items-center gap-1.5 text-ink-soft">
            <span className="h-2 w-2 rounded-full" style={{ backgroundColor: s.color }} />
            {s.label}
          </span>
        ))}
      </div>
      {days.length === 0 ? (
        <p className="text-sm text-ink-soft">No production data in this window.</p>
      ) : (
        <>
          <div className="flex h-40 items-end gap-1">
            {days.map((d) => {
              const total = d.tig_feet + d.mig_feet + d.grinding_feet;
              return (
                <div
                  key={d.date}
                  className="flex flex-1 flex-col justify-end"
                  title={`${d.date}: ${Math.round(total)} ft`}
                >
                  <div
                    className="flex flex-col-reverse overflow-hidden rounded-t"
                    style={{ height: `${(total / max) * 100}%`, minHeight: total > 0 ? "2px" : 0 }}
                  >
                    {SERIES.map((s) => {
                      const v = d[s.key];
                      if (!v) return null;
                      return (
                        <div
                          key={s.key}
                          style={{ height: total ? `${(v / total) * 100}%` : 0, backgroundColor: s.color }}
                          className="w-full"
                        />
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
          <div className="mt-1 flex justify-between text-[10px] text-ink-soft">
            <span>{days[0]?.date}</span>
            <span>{days[days.length - 1]?.date}</span>
          </div>
        </>
      )}
    </div>
  );
}
