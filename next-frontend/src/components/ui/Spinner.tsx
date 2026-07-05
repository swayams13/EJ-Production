export default function Spinner({ label }: { label?: string }) {
  return (
    <div className="flex items-center gap-2.5 text-base text-ink-soft" role="status">
      <span className="h-4 w-4 animate-spin rounded-full border-2 border-line border-t-brand" />
      {label}
    </div>
  );
}
