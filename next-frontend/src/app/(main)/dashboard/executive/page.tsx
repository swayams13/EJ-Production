"use client";
import { apiFetch } from "@/lib/api";
import { useState, useEffect } from "react";
import { MetricCard, ProgressBar, Badge, Spinner, Table, THead, TBody, Tr, Th, Td } from "@/components/ui";
import MailButton from "@/components/MailButton";
import Donut from "@/components/charts/Donut";
import { HorizontalBarChart, StackedTrendChart } from "@/components/charts/BarChart";

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

interface ProductionBucket {
  tig_feet: number;
  mig_feet: number;
  grinding_feet: number;
  total_feet: number;
  entries: number;
}

interface TrendDay {
  date: string;
  tig_feet: number;
  mig_feet: number;
  grinding_feet: number;
}

interface TodayAllotted {
  project_id: number;
  quotation_no: string;
  project_name: string | null;
  process_type: string;
  target_feet: number;
  actual_feet: number;
  pct: number;
  status: string;
}

interface ActivityItem {
  timestamp: string;
  actor_name: string;
  actor_role: string;
  action: string;
  detail: string;
  project_ref: string | null;
}

interface LeaderboardRow {
  user_id: number;
  full_name: string;
  role: string;
  entries_yesterday: number;
  entries_7d: number;
}

interface RoleKpis {
  pm: {
    pos_raised: number;
    goods_receipts: number;
    completion_requests_submitted: number;
    projects_on_time_pct: number;
  };
  gm: {
    completions_approved: number;
    completions_rejected: number;
    holds_total: number;
    resumes_total: number;
    projects_on_time_pct: number;
  };
}

interface MaterialRisk {
  material_name: string;
  size: number | null;
  joint_type: string | null;
  net_gap: number;
  projects: string[];
}

interface Briefing {
  production: { yesterday: ProductionBucket; last_7d: ProductionBucket; trend_14d: TrendDay[] };
  today_allotted: TodayAllotted[];
  activity: ActivityItem[];
  materials: { projects_blocked: number; top_risks: MaterialRisk[] };
  people: { leaderboard: LeaderboardRow[]; by_role: RoleKpis };
}

interface ProductivityRow {
  user_id: number;
  worker_name: string;
  process_type: string;
  target_feet: number;
  actual_feet: number;
  efficiency_pct: number;
  days_worked: number;
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

const STATUS_DONUT_COLOR: Record<string, string> = {
  Active: "#5c6864",
  Delayed: "#b2594a",
  Hold: "#bd8a52",
  Completed: "#5c8a6c",
};

const PROGRESS_TONE: (pct: number) => "success" | "warning" | "critical" = (pct) =>
  pct >= 80 ? "success" : pct >= 40 ? "warning" : "critical";

const TABS = ["briefing", "people", "projects"] as const;
type Tab = (typeof TABS)[number];
const TAB_LABELS: Record<Tab, string> = {
  briefing: "📋 Briefing",
  people: "👥 People & KPIs",
  projects: "📊 Projects",
};

function toISODate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export default function ExecutiveDashboard() {
  const [tab, setTab] = useState<Tab>("briefing");
  const [kpis, setKpis] = useState<Kpis | null>(null);
  const [projects, setProjects] = useState<ProjectRow[]>([]);
  const [briefing, setBriefing] = useState<Briefing | null>(null);
  const [productivity, setProductivity] = useState<ProductivityRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<"all" | "active" | "delayed" | "completed">("all");

  useEffect(() => {
    const today = new Date();
    const weekAgo = new Date(today);
    weekAgo.setDate(weekAgo.getDate() - 7);

    Promise.all([
      apiFetch(`${API}/api/v1/dashboard/executive`).then((r) => r.json()),
      apiFetch(`${API}/api/v1/dashboard/executive-briefing`).then((r) => r.json()),
      apiFetch(
        `${API}/api/v1/scheduler/productivity?from_date=${toISODate(weekAgo)}&to_date=${toISODate(today)}`
      ).then((r) => r.json()),
    ])
      .then(([execData, briefingData, productivityData]) => {
        setKpis(execData.kpis);
        setProjects(execData.projects);
        setBriefing(briefingData);
        setProductivity(productivityData);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  if (loading) return <Spinner label="Loading executive view…" />;
  if (!kpis || !briefing) return <p className="text-ink-soft text-sm">Failed to load data.</p>;

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

  const statusSlices = [
    { label: "Active", value: kpis.total_active - kpis.delayed, color: STATUS_DONUT_COLOR.Active },
    { label: "Delayed", value: kpis.delayed, color: STATUS_DONUT_COLOR.Delayed },
    { label: "Hold", value: kpis.total_on_hold, color: STATUS_DONUT_COLOR.Hold },
    { label: "Completed", value: kpis.total_completed, color: STATUS_DONUT_COLOR.Completed },
  ].filter((s) => s.value > 0);

  const processSlices = [
    { label: "TIG", value: briefing.production.last_7d.tig_feet, color: "#2a78d6" },
    { label: "MIG", value: briefing.production.last_7d.mig_feet, color: "#008300" },
    { label: "Grinding", value: briefing.production.last_7d.grinding_feet, color: "#eda100" },
  ].filter((s) => s.value > 0);

  return (
    <div className="flex flex-col gap-8">
      <div>
        <h1 className="font-display text-3xl font-extrabold uppercase tracking-wide text-ink">
          Executive Dashboard
        </h1>
        <p className="text-ink-soft">
          Good morning — {today.toLocaleDateString("en-IN", { weekday: "long", day: "numeric", month: "long" })}
        </p>
      </div>

      <div className="flex gap-2 border-b border-line">
        {TABS.map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={
              tab === t
                ? "border-b-2 border-brand px-4 py-2 text-sm font-semibold text-brand"
                : "border-b-2 border-transparent px-4 py-2 text-sm font-semibold text-ink-soft hover:text-ink"
            }
          >
            {TAB_LABELS[t]}
          </button>
        ))}
      </div>

      {tab === "briefing" && (
        <div className="flex flex-col gap-8">
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-5">
            <MetricCard label="Feet Yesterday" value={Math.round(briefing.production.yesterday.total_feet)} tone="neutral" />
            <MetricCard label="Feet Last 7 Days" value={Math.round(briefing.production.last_7d.total_feet)} tone="neutral" />
            <MetricCard label="Entries Yesterday" value={briefing.production.yesterday.entries} tone="neutral" />
            <MetricCard
              label="Today's Target Feet"
              value={Math.round(briefing.today_allotted.reduce((s, w) => s + w.target_feet, 0))}
              tone="neutral"
            />
            <MetricCard
              label="Projects Blocked on Material"
              value={briefing.materials.projects_blocked}
              tone={briefing.materials.projects_blocked > 0 ? "critical" : "neutral"}
            />
          </div>

          <div>
            <h2 className="mb-3 font-display text-lg font-bold uppercase tracking-wide text-ink">
              Today&apos;s Allotted Work
            </h2>
            <Table>
              <THead>
                <Tr>
                  <Th>Project</Th>
                  <Th>Process</Th>
                  <Th numeric>Target Feet</Th>
                  <Th numeric>Actual Feet</Th>
                  <Th numeric>Progress</Th>
                  <Th>Status</Th>
                </Tr>
              </THead>
              <TBody>
                {briefing.today_allotted.length === 0 && (
                  <Tr>
                    <Td colSpan={6}>
                      <p className="py-4 text-center text-sm text-ink-soft">No work orders scheduled today.</p>
                    </Td>
                  </Tr>
                )}
                {briefing.today_allotted.map((w, i) => (
                  <Tr key={i}>
                    <Td>{w.quotation_no}</Td>
                    <Td>{w.process_type}</Td>
                    <Td numeric>{w.target_feet}</Td>
                    <Td numeric>{w.actual_feet}</Td>
                    <Td numeric>{w.pct}%</Td>
                    <Td>
                      <Badge tone={w.status === "Completed" ? "success" : w.status === "Blocked" ? "critical" : "neutral"}>
                        {w.status}
                      </Badge>
                    </Td>
                  </Tr>
                ))}
              </TBody>
            </Table>
          </div>

          <div>
            <h2 className="mb-3 font-display text-lg font-bold uppercase tracking-wide text-ink">
              Material Risk
            </h2>
            {briefing.materials.top_risks.length === 0 ? (
              <p className="text-sm text-ink-soft">No material shortages blocking projects.</p>
            ) : (
              <div className="flex flex-col divide-y divide-line">
                {briefing.materials.top_risks.map((r, i) => (
                  <div key={i} className="flex items-start justify-between gap-4 py-2.5">
                    <div>
                      <span className="font-semibold text-ink">
                        {r.material_name}
                        {r.size ? ` — ${r.size}mm` : ""}
                        {r.joint_type ? ` (${r.joint_type})` : ""}
                      </span>
                      <p className="text-sm text-ink-soft">{r.projects.join(", ")}</p>
                    </div>
                    <Badge tone="critical">Gap: {r.net_gap}</Badge>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="grid grid-cols-1 gap-8 lg:grid-cols-2">
            <div>
              <h2 className="mb-3 font-display text-lg font-bold uppercase tracking-wide text-ink">
                14-Day Production Trend
              </h2>
              <StackedTrendChart days={briefing.production.trend_14d} />
            </div>
            <div>
              <h2 className="mb-3 font-display text-lg font-bold uppercase tracking-wide text-ink">
                Process Split (7d)
              </h2>
              {processSlices.length > 0 ? (
                <Donut slices={processSlices} />
              ) : (
                <p className="text-sm text-ink-soft">No production logged in the last 7 days.</p>
              )}
            </div>
          </div>

          <div>
            <h2 className="mb-3 font-display text-lg font-bold uppercase tracking-wide text-ink">Activity Feed</h2>
            <div className="flex flex-col divide-y divide-line">
              {briefing.activity.length === 0 && <p className="py-4 text-sm text-ink-soft">No recent activity.</p>}
              {briefing.activity.map((a, i) => (
                <div key={i} className="flex items-start justify-between gap-4 py-2.5">
                  <div>
                    <span className="font-semibold text-ink">{a.actor_name}</span>
                    <span className="ml-1.5 text-xs uppercase tracking-wide text-ink-soft">{a.actor_role}</span>
                    <p className="text-sm text-ink-soft">{a.detail}</p>
                  </div>
                  <span className="shrink-0 whitespace-nowrap text-xs text-ink-soft">
                    {new Date(a.timestamp).toLocaleString("en-IN", {
                      day: "numeric",
                      month: "short",
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {tab === "people" && (
        <div className="flex flex-col gap-8">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="rounded-xl border border-line bg-paper-raised p-5">
              <h3 className="mb-3 font-display text-sm font-bold uppercase tracking-wide text-ink-soft">
                Production Manager
              </h3>
              <div className="grid grid-cols-2 gap-3 text-sm">
                <span className="text-ink-soft">POs Raised</span>
                <span className="text-right font-data tabular-nums text-ink">{briefing.people.by_role.pm.pos_raised}</span>
                <span className="text-ink-soft">Goods Receipts</span>
                <span className="text-right font-data tabular-nums text-ink">{briefing.people.by_role.pm.goods_receipts}</span>
                <span className="text-ink-soft">Completions Submitted</span>
                <span className="text-right font-data tabular-nums text-ink">
                  {briefing.people.by_role.pm.completion_requests_submitted}
                </span>
                <span className="text-ink-soft">Projects On-Time %</span>
                <span className="text-right font-data tabular-nums text-ink">{briefing.people.by_role.pm.projects_on_time_pct}%</span>
              </div>
            </div>
            <div className="rounded-xl border border-line bg-paper-raised p-5">
              <h3 className="mb-3 font-display text-sm font-bold uppercase tracking-wide text-ink-soft">GM (SJM)</h3>
              <div className="grid grid-cols-2 gap-3 text-sm">
                <span className="text-ink-soft">Completions Approved</span>
                <span className="text-right font-data tabular-nums text-ink">{briefing.people.by_role.gm.completions_approved}</span>
                <span className="text-ink-soft">Completions Rejected</span>
                <span className="text-right font-data tabular-nums text-ink">{briefing.people.by_role.gm.completions_rejected}</span>
                <span className="text-ink-soft">Projects Held / Resumed</span>
                <span className="text-right font-data tabular-nums text-ink">
                  {briefing.people.by_role.gm.holds_total} / {briefing.people.by_role.gm.resumes_total}
                </span>
                <span className="text-ink-soft">Projects On-Time %</span>
                <span className="text-right font-data tabular-nums text-ink">{briefing.people.by_role.gm.projects_on_time_pct}%</span>
              </div>
            </div>
          </div>

          <div>
            <h2 className="mb-3 font-display text-lg font-bold uppercase tracking-wide text-ink">
              Entry Leaderboard (Last 7 Days)
            </h2>
            {briefing.people.leaderboard.length > 0 ? (
              <HorizontalBarChart
                bars={briefing.people.leaderboard.slice(0, 10).map((r) => ({ label: r.full_name, value: r.entries_7d }))}
              />
            ) : (
              <p className="text-sm text-ink-soft">No entries logged in the last 7 days.</p>
            )}
          </div>

          <div>
            <h2 className="mb-3 font-display text-lg font-bold uppercase tracking-wide text-ink">
              Worker Efficiency (Last 7 Days)
            </h2>
            {productivity.length > 0 ? (
              <HorizontalBarChart
                bars={productivity
                  .slice()
                  .sort((a, b) => b.efficiency_pct - a.efficiency_pct)
                  .map((r) => ({
                    label: `${r.worker_name} (${r.process_type})`,
                    value: r.efficiency_pct,
                    color: r.efficiency_pct >= 80 ? "#5c8a6c" : r.efficiency_pct >= 40 ? "#bd8a52" : "#b2594a",
                  }))}
                maxValue={100}
                valueFormat={(v) => `${Math.round(v)}%`}
              />
            ) : (
              <p className="text-sm text-ink-soft">No productivity data for the last 7 days.</p>
            )}
          </div>
        </div>
      )}

      {tab === "projects" && (
        <div className="flex flex-col gap-8">
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6">
            <MetricCard label="Active Projects" value={String(kpis.total_active)} tone="neutral" />
            <MetricCard label="Pipeline Value" value={fmt(kpis.pipeline_value)} tone="neutral" />
            <MetricCard label="On Time" value={String(kpis.on_time)} tone="success" />
            <MetricCard label="Delayed" value={String(kpis.delayed)} tone="critical" />
            <MetricCard label="On Hold" value={String(kpis.total_on_hold)} tone="warning" />
            <MetricCard label="Completed" value={String(kpis.total_completed)} tone="neutral" />
          </div>

          <div className="max-w-xs">
            <Donut slices={statusSlices} size={120} />
          </div>

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
                    <Td numeric>{p.advance_received != null ? `${p.advance_received}%` : "—"}</Td>
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
      )}
    </div>
  );
}
