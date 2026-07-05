type AlertTone = "success" | "warning" | "critical" | "info";

const toneClasses: Record<AlertTone, string> = {
  success: "bg-success-tint border-[#c9dfcf] text-[#3f6b4e]",
  warning: "bg-warning-tint border-[#e6d3ba] text-[#8a6636]",
  critical: "bg-critical-tint border-[#e4ccc5] text-[#8a4437]",
  info: "bg-brand-tint border-brand/25 text-brand-deep",
};

const toneIcon: Record<AlertTone, string> = {
  success: "✓",
  warning: "⚠",
  critical: "⚠",
  info: "i",
};

export default function Alert({
  tone = "warning",
  title,
  children,
}: {
  tone?: AlertTone;
  title: string;
  children?: React.ReactNode;
}) {
  return (
    <div className={`flex items-start gap-2.5 rounded-md border p-3.5 text-base ${toneClasses[tone]}`}>
      <span aria-hidden="true">{toneIcon[tone]}</span>
      <div>
        <strong className="block text-sm mb-0.5">{title}</strong>
        {children}
      </div>
    </div>
  );
}
