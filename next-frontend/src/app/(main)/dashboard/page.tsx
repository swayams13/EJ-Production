"use client";
import { apiFetch } from "@/lib/api";

import { useEffect, useState } from "react";
import { Button, Card, MetricCard, Spinner, Table, THead, TBody, Tr, Th, Td } from "@/components/ui";

interface OvertimeData {
  total_ot_tig: number;
  total_ot_mig: number;
  total_ot_grind: number;
  ot_per_tig: number;
  ot_per_mig: number;
  ot_per_grind: number;
}

interface MonthBreakdown {
  tig_feet: number;
  dj_feet?: number;
  mig_feet: number;
  grind_feet: number;
  req_tig: number;
  req_mig: number;
  req_grind: number;
}

interface DashboardData {
  active_projects: number;
  hold_projects?: number;
  completed_projects?: number;
  pending_tig: number;
  pending_dj?: number;
  pending_mig: number;
  pending_grind: number;
  hold_tig: number;
  hold_dj?: number;
  hold_mig: number;
  hold_grind: number;
  plan_tig?: number;
  plan_dj?: number;
  plan_mig?: number;
  plan_grind?: number;
  overtime?: OvertimeData;
  pool?: { tig: number; mig: number; grinders: number };
  required?: { tig: number; mig: number; grinders: number };
  months_breakdown?: Record<string, MonthBreakdown>;
}

const round1 = (n: number) => Math.round((n || 0) * 10) / 10;

export default function Dashboard() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchDashboard = () => {
      apiFetch(`${process.env.NEXT_PUBLIC_API_URL || "http://localhost:8003"}/api/v1/dashboard/status`)
        .then((res) => res.json())
        .then((resData) => {
          setData(resData.data);
          setLoading(false);
        });
    };

    fetchDashboard();
    const interval = setInterval(fetchDashboard, 15000); // Live refresh every 15s

    return () => clearInterval(interval);
  }, []);

  const handleDownloadExcel = () => {
    window.location.href = `${process.env.NEXT_PUBLIC_API_URL || "http://localhost:8003"}/api/v1/dashboard/export`;
  };

  if (loading || !data) return <Spinner label="Loading dashboard…" />;

  const deficit = (poolValue: number, requiredValue: number) => poolValue - requiredValue;

  return (
    <div className="flex flex-col gap-8">
      <div className="flex items-start justify-between gap-6">
        <div>
          <h1 className="font-display text-3xl font-extrabold uppercase tracking-wide text-ink">
            Progress Dashboard
          </h1>
          <p className="text-ink-soft">Live view of active capacity, manpower requirements, and shortages.</p>
        </div>
        <Button onClick={handleDownloadExcel} className="shrink-0 whitespace-nowrap">
          Download Production Register
        </Button>
      </div>

      <div className="grid grid-cols-1 gap-6 md:grid-cols-3">
        <MetricCard label="Active Projects" value={data.active_projects} />
        <MetricCard label="Projects on Hold" value={data.hold_projects || 0} tone="warning" />
        <MetricCard label="Completed Projects" value={data.completed_projects || 0} tone="success" />
      </div>

      <section className="flex flex-col gap-4">
        <h2 className="font-display text-lg font-bold uppercase tracking-wide text-ink">
          Pending Workload (Active Projects)
        </h2>
        <div className="grid grid-cols-1 gap-6 md:grid-cols-4">
          <MetricCard label="Pending TIG (ft)" value={round1(data.pending_tig)} />
          <MetricCard label="Pending DJ (ft)" value={round1(data.pending_dj || 0)} />
          <MetricCard label="Pending MIG (ft)" value={round1(data.pending_mig)} />
          <MetricCard label="Pending Grinding (sq ft)" value={round1(data.pending_grind)} />
        </div>
      </section>

      {(data.hold_tig > 0 || data.hold_mig > 0 || data.hold_grind > 0 || (data.hold_dj || 0) > 0) && (
        <section className="rounded-lg border border-critical/25 bg-critical-tint p-5">
          <h3 className="mb-3 text-xs font-bold uppercase tracking-wide text-[#8a4437]">
            On Hold Work (Excluded from Pending)
          </h3>
          <div className="grid grid-cols-1 gap-6 md:grid-cols-4">
            <MetricCard label="Hold TIG (ft)" value={round1(data.hold_tig)} tone="critical" />
            <MetricCard label="Hold DJ (ft)" value={round1(data.hold_dj || 0)} tone="critical" />
            <MetricCard label="Hold MIG (ft)" value={round1(data.hold_mig)} tone="critical" />
            <MetricCard label="Hold Grinding (sq ft)" value={round1(data.hold_grind)} tone="critical" />
          </div>
        </section>
      )}

      {((data.plan_tig || 0) > 0 || (data.plan_mig || 0) > 0 || (data.plan_grind || 0) > 0 || (data.plan_dj || 0) > 0) && (
        <section className="rounded-lg border border-brand/25 bg-brand-tint p-5">
          <h3 className="mb-3 text-xs font-bold uppercase tracking-wide text-brand-deep">
            Planning Pending Feet (Excluded from Pending)
          </h3>
          <div className="grid grid-cols-1 gap-6 md:grid-cols-4">
            <MetricCard label="Planning TIG (ft)" value={round1(data.plan_tig || 0)} />
            <MetricCard label="Planning DJ (ft)" value={round1(data.plan_dj || 0)} />
            <MetricCard label="Planning MIG (ft)" value={round1(data.plan_mig || 0)} />
            <MetricCard label="Planning Grinding (sq ft)" value={round1(data.plan_grind || 0)} />
          </div>
        </section>
      )}

      {data.overtime && (
        <section className="rounded-lg border border-warning/30 bg-warning-tint p-5">
          <h3 className="mb-3 text-xs font-bold uppercase tracking-wide text-[#8a6636]">
            Overtime Predictions (Required Hours)
          </h3>
          <div className="grid grid-cols-1 gap-6 md:grid-cols-3">
            <OvertimeCard label="TIG Overtime" total={data.overtime.total_ot_tig} perWorker={data.overtime.ot_per_tig} perLabel="Per Welder" />
            <OvertimeCard label="MIG Overtime" total={data.overtime.total_ot_mig} perWorker={data.overtime.ot_per_mig} perLabel="Per Welder" />
            <OvertimeCard label="Grinding Overtime" total={data.overtime.total_ot_grind} perWorker={data.overtime.ot_per_grind} perLabel="Per Grinder" />
          </div>
          <p className="mt-3 text-xs text-[#8a6636]">
            * Predictions assume a standard 8-hour shift based on your master productivity targets.
          </p>
        </section>
      )}

      <section className="flex flex-col gap-4">
        <h2 className="font-display text-lg font-bold uppercase tracking-wide text-ink">
          Company Manpower Requirements
        </h2>
        <Card>
          <Table>
            <THead>
              <Tr>
                <Th>Metric</Th>
                <Th>TIG Welders</Th>
                <Th>MIG &amp; DJ Welders</Th>
                <Th>Grinders</Th>
              </Tr>
            </THead>
            <TBody>
              <Tr>
                <Td className="font-medium text-ink">Current Workforce</Td>
                <Td numeric>{data.pool?.tig || 0}</Td>
                <Td numeric>{data.pool?.mig || 0}</Td>
                <Td numeric>{data.pool?.grinders || 0}</Td>
              </Tr>
              <Tr>
                <Td className="font-medium text-ink">Required (Active Projects)</Td>
                <Td numeric>{data.required?.tig || 0}</Td>
                <Td numeric>{data.required?.mig || 0}</Td>
                <Td numeric>{data.required?.grinders || 0}</Td>
              </Tr>
              <Tr>
                <Td className="font-bold text-ink">Deficit / Surplus</Td>
                <DeficitCell value={deficit(data.pool?.tig || 0, data.required?.tig || 0)} />
                <DeficitCell value={deficit(data.pool?.mig || 0, data.required?.mig || 0)} />
                <DeficitCell value={deficit(data.pool?.grinders || 0, data.required?.grinders || 0)} />
              </Tr>
            </TBody>
          </Table>
        </Card>
      </section>

      <section className="flex flex-col gap-4">
        <h2 className="font-display text-lg font-bold uppercase tracking-wide text-ink">
          Month-wise Pending Work &amp; Requirements
        </h2>
        <Card>
          <Table>
            <THead>
              <Tr>
                <Th>Month</Th>
                <Th>TIG (ft)</Th>
                <Th>DJ (ft)</Th>
                <Th>MIG (ft)</Th>
                <Th>Grind (ft)</Th>
                <Th>Req. TIG</Th>
                <Th>Req. MIG/DJ</Th>
                <Th>Req. Grind</Th>
              </Tr>
            </THead>
            <TBody>
              {data.months_breakdown &&
                Object.entries(data.months_breakdown)
                  .sort(([monthA], [monthB]) => new Date(monthA).getTime() - new Date(monthB).getTime())
                  .map(([month, details]) => (
                    <Tr key={month}>
                      <Td className="font-medium text-ink">{month}</Td>
                      <Td numeric>{round1(details.tig_feet)}</Td>
                      <Td numeric>{round1(details.dj_feet || 0)}</Td>
                      <Td numeric>{round1(details.mig_feet)}</Td>
                      <Td numeric>{round1(details.grind_feet)}</Td>
                      <Td numeric>{details.req_tig}</Td>
                      <Td numeric>{details.req_mig}</Td>
                      <Td numeric>{details.req_grind}</Td>
                    </Tr>
                  ))}
              {(!data.months_breakdown || Object.keys(data.months_breakdown).length === 0) && (
                <Tr>
                  <Td colSpan={8} className="text-center text-ink-soft">
                    No data available
                  </Td>
                </Tr>
              )}
            </TBody>
          </Table>
        </Card>
      </section>
    </div>
  );
}

function OvertimeCard({
  label,
  total,
  perWorker,
  perLabel,
}: {
  label: string;
  total: number;
  perWorker: number;
  perLabel: string;
}) {
  return (
    <Card className="flex items-center justify-between p-4">
      <div>
        <h4 className="text-sm font-medium text-ink-soft">{label}</h4>
        <div className="font-data tabular-nums text-2xl font-bold text-warning">{round1(total)} hrs</div>
      </div>
      <div className="text-right">
        <h4 className="text-xs font-medium uppercase text-ink-soft">{perLabel}</h4>
        <div className="font-data tabular-nums text-lg font-semibold text-ink">{round1(perWorker)} hrs</div>
      </div>
    </Card>
  );
}

function DeficitCell({ value }: { value: number }) {
  const isShort = value < 0;
  return (
    <Td numeric className={`font-bold ${isShort ? "text-critical" : "text-success"}`}>
      {value > 0 ? "+" : ""}
      {value}
    </Td>
  );
}
