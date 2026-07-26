"use client";
import { apiFetch } from "@/lib/api";
import { useState, useEffect } from "react";
import { MetricCard, ProgressBar, Badge, Spinner, Table, THead, TBody, Tr, Th, Td } from "@/components/ui";
import MailButton from "@/components/MailButton";

const API = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8003";

interface Kpis {
  total_active: number;
  total_on_hold: number;
  total_completed: number;
  pipeline_value: number;
  on_time: number;
  delayed: number;
}

interface ProjectRow {
  id: number;
  quotation_no: string;
  project_name: string | null;
  client_name: string | null;
  status: string;
  order_value: number | null;
  advance_received: number | null;
  committed_dispatch_date: string | null;
  target_date: string | null;
  progress_pct: number;
  completion_request_status: string | null;
}

function fmt(n: number | null): string {
  if (n == null) return "—";
  return "₹" + n.toLocaleString("en-IN");
}

// ponytail: static lookup — no runtime Tailwind interpolation
const BADGE_TONE: Record<string, "success" | "warning" | "critical" | "neutral"> = {
  Completed: "success",
  Hold: "warning",
  Delayed: "critical",
  Active: "neutral",
};

const PROGRESS_TONE: (pct: number) => "success" | "warning" | "critical" = (pct) =>
  pct >= 80 ? "success" : pct >= 40 ? "warning" : "critical";

export default function ExecutiveDashboard() {
  const [kpis, setKpis] = useState<Kpis | null>(null);
  const [projects, setProjects] = useState<ProjectRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<"all" | "active" | "delayed" | "completed">("all");

  useEffect(() => {
    apiFetch(`${API}/api/v1/dashboard/executive`)
      .then((r) => r.json())
      .then((data) => {
        setKpis(data.kpis);
        setProjects(data.projects);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  if (loading) return <Spinner label="Loading executive view…" />;
  if (!kpis) return <p className="text-ink-soft text-sm">Failed to load data.</p>;

  const today = new Date();

  const filtered = projects.filter((p) => {
    const isDelayed =
      p.status === "Active" && p.committed_dispatch_date && new Date(p.committed_dispatch_date) < today;
    if (filter === "active") return p.status === "Active";
    if (filter === "delayed") return Boolean(isDelayed);
    if (filter === "completed") return p.status === "Completed";
    return true;
  });

  const FILTER_LABELS: Record<string, string> = {
    all: `All (${projects.length})`,
    active: `Active (${kpis.total_active})`,
    delayed: `Delayed (${kpis.delayed})`,
    completed: `Completed (${kpis.total_completed})`,
  };

  return (
    <div className="flex flex-col gap-8">
      <div>
        <h1 className="font-display text-3xl font-extrabold uppercase tracking-wide text-ink">
          Executive Dashboard
        </h1>
        <p className="text-ink-soft">Full project and financial overview.</p>
      </div>

      {/* KPI Row */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6">
        <MetricCard label="Active Projects" value={String(kpis.total_active)} tone="neutral" />
        <MetricCard label="Pipeline Value" value={fmt(kpis.pipeline_value)} tone="neutral" />
        <MetricCard label="On Time" value={String(kpis.on_time)} tone="success" />
        <MetricCard label="Delayed" value={String(kpis.delayed)} tone="critical" />
        <MetricCard label="On Hold" value={String(kpis.total_on_hold)} tone="warning" />
        <MetricCard label="Completed" value={String(kpis.total_completed)} tone="neutral" />
      </div>

      {/* Filter chips */}
      <div className="flex gap-2 flex-wrap">
        {(["all", "active", "delayed", "completed"] as const).map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={
              filter === f
                ? "rounded-full border border-brand bg-brand/10 px-3 py-1 text-xs font-semibold capitalize text-brand transition-colors"
                : "rounded-full border border-line bg-paper-raised px-3 py-1 text-xs font-semibold capitalize text-ink-soft transition-colors hover:text-ink"
            }
          >
            {FILTER_LABELS[f]}
          </button>
        ))}
      </div>

      {/* Projects Table */}
      <Table>
        <THead>
          <Tr>
            <Th>Quotation</Th>
            <Th>Project</Th>
            <Th>Client</Th>
            <Th>Status</Th>
            <Th numeric>Order Value</Th>
            <Th numeric>Advance</Th>
            <Th>Dispatch Date</Th>
            <Th numeric>Progress</Th>
            <Th>Mail</Th>
          </Tr>
        </THead>
        <TBody>
          {filtered.length === 0 && (
            <Tr>
              <Td colSpan={9}>
                <p className="py-4 text-center text-sm text-ink-soft">No projects found.</p>
              </Td>
            </Tr>
          )}
          {filtered.map((p) => {
            const isDelayed =
              p.status === "Active" &&
              p.committed_dispatch_date &&
              new Date(p.committed_dispatch_date) < today;

            const displayStatus = p.status === "Active" && isDelayed ? "Delayed" : p.status;
            const badgeTone = BADGE_TONE[displayStatus] ?? "neutral";

            return (
              <Tr key={p.id}>
                <Td>
                  <span className="font-mono text-xs">{p.quotation_no}</span>
                </Td>
                <Td>{p.project_name || "—"}</Td>
                <Td>{p.client_name || "—"}</Td>
                <Td>
                  <Badge tone={badgeTone}>{displayStatus}</Badge>
                </Td>
                <Td numeric>{fmt(p.order_value)}</Td>
                <Td numeric>
                  {p.advance_received != null ? `${p.advance_received}%` : "—"}
                </Td>
                <Td>
                  {p.committed_dispatch_date ? (
                    <span className={isDelayed ? "font-medium text-rose-600" : ""}>
                      {new Date(p.committed_dispatch_date).toLocaleDateString("en-IN")}
                    </span>
                  ) : (
                    "—"
                  )}
                </Td>
                <Td numeric>
                  <div className="flex items-center gap-2">
                    <div className="w-20">
                      <ProgressBar
                        label=""
                        showLabel={false}
                        percent={p.progress_pct}
                        tone={PROGRESS_TONE(p.progress_pct)}
                      />
                    </div>
                    <span className="w-8 text-right text-xs text-ink-soft">{p.progress_pct}%</span>
                  </div>
                </Td>
                <Td>
                  <MailButton
                    projectContext={{
                      quotation_no: p.quotation_no,
                      project_name: p.project_name || "",
                      client_name: p.client_name,
                      status: p.status,
                      target_date: p.target_date,
                    }}
                  />
                </Td>
              </Tr>
            );
          })}
        </TBody>
      </Table>
    </div>
  );
}
