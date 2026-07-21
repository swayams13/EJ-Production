"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { apiFetch } from "@/lib/api";
import { Card, CardHeader, CardBody, Badge, Spinner, EmptyState, Table, THead, TBody, Tr, Th, Td } from "@/components/ui";

const API = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8003";
type Period = "month" | "quarter" | "year";

interface DashboardData {
  profile: {
    id: number; name: string; role: string; skill?: string;
    department?: string; experience?: string; base_productivity?: number;
  };
  period: { from: string; to: string; label: string };
  attendance: {
    total_days: number; present: number; overtime: number;
    absent: number; leave: number; rate_pct: number;
    strip: { date: string; status: string }[];
  };
  work_orders: {
    total: number; completed: number; pending: number; blocked: number;
    target_feet: number; actual_feet: number; efficiency_pct: number;
    days_worked: number; avg_ft_per_day: number; on_time_pct: number;
    overtime_days: number; reliability_pct: number;
  };
  process_split: { process: string; feet: number }[];
  projects: { quotation_no: string; project_name: string; feet: number; orders: number }[];
  today: {
    id: number; project: string; process_type: string;
    target_feet: number; actual_feet?: number; status: string; is_overtime: boolean;
  }[];
  daily_feet: { date: string; feet: number }[];
  monthly_feet: { month: string; feet: number }[];
  daily_steps: { date: string; steps: number }[];
}

const ATT_COLOR: Record<string, string> = {
  Present: "bg-success", Overtime: "bg-brand", Absent: "bg-critical", Leave: "bg-warning",
};
const PROCESS_COLOR: Record<string, string> = {
  TIG: "bg-brand", MIG: "bg-success", Grinding: "bg-warning",
};
const WELDER_SKILLS = ["TIG Welder", "MIG Welder", "Grinder"];

function KpiCard({ label, value, sub, color = "text-ink" }: { label: string; value: string; sub?: string; color?: string }) {
  return (
    <Card>
      <CardBody className="p-4">
        <p className="text-[11px] font-semibold uppercase tracking-wider text-ink-soft">{label}</p>
        <p className={`font-data mt-1 text-3xl font-bold ${color}`}>{value}</p>
        {sub && <p className="mt-1 text-xs text-ink-soft">{sub}</p>}
      </CardBody>
    </Card>
  );
}

function BarChart({ items, maxVal, color = "bg-brand" }: {
  items: { label: string; value: number }[]; maxVal: number; color?: string;
}) {
  if (!items.length) return null;
  return (
    <div className="flex items-end gap-1 overflow-x-auto pb-8" style={{ minHeight: "120px" }}>
      {items.map(({ label, value }) => {
        const h = maxVal > 0 ? Math.round((value / maxVal) * 96) : 0;
        return (
          <div key={label} className="flex flex-col items-center gap-0.5 flex-shrink-0" style={{ minWidth: "18px" }}>
            {value > 0 && <span className="font-data text-[9px] text-ink-soft">{Math.round(value)}</span>}
            <div title={`${label}: ${value}`} className={`w-4 rounded-t-sm ${color}`} style={{ height: `${Math.max(h, value > 0 ? 3 : 0)}px` }} />
            <span className="font-data text-[9px] text-ink-soft mt-1" style={{ writingMode: "vertical-rl", transform: "rotate(180deg)", maxHeight: "32px" }}>
              {label}
            </span>
          </div>
        );
      })}
    </div>
  );
}

function scoreColor(pct: number) {
  return pct >= 90 ? "text-success" : pct >= 70 ? "text-warning" : pct > 0 ? "text-critical" : "text-ink";
}

export default function WorkerDashboard() {
  const params = useParams();
  const [period, setPeriod] = useState<Period>("month");
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  useEffect(() => {
    setLoading(true); setError(false);
    apiFetch(`${API}/api/v1/users/${params.id}/dashboard?period=${period}`)
      .then((r) => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); })
      .then((d) => { setData(d); setLoading(false); })
      .catch(() => { setError(true); setLoading(false); });
  }, [params.id, period]);

  if (loading) return <div className="flex justify-center p-16"><Spinner label="Loading profile…" /></div>;
  if (error || !data) return <div className="p-16"><EmptyState title="Could not load profile" description="Worker not found or you don't have access." /></div>;

  const { profile, attendance, work_orders: wo, today, daily_feet, monthly_feet, daily_steps } = data;
  const process_split = data.process_split ?? [];
  const projects = data.projects ?? [];
  const isWelder = WELDER_SKILLS.includes(profile.skill || "") || daily_feet.length > 0;
  const maxDailyFeet = Math.max(...daily_feet.map((d) => d.feet), 1);
  const maxMonthlyFeet = Math.max(...monthly_feet.map((m) => m.feet), 1);
  const maxDailySteps = Math.max(...daily_steps.map((d) => d.steps), 1);
  const totalSteps = daily_steps.reduce((s, d) => s + d.steps, 0);
  const maxProjectFeet = Math.max(...projects.map((p) => p.feet), 1);

  return (
    <div className="max-w-5xl">
      <Link href="/workforce" className="text-sm text-brand hover:underline">← Back to Workforce</Link>

      {/* Header */}
      <div className="mt-4 mb-6 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="font-display text-3xl font-extrabold uppercase tracking-wide text-ink">{profile.name}</h1>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <Badge tone="neutral">{profile.role}</Badge>
            {profile.skill && <Badge tone="neutral">{profile.skill}</Badge>}
            {profile.department && <span className="text-sm text-ink-soft">{profile.department}</span>}
            {profile.experience && <span className="text-sm text-ink-soft">· {profile.experience} exp.</span>}
            {profile.base_productivity && (
              <span className="font-data text-sm text-ink-soft">· {profile.base_productivity} ft/day target</span>
            )}
          </div>
        </div>
        <div className="flex gap-1 self-start rounded border border-line bg-paper-raised p-1">
          {(["month", "quarter", "year"] as Period[]).map((p) => (
            <button key={p} onClick={() => setPeriod(p)}
              className={`rounded px-3 py-1 text-sm font-semibold capitalize transition-colors ${period === p ? "bg-ink text-white" : "text-ink-soft hover:text-ink"}`}>
              {p === "month" ? "Month" : p === "quarter" ? "Quarter" : "Year"}
            </button>
          ))}
        </div>
      </div>

      {/* Row 1 — core KPIs */}
      <div className="mb-4 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <KpiCard label="Attendance" value={`${attendance.rate_pct}%`}
          sub={`${attendance.present + attendance.overtime} of ${attendance.total_days} days`}
          color={scoreColor(attendance.rate_pct)} />
        <KpiCard label="Efficiency" value={`${wo.efficiency_pct}%`}
          sub={`${wo.actual_feet} / ${wo.target_feet} ft`}
          color={scoreColor(wo.efficiency_pct)} />
        <KpiCard label={isWelder ? "Total Footage" : "Steps Done"}
          value={isWelder ? `${wo.actual_feet} ft` : `${totalSteps}`}
          sub={`${wo.completed} work orders done`} />
        <KpiCard label="Reliability" value={`${wo.reliability_pct}%`}
          sub="attendance + efficiency blend"
          color={scoreColor(wo.reliability_pct)} />
      </div>

      {/* Row 2 — secondary KPIs */}
      <div className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <KpiCard label="Avg Footage / Day" value={isWelder ? `${wo.avg_ft_per_day} ft` : "—"}
          sub={`over ${wo.days_worked} days worked`} />
        <KpiCard label="On-time Completion" value={`${wo.on_time_pct}%`}
          sub={`${wo.completed} of ${wo.total} orders`}
          color={scoreColor(wo.on_time_pct)} />
        <KpiCard label="Overtime Days" value={`${wo.overtime_days}`}
          sub={`of ${attendance.total_days} recorded days`} />
        <KpiCard label="Work Orders" value={`${wo.total}`}
          sub={`${wo.pending} pending · ${wo.blocked > 0 ? `${wo.blocked} blocked` : "none blocked"}`} />
      </div>

      {/* Attendance + Today */}
      <div className="mb-6 grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader title="Attendance Breakdown" />
          <CardBody className="p-5">
            <div className="mb-4 grid grid-cols-4 gap-2 text-center">
              {[
                { label: "Present", value: attendance.present, tone: "success" },
                { label: "Overtime", value: attendance.overtime, tone: "neutral" },
                { label: "Absent", value: attendance.absent, tone: "critical" },
                { label: "Leave", value: attendance.leave, tone: "warning" },
              ].map(({ label, value, tone }) => (
                <div key={label}>
                  <p className="font-data text-2xl font-bold text-ink">{value}</p>
                  <Badge tone={tone as any}>{label}</Badge>
                </div>
              ))}
            </div>
            {attendance.strip.length > 0 ? (
              <>
                <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-ink-soft">Daily log</p>
                <div className="flex flex-wrap gap-1">
                  {attendance.strip.map(({ date: d, status }) => (
                    <div key={d} title={`${d}: ${status}`} className={`h-3 w-3 rounded-sm ${ATT_COLOR[status] || "bg-line"}`} />
                  ))}
                </div>
                <div className="mt-2 flex flex-wrap gap-3">
                  {Object.entries(ATT_COLOR).map(([s, c]) => (
                    <span key={s} className="flex items-center gap-1 text-[10px] text-ink-soft">
                      <span className={`h-2.5 w-2.5 rounded-sm ${c}`} /> {s}
                    </span>
                  ))}
                </div>
              </>
            ) : (
              <p className="text-xs text-ink-soft">No attendance records in this period.</p>
            )}
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="Today's Work Orders" />
          <CardBody className="p-5">
            {today.length === 0 ? (
              <p className="text-sm text-ink-soft">No work orders assigned for today.</p>
            ) : (
              <div className="flex flex-col gap-3">
                {today.map((item) => {
                  const pct = item.target_feet > 0 ? Math.min(((item.actual_feet || 0) / item.target_feet) * 100, 100) : 0;
                  return (
                    <div key={item.id} className="rounded border border-line p-3">
                      <div className="mb-1 flex items-center justify-between gap-2">
                        <span className="truncate font-semibold text-sm text-ink">{item.project}</span>
                        <div className="flex flex-shrink-0 items-center gap-1.5">
                          {item.is_overtime && <Badge tone="warning">OT</Badge>}
                          <Badge tone={item.status === "Completed" ? "success" : item.status === "Blocked" ? "critical" : "neutral"}>
                            {item.status}
                          </Badge>
                        </div>
                      </div>
                      <div className="mb-2 flex flex-wrap gap-3 text-xs text-ink-soft">
                        <span>{item.process_type}</span>
                        <span>Target: <strong className="text-ink">{item.target_feet} ft</strong></span>
                        {item.actual_feet != null && <span>Done: <strong className="text-brand">{item.actual_feet} ft</strong></span>}
                      </div>
                      <div className="h-1.5 w-full overflow-hidden rounded-full bg-line">
                        <div className="h-full rounded-full bg-brand transition-all" style={{ width: `${pct}%` }} />
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </CardBody>
        </Card>
      </div>

      {/* Process split + Project contribution */}
      <div className="mb-6 grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* Process split */}
        <Card>
          <CardHeader title="Process Type Split" />
          <CardBody className="p-5">
            {process_split.length === 0 ? (
              <p className="text-sm text-ink-soft">No welding logs in this period.</p>
            ) : (
              <div className="flex flex-col gap-3">
                {process_split.map(({ process, feet }) => {
                  const pct = Math.round((feet / (wo.actual_feet || 1)) * 100);
                  return (
                    <div key={process}>
                      <div className="mb-1 flex items-center justify-between text-sm">
                        <span className="font-semibold text-ink">{process}</span>
                        <span className="font-data text-ink-soft">{feet} ft <span className="text-ink-soft">({pct}%)</span></span>
                      </div>
                      <div className="h-2 w-full overflow-hidden rounded-full bg-line">
                        <div className={`h-full rounded-full ${PROCESS_COLOR[process] || "bg-brand"} transition-all`} style={{ width: `${pct}%` }} />
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </CardBody>
        </Card>

        {/* Project contribution */}
        <Card>
          <CardHeader title="Project Contribution" />
          <CardBody className="p-0">
            {projects.length === 0 ? (
              <div className="p-5"><p className="text-sm text-ink-soft">No project data in this period.</p></div>
            ) : (
              <Table>
                <THead>
                  <Tr>
                    <Th>Project</Th>
                    <Th numeric>Orders</Th>
                    <Th numeric>Footage</Th>
                    <Th numeric>Share</Th>
                  </Tr>
                </THead>
                <TBody>
                  {projects.map((p) => (
                    <Tr key={p.quotation_no}>
                      <Td>
                        <p className="font-semibold text-sm text-ink">{p.quotation_no}</p>
                        {p.project_name && p.project_name !== p.quotation_no && (
                          <p className="text-xs text-ink-soft truncate max-w-[140px]">{p.project_name}</p>
                        )}
                      </Td>
                      <Td numeric className="text-ink-soft">{p.orders}</Td>
                      <Td numeric className="font-data font-semibold text-ink">{p.feet} ft</Td>
                      <Td numeric>
                        <div className="flex items-center justify-end gap-2">
                          <div className="h-1.5 w-16 overflow-hidden rounded-full bg-line">
                            <div className="h-full rounded-full bg-brand" style={{ width: `${Math.round((p.feet / maxProjectFeet) * 100)}%` }} />
                          </div>
                          <span className="font-data text-xs text-ink-soft w-8 text-right">
                            {Math.round((p.feet / (wo.actual_feet || 1)) * 100)}%
                          </span>
                        </div>
                      </Td>
                    </Tr>
                  ))}
                </TBody>
              </Table>
            )}
          </CardBody>
        </Card>
      </div>

      {/* Daily output chart */}
      {(isWelder ? daily_feet.length : daily_steps.length) > 0 && (
        <Card className="mb-6">
          <CardHeader title={isWelder ? "Daily Footage" : "Daily Steps Completed"} />
          <CardBody className="p-5">
            <BarChart
              items={isWelder
                ? daily_feet.map((d) => ({ label: d.date.slice(5), value: d.feet }))
                : daily_steps.map((d) => ({ label: d.date.slice(5), value: d.steps }))}
              maxVal={isWelder ? maxDailyFeet : maxDailySteps}
            />
          </CardBody>
        </Card>
      )}

      {/* Monthly totals */}
      {monthly_feet.length > 0 && (
        <Card>
          <CardHeader title="Monthly Footage — Last 12 Months" />
          <CardBody className="p-5">
            <BarChart
              items={monthly_feet.map(({ month, feet }) => {
                const [y, m] = month.split("-");
                const label = new Date(parseInt(y), parseInt(m) - 1).toLocaleString("default", { month: "short" });
                return { label: `${label} '${y.slice(2)}`, value: feet };
              })}
              maxVal={maxMonthlyFeet}
              color="bg-brand-deep"
            />
          </CardBody>
        </Card>
      )}
    </div>
  );
}
