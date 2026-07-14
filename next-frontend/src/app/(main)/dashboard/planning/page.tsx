"use client";
import { apiFetch } from "@/lib/api";

import { useEffect, useState } from "react";
import {
  Card,
  MetricCard,
  ProgressBar,
  Alert,
  Badge,
  Spinner,
  Table,
  THead,
  TBody,
  Tr,
  Th,
  Td,
} from "@/components/ui";

interface PacingMetric {
  project_id: number;
  project_number: string;
  project_name: string;
  total_feet: number;
  remaining_feet: number;
  days_to_deadline: number | null;
  backlog: number;
  today_requirement: number;
  today_logged_ft: number;
  gap_today: number;
  tig_req: number;
  mig_req: number;
  grind_req: number;
  monthly_feet: [number, number, number];
}

interface WeekForecast {
  id: number;
  name: string;
  capacity: number;
  demand: number;
}

interface PlanningMetrics {
  weekly_target: number;
  current_load: number;
  on_time_delivery: number;
  weekly_forecast: WeekForecast[];
  monthly_forecast: unknown[];
  unscheduled_demand: number;
  factory_weekly_capacity: number;
  pacing_metrics: PacingMetric[];
}

interface ProjectRow {
  id: number;
  quotation_no: string;
  project_name?: string;
  target_date?: string;
  priority: string;
  status: string;
}

export default function PlanningDashboard() {
  const [projects, setProjects] = useState<ProjectRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [metrics, setMetrics] = useState<PlanningMetrics>({
    weekly_target: 0,
    current_load: 0,
    on_time_delivery: 100,
    weekly_forecast: [],
    monthly_forecast: [],
    unscheduled_demand: 0,
    factory_weekly_capacity: 0,
    pacing_metrics: [],
  });

  useEffect(() => {
    const fetchPlanning = () => {
      Promise.all([
        apiFetch(`${process.env.NEXT_PUBLIC_API_URL || "http://localhost:8003"}/api/v1/projects`).then((res) => res.json()),
        apiFetch(`${process.env.NEXT_PUBLIC_API_URL || "http://localhost:8003"}/api/v1/dashboard/planning`).then((res) => res.json()),
      ])
        .then(([projectsRes, metricsData]) => {
          setProjects(projectsRes.data || []);
          setMetrics(metricsData.data);
          setLoading(false);
        })
        .catch((err) => {
          console.error(err);
          setLoading(false);
        });
    };

    fetchPlanning();
    const interval = setInterval(fetchPlanning, 3000);
    return () => clearInterval(interval);
  }, []);

  const priorityTone = (priority: string) =>
    priority === "P1" ? "critical" : priority === "P2" ? "warning" : "success";

  return (
    <div className="flex flex-col gap-8">
      <div>
        <h1 className="font-display text-3xl font-extrabold uppercase tracking-wide text-ink">
          Production Planning
        </h1>
        <p className="text-ink-soft">Master schedule and active project prioritization.</p>
      </div>

      <section className="grid grid-cols-1 gap-6 md:grid-cols-3">
        <MetricCard label="Weekly Target (Units)" value={metrics.weekly_target} />
        <MetricCard label="Current Load (%)" value={metrics.current_load} tone="warning" />
        <MetricCard label="On-Time Delivery (%)" value={metrics.on_time_delivery} tone="success" />
      </section>

      <section className="flex flex-col gap-4">
        <h2 className="font-display text-lg font-bold uppercase tracking-wide text-ink">
          Daily Execution Plan (Takt Time Pacing)
        </h2>
        <Card>
          <Table>
            <THead>
              <Tr>
                <Th>Project</Th>
                <Th numeric>Total Scope</Th>
                <Th numeric>Yesterday&apos;s Backlog</Th>
                <Th numeric>TIG Today</Th>
                <Th numeric>MIG Today</Th>
                <Th numeric>Grind Today</Th>
              </Tr>
            </THead>
            <TBody>
              {!metrics.pacing_metrics || metrics.pacing_metrics.length === 0 ? (
                <Tr>
                  <Td colSpan={6} className="text-center text-ink-soft">
                    No active projects require pacing.
                  </Td>
                </Tr>
              ) : (
                metrics.pacing_metrics.map((p) => (
                  <Tr key={p.project_id}>
                    <Td className="font-bold text-ink">{p.project_number}</Td>
                    <Td numeric>{p.total_feet} ft</Td>
                    <Td numeric>
                      {p.backlog > 0 ? (
                        <Badge tone="critical">+{p.backlog} ft</Badge>
                      ) : (
                        <span className="text-xs font-medium text-ink-soft">On Track</span>
                      )}
                    </Td>
                    <Td numeric>{p.tig_req} ft</Td>
                    <Td numeric>{p.mig_req} ft</Td>
                    <Td numeric>{p.grind_req} ft</Td>
                  </Tr>
                ))
              )}
            </TBody>
          </Table>
        </Card>
      </section>

      <section className="flex flex-col gap-4">
        <h2 className="font-display text-lg font-bold uppercase tracking-wide text-ink">
          Per-Project Feet Targets (Today)
        </h2>
        <Card>
          <Table>
            <THead>
              <Tr>
                <Th>Project</Th>
                <Th numeric>Remaining Ft</Th>
                <Th numeric>Days Left</Th>
                <Th numeric>Required ft/day</Th>
                <Th numeric>Today Logged</Th>
                <Th numeric>Gap Today</Th>
              </Tr>
            </THead>
            <TBody>
              {!metrics.pacing_metrics || metrics.pacing_metrics.length === 0 ? (
                <Tr><Td colSpan={6} className="text-center text-ink-soft">No active projects.</Td></Tr>
              ) : metrics.pacing_metrics.map((p) => {
                const gap = p.gap_today;
                return (
                  <Tr key={p.project_id}>
                    <Td className="font-bold text-ink">{p.project_name}</Td>
                    <Td numeric>{p.remaining_feet} ft</Td>
                    <Td numeric>
                      {p.days_to_deadline === null ? (
                        <span className="text-xs text-warning">Unscheduled</span>
                      ) : p.days_to_deadline < 0 ? (
                        <Badge tone="critical">{Math.abs(p.days_to_deadline)}d late</Badge>
                      ) : (
                        <span className={p.days_to_deadline <= 7 ? "font-bold text-critical" : ""}>{p.days_to_deadline}d</span>
                      )}
                    </Td>
                    <Td numeric>{p.today_requirement} ft</Td>
                    <Td numeric>{p.today_logged_ft} ft</Td>
                    <Td numeric>
                      {gap > 0 ? (
                        <Badge tone="critical">-{gap} ft</Badge>
                      ) : (
                        <Badge tone="success">On Track</Badge>
                      )}
                    </Td>
                  </Tr>
                );
              })}
            </TBody>
          </Table>
        </Card>
      </section>

      <section className="flex flex-col gap-4">
        <h2 className="font-display text-lg font-bold uppercase tracking-wide text-ink">
          Month-wise Welder Demand by Project
        </h2>
        <Card>
          <Table>
            <THead>
              <Tr>
                <Th>Project</Th>
                <Th numeric>Month 1</Th>
                <Th numeric>Month 2</Th>
                <Th numeric>Month 3</Th>
              </Tr>
            </THead>
            <TBody>
              {metrics.pacing_metrics.map((p) => (
                <Tr key={p.project_id}>
                  <Td className="font-bold text-ink">{p.project_name}</Td>
                  {p.monthly_feet.map((ft, i) => (
                    <Td key={i} numeric>{ft > 0 ? `${ft} ft` : <span className="text-ink-soft">—</span>}</Td>
                  ))}
                </Tr>
              ))}
              {metrics.monthly_forecast && metrics.monthly_forecast.length > 0 && (
                <Tr className="border-t-2 border-line font-bold">
                  <Td className="font-bold text-ink">Total Demand</Td>
                  {(metrics.monthly_forecast as WeekForecast[]).map((m) => {
                    const cap = metrics.factory_weekly_capacity * 4;
                    const over = m.demand > cap;
                    return (
                      <Td key={m.id} numeric>
                        <span className={over ? "font-bold text-critical" : ""}>{m.demand} ft</span>
                      </Td>
                    );
                  })}
                </Tr>
              )}
            </TBody>
          </Table>
        </Card>
      </section>

      <section className="flex flex-col gap-4">
        <h2 className="font-display text-lg font-bold uppercase tracking-wide text-ink">
          4-Week Capacity Forecast
        </h2>
        <Card className="flex flex-col gap-5 p-6">
          {metrics.weekly_forecast &&
            metrics.weekly_forecast.map((week) => {
              const loadPct = week.capacity > 0 ? (week.demand / week.capacity) * 100 : 0;
              const isOverCapacity = loadPct > 100;
              return (
                <div key={week.id}>
                  <div className="mb-1 flex items-end justify-between">
                    <span className="text-sm font-bold text-ink">{week.name}</span>
                    <span className="font-data tabular-nums text-sm">
                      <span className={isOverCapacity ? "text-critical" : "text-ink-soft"}>{week.demand} ft demand</span>
                      <span className="mx-2 text-ink-soft">/</span>
                      <span className="text-ink-soft">{week.capacity} ft capacity</span>
                    </span>
                  </div>
                  <ProgressBar
                    label={week.name}
                    showLabel={false}
                    percent={Math.min(loadPct, 100)}
                    tone={isOverCapacity ? "critical" : "success"}
                  />
                  {isOverCapacity && (
                    <p className="mt-1 text-right text-xs font-semibold text-critical">
                      Over capacity by {Math.round(week.demand - week.capacity)} ft (requires overtime or shift
                      extension)
                    </p>
                  )}
                </div>
              );
            })}

          {metrics.unscheduled_demand > 0 && (
            <Alert tone="warning" title="Unscheduled Backlog">
              There is currently <strong>{metrics.unscheduled_demand} ft</strong> of required work from projects
              that do not have a target date set. Assign deadlines to factor them into the capacity forecast.
            </Alert>
          )}
        </Card>
      </section>

      <section className="flex flex-col gap-4">
        <h2 className="font-display text-lg font-bold uppercase tracking-wide text-ink">Master Schedule</h2>
        <Card>
          {loading ? (
            <div className="p-6">
              <Spinner label="Loading schedule…" />
            </div>
          ) : (
            <Table>
              <THead>
                <Tr>
                  <Th>Project Code</Th>
                  <Th>Project Name</Th>
                  <Th>Deadline</Th>
                  <Th>Priority</Th>
                  <Th>Status</Th>
                </Tr>
              </THead>
              <TBody>
                {projects.length === 0 ? (
                  <Tr>
                    <Td colSpan={5} className="text-center text-ink-soft">
                      No scheduled projects.
                    </Td>
                  </Tr>
                ) : (
                  projects.map((p) => (
                    <Tr key={p.id}>
                      <Td className="font-bold text-brand-deep">{p.quotation_no}</Td>
                      <Td className="font-medium text-ink">{p.project_name || "-"}</Td>
                      <Td>
                        {p.target_date ? (
                          new Date(p.target_date).toLocaleDateString("en-GB")
                        ) : (
                          <span className="text-xs text-warning">Unscheduled</span>
                        )}
                      </Td>
                      <Td>
                        <Badge tone={priorityTone(p.priority)}>{p.priority}</Badge>
                      </Td>
                      <Td className="font-medium text-ink-soft">{p.status}</Td>
                    </Tr>
                  ))
                )}
              </TBody>
            </Table>
          )}
        </Card>
      </section>
    </div>
  );
}
