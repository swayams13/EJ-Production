type BadgeTone = "brand" | "success" | "warning" | "critical" | "neutral";

const toneClasses: Record<BadgeTone, string> = {
  brand: "bg-brand-tint text-brand-deep",
  success: "bg-success-tint text-[#3f6b4e]",
  warning: "bg-warning-tint text-[#8a6636]",
  critical: "bg-critical-tint text-[#8a4437]",
  neutral: "bg-line/60 text-ink-soft",
};

const dotClasses: Record<BadgeTone, string> = {
  brand: "bg-brand",
  success: "bg-success",
  warning: "bg-warning",
  critical: "bg-critical",
  neutral: "bg-ink-soft",
};

export default function Badge({ tone = "neutral", children }: { tone?: BadgeTone; children: React.ReactNode }) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-bold uppercase tracking-wide ${toneClasses[tone]}`}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${dotClasses[tone]}`} />
      {children}
    </span>
  );
}
