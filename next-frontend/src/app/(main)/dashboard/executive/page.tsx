"use client";
import { apiFetch } from "@/lib/api";

import { useState, useEffect } from "react";
import { Card, CardHeader, CardBody, MetricCard, ProgressBar, Alert, Badge, Spinner } from "@/components/ui";

interface Kpi {
  label: string;
  value: string;
  trend: string;
  color: string;
}

interface Department {
  name: string;
  load: number;
  color: string;
}

const KPI_COLOR_TO_TONE: Record<string, "neutral" | "success" | "warning" | "critical"> = {
  blue: "neutral",
  rose: "critical",
  emerald: "success",
  amber: "warning",
  orange: "warning",
  purple: "neutral",
};

const DEPT_PROGRESS_TONES: Array<"brand" | "success" | "warning" | "critical"> = [
  "warning",
  "success",
  "brand",
  "critical",
];

export default function ExecutiveDashboard() {
  const [kpis, setKpis] = useState<Kpi[]>([]);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchExecutive = () => {
      apiFetch(`${process.env.NEXT_PUBLIC_API_URL || "http://localhost:8003"}/api/v1/dashboard/executive`)
        .then((res) => res.json())
        .then((resData) => {
          const data = resData.data;
          setKpis(data.kpis);
          setDepartments(data.departments || []);
          setLoading(false);
        })
        .catch((err) => console.error(err));
    };

    fetchExecutive();
    const interval = setInterval(fetchExecutive, 3000);
    return () => clearInterval(interval);
  }, []);

  return (
    <div className="flex flex-col gap-8">
      <div>
        <h1 className="font-display text-3xl font-extrabold uppercase tracking-wide text-ink">
          Executive Dashboard
        </h1>
        <p className="text-ink-soft">High-level KPIs and business metrics across all operations.</p>
      </div>

      {loading ? (
        <Spinner label="Loading executive metrics…" />
      ) : (
        <div className="grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-4">
          {kpis.map((kpi) => (
            <div key={kpi.label} className="flex flex-col gap-1">
              <MetricCard label={kpi.label} value={kpi.value} tone={KPI_COLOR_TO_TONE[kpi.color] || "neutral"} />
              <span className="px-1 text-xs font-semibold text-ink-soft">{kpi.trend}</span>
            </div>
          ))}
        </div>
      )}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader
            title="Department Load"
            action={<button className="text-xs font-bold uppercase tracking-wide text-brand-deep hover:underline">View All</button>}
          />
          <CardBody className="gap-5 p-5">
            {departments.map((dept, i) => (
              <ProgressBar
                key={dept.name}
                label={dept.name}
                percent={dept.load}
                tone={DEPT_PROGRESS_TONES[i % DEPT_PROGRESS_TONES.length]}
              />
            ))}
            {departments.length === 0 && <p className="text-sm text-ink-soft">No active production data.</p>}
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="Critical Alerts" action={<Badge tone="critical">1 Active</Badge>} />
          <CardBody className="p-5">
            <Alert tone="critical" title="System Live">
              The MES is now receiving live data. Alerts will populate based on live inspection failures or
              material shortages.
            </Alert>
          </CardBody>
        </Card>
      </div>
    </div>
  );
}
