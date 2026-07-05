type ProgressTone = "brand" | "success" | "warning" | "critical" | "neutral";

const fillClasses: Record<ProgressTone, string> = {
  brand: "bg-brand",
  success: "bg-success",
  warning: "bg-warning",
  critical: "bg-critical",
  neutral: "bg-ink-soft",
};

export default function ProgressBar({
  label,
  percent,
  tone = "brand",
  showLabel = true,
}: {
  label: string;
  percent: number;
  tone?: ProgressTone;
  showLabel?: boolean;
}) {
  const clamped = Math.max(0, Math.min(100, percent));
  return (
    <div>
      {showLabel && (
        <div className="mb-1 flex justify-between text-sm font-semibold">
          <span className="text-ink">{label}</span>
          <span className="font-data tabular-nums text-ink-soft">{clamped}%</span>
        </div>
      )}
      <div className="h-2 w-full rounded-full bg-line">
        <div
          className={`h-2 rounded-full transition-all duration-700 ${fillClasses[tone]}`}
          style={{ width: `${clamped}%` }}
        />
      </div>
    </div>
  );
}
