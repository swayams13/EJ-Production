import { Card } from "./Card";

export default function MetricCard({
  label,
  value,
  tone = "neutral",
}: {
  label: string;
  value: string | number;
  tone?: "neutral" | "success" | "warning" | "critical";
}) {
  const valueColor =
    tone === "success"
      ? "text-success"
      : tone === "warning"
      ? "text-warning"
      : tone === "critical"
      ? "text-critical"
      : "text-ink";

  return (
    <Card className="p-5">
      <span className="block text-xs font-semibold uppercase tracking-wide text-ink-soft mb-2">
        {label}
      </span>
      <span className={`font-data tabular-nums text-2xl font-bold ${valueColor}`}>{value}</span>
    </Card>
  );
}
