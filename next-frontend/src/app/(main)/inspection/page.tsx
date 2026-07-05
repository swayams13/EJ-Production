"use client";

import { EmptyState } from "@/components/ui";

export default function Inspection() {
  return (
    <div>
      <div>
        <h1 className="font-display text-3xl font-extrabold uppercase tracking-wide text-ink">Quality Inspection</h1>
        <p className="text-ink-soft">Record QC results and manage non-conformances.</p>
      </div>

      <div className="mt-6">
        <EmptyState
          title="Inspection Module — Coming Soon"
          description="The quality control and inspection module is scheduled for development in a future phase."
        />
      </div>
    </div>
  );
}
