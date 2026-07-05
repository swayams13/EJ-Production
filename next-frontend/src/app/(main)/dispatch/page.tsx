"use client";

import { EmptyState } from "@/components/ui";

export default function Dispatch() {
  return (
    <div>
      <div>
        <h1 className="font-display text-3xl font-extrabold uppercase tracking-wide text-ink">Dispatch &amp; Logistics</h1>
        <p className="text-ink-soft">Manage packing, invoicing, and outward shipping.</p>
      </div>

      <div className="mt-6">
        <EmptyState
          title="Dispatch Module — Coming Soon"
          description="The logistics and dispatch module is scheduled for development in a future phase."
        />
      </div>
    </div>
  );
}
