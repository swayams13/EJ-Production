"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { apiFetch } from "@/lib/api";
import { Card, CardHeader, CardBody, Badge, Spinner, EmptyState } from "@/components/ui";

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
    target_feet: number; actual_feet: number; efficiency_pct: number; days_worked: number;
  };
  today: {
    id: number; project: string; process_type: string;
    target_feet: number; actual_feet?: number; status: string; is_overtime: boolean;
  }[];
  daily_feet: { date: string; feet: number }[];
  monthly_feet: { month: string; feet: number }[];
  daily_steps: { date: string; steps: number }[];
}

const ATT_COLOR: Record<string, string> = {
  Present: "bg-success",
  Overtime: "bg-brand",
  Absent: "bg-critical",
  Leave: "bg-warning",
};

const WELDER_SKILLS = ["TIG Welder", "MIG Welder", "Grinder"];

function BarChart({ items, maxVal, color = "bg-brand" }: {
  items: { label: string; value: number }[];
  maxVal: number;
  color?: string;
}) {
  if (items.length === 0) return null;
  return (
    <div className="flex items-end gap-1 overflow-x-auto pb-8" style={{ minHeight: "120px" }}>
      {items.map(({ label, value }) => {
        const h = maxVal > 0 ? Math.round((value / maxVal) * 96) : 0;
        return (
          <div key={label} className="flex flex-col items-center gap-0.5 flex-shrink-0" style={{ minWidth: "18px" }}>
            {value > 0 && <span className="font-data text-[9px] text-ink-soft">{Math.round(value)}</span>}
            <div title={`${label}: ${value}`} className={`w-4 rounded-t-sm ${color} transition-all`} style={{ height: `${Math.max(h, value > 0 ? 3 : 0)}px` }} />
            <span className="font-data text-[9px] text-ink-soft mt-1" style={{ writingMode: "vertical-rl", transform: "rotate(180deg)", maxHeight: "32px" }}>
              {label}
            </span>
          </div>
        );
      })}
    </div>
  );
}

export default function WorkerDashboard() {
  const params = useParams();
  const [period, setPeriod] = useState<Period>("month");
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  useEffect(() => {
    setLoading(true);
    setError(false);
    apiFetch(`${API}/api/v1/users/${params.id}/dashboard?period=${period}`)
      .then((r) => r.json())
      .then((d) => { setData(d); setLoading(false); })
      .catch(() => { setError(true); setLoading(false); });
  }, [params.id, period]);

  if (loading) return <div className="flex justify-center p-16"><Spinner label="Loading profile…" /></div>;
  if (error || !data) return <div className="p-16"><EmptyState title="Could not load profile" description="Worker not found or you don't have access." /></div>;

  const { profile, attendance, work_orders, today, daily_feet, monthly_feet, daily_steps } = data;
  const isWelder = WELDER_SKILLS.includes(profile.skill || "") || daily_feet.length > 0;

  const maxDailyFeet = Math.max(...daily_feet.map((d) => d.feet), 1);
  const maxMonthlyFeet = Math.max(...monthly_feet.map((m) => m.feet), 1);
  const maxDailySteps = Math.max(...daily_steps.map((d) => d.steps), 1);
  const totalSteps = daily_steps.reduce((s, d) => s + d.steps, 0);

  const effColor =
    work_orders.efficiency_pct >= 90 ? "text-success"
    : work_orders.efficiency_pct >= 70 ? "text-warning"
    : work_orders.efficiency_pct > 0 ? "text-critical"
    : "text-ink";

  return (
    <div className="max-w-5xl">
      {/* Back nav */}
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

        {/* Period toggle */}
        <div className="flex gap-1 self-start rounded border border-line bg-paper-raised p-1">
          {(["month", "quarter", "year"] as Period[]).map((p) => (
            <button
              key={p}
              onClick={() => setPeriod(p)}
              className={`rounded px-3 py-1 text-sm font-semibold capitalize transition-colors ${
                period === p ? "bg-ink text-white" : "text-ink-soft hover:text-ink"
              }`}
            >
              {p === "month" ? "Month" : p === "quarter" ? "Quarter" : "Year"}
            </button>
          ))}
        </div>
      </div>

      {/* KPI cards */}
      <div className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Card>
          <CardBody className="p-4">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-ink-soft">Attendance</p>
            <p className={`font-data mt-1 text-3xl font-bold ${attendance.rate_pct >= 85 ? "text-success" : attendance.rate_pct >= 70 ? "text-warning" : "text-critical"}`}>
              {attendance.rate_pct}%
            </p>
            <p className="mt-1 text-xs text-ink-soft">{attendance.present + attendance.overtime} of {attendance.total_days} days</p>
          </CardBody>
        </Card>

        <Card>
          <CardBody className="p-4">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-ink-soft">Efficiency</p>
            <p className={`font-data mt-1 text-3xl font-bold ${effColor}`}>{work_orders.efficiency_pct}%</p>
            <p className="mt-1 text-xs text-ink-soft">{work_orders.actual_feet} / {work_orders.target_feet} ft</p>
          </CardBody>
        </Card>

        <Card>
          <CardBody className="p-4">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-ink-soft">
              {isWelder ? "Total Footage" : "Steps Done"}
            </p>
            <p className="font-data mt-1 text-3xl font-bold text-ink">
              {isWelder ? `${work_orders.actual_feet}` : totalSteps}
            </p>
            <p className="mt-1 text-xs text-ink-soft">
              {isWelder ? "ft welded" : "process steps"} · {work_orders.completed} WOs done
            </p>
          </CardBody>
        </Card>

        <Card>
          <CardBody className="p-4">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-ink-soft">Work Orders</p>
            <p className="font-data mt-1 text-3xl font-bold text-ink">{work_orders.total}</p>
            <p className="mt-1 text-xs text-ink-soft">
              <span className="text-success">{work_orders.completed} done</span>
              {work_orders.blocked > 0 && <> · <span className="text-critical">{work_orders.blocked} blocked</span></>}
            </p>
          </CardBody>
        </Card>
      </div>

      {/* Attendance + Today's orders */}
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
                  <Badge tone={tone as "success" | "neutral" | "critical" | "warning"}>{label}</Badge>
                </div>
              ))}
            </div>

            {/* Attendance strip */}
            {attendance.strip.length > 0 ? (
              <div>
                <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-ink-soft">Daily log</p>
                <div className="flex flex-wrap gap-1">
                  {attendance.strip.map(({ date: d, status }) => (
                    <div
                      key={d}
                      title={`${d}: ${status}`}
                      className={`h-3 w-3 rounded-sm ${ATT_COLOR[status] || "bg-line"}`}
                    />
                  ))}
                </div>
                <div className="mt-2 flex flex-wrap gap-3">
                  {Object.entries(ATT_COLOR).map(([s, c]) => (
                    <span key={s} className="flex items-center gap-1 text-[10px] text-ink-soft">
                      <span className={`h-2.5 w-2.5 rounded-sm ${c}`} /> {s}
                    </span>
                  ))}
                </div>
              </div>
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
                {today.map((wo) => {
                  const pct = wo.target_feet > 0 ? Math.min(((wo.actual_feet || 0) / wo.target_feet) * 100, 100) : 0;
                  return (
                    <div key={wo.id} className="rounded border border-line p-3">
                      <div className="mb-1 flex items-center justify-between gap-2">
                        <span className="font-semibold text-sm text-ink truncate">{wo.project}</span>
                        <div className="flex items-center gap-1.5 flex-shrink-0">
                          {wo.is_overtime && <Badge tone="warning">OT</Badge>}
                          <Badge tone={wo.status === "Completed" ? "success" : wo.status === "Blocked" ? "critical" : "neutral"}>
                            {wo.status}
                          </Badge>
                        </div>
                      </div>
                      <div className="flex flex-wrap gap-3 text-xs text-ink-soft mb-2">
                        <span>{wo.process_type}</span>
                        <span>Target: <strong className="text-ink">{wo.target_feet} ft</strong></span>
                        {wo.actual_feet != null && (
                          <span>Done: <strong className="text-brand">{wo.actual_feet} ft</strong></span>
                        )}
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

      {/* Daily output chart */}
      {(isWelder ? daily_feet.length : daily_steps.length) > 0 && (
        <Card className="mb-6">
          <CardHeader title={isWelder ? "Daily Footage" : "Daily Steps Completed"} />
          <CardBody className="p-5">
            <BarChart
              items={
                isWelder
                  ? daily_feet.map((d) => ({ label: d.date.slice(5), value: d.feet }))
                  : daily_steps.map((d) => ({ label: d.date.slice(5), value: d.steps }))
              }
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

      {isWelder && daily_feet.length === 0 && daily_steps.length === 0 && (
        <Card>
          <CardBody className="p-8">
            <EmptyState title="No output data" description="No welding footage or production steps logged in this period." />
          </CardBody>
        </Card>
      )}
    </div>
  );
}
