"use client";

import { useEffect, useState } from "react";
import { apiFetch } from "@/lib/api";
import { Card, Select, Label, Button, Table, THead, TBody, Tr, Th, Td, Badge } from "@/components/ui";

const API = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8003";

interface ProductivityRow {
  user_id: number;
  worker_name: string;
  process_type: string;
  target_feet: number;
  actual_feet: number;
  efficiency_pct: number;
  days_worked: number;
}

function isoDate(d: Date) {
  return d.toISOString().split("T")[0];
}

function presetRange(preset: string): [string, string] {
  const today = new Date();
  if (preset === "week") {
    const start = new Date(today);
    const day = today.getDay(); // 0=Sun..6=Sat
    const diffToMonday = day === 0 ? -6 : 1 - day;
    start.setDate(today.getDate() + diffToMonday);
    return [isoDate(start), isoDate(today)];
  }
  if (preset === "month") {
    return [`${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-01`, isoDate(today)];
  }
  return [isoDate(today), isoDate(today)]; // today
}

export default function ProductivityPage() {
  const [preset, setPreset] = useState("week");
  const [fromDate, setFromDate] = useState(() => presetRange("week")[0]);
  const [toDate, setToDate] = useState(() => presetRange("week")[1]);
  const [processType, setProcessType] = useState("");
  const [rows, setRows] = useState<ProductivityRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const fetchData = async () => {
    setLoading(true); setError("");
    try {
      const params = new URLSearchParams({ from_date: fromDate, to_date: toDate });
      if (processType) params.set("process_type", processType);
      const res = await apiFetch(`${API}/api/v1/scheduler/productivity?${params}`);
      if (!res.ok) { const e = await res.json(); throw new Error(e.detail || "Failed"); }
      setRows(await res.json());
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  // ponytail: intentional — only re-fetch on initial mount; manual fetch button handles the rest
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handlePreset = (p: string) => {
    setPreset(p);
    const [f, t] = presetRange(p);
    setFromDate(f); setToDate(t);
  };

  const totalTarget = rows.reduce((s, r) => s + r.target_feet, 0);
  const totalActual = rows.reduce((s, r) => s + r.actual_feet, 0);
  const overallEff = totalTarget > 0 ? Math.round((totalActual / totalTarget) * 100) : 0;

  const effTone = (pct: number): "success" | "warning" | "critical" =>
    pct >= 90 ? "success" : pct >= 70 ? "warning" : "critical";

  return (
    <div className="flex flex-col gap-6 p-6">
      <h1 className="text-2xl font-bold text-ink">Worker Productivity</h1>

      {/* Filters */}
      <Card>
        <div className="flex flex-wrap items-end gap-4 p-4">
          <div>
            <Label>Period</Label>
            <div className="flex gap-2 mt-1">
              {["today", "week", "month"].map((p) => (
                <Button
                  key={p}
                  variant={preset === p ? "primary" : "secondary"}
                  onClick={() => handlePreset(p)}
                >
                  {p === "today" ? "Today" : p === "week" ? "This Week" : "This Month"}
                </Button>
              ))}
            </div>
          </div>
          <div>
            <Label>From</Label>
            <input
              type="date"
              className="mt-1 block rounded border border-line bg-paper px-3 py-2 text-sm text-ink"
              value={fromDate}
              onChange={(e) => { setPreset("custom"); setFromDate(e.target.value); }}
            />
          </div>
          <div>
            <Label>To</Label>
            <input
              type="date"
              className="mt-1 block rounded border border-line bg-paper px-3 py-2 text-sm text-ink"
              value={toDate}
              onChange={(e) => { setPreset("custom"); setToDate(e.target.value); }}
            />
          </div>
          <div>
            <Label>Process</Label>
            <Select value={processType} onChange={(e) => setProcessType(e.target.value)}>
              <option value="">All</option>
              <option value="TIG">TIG</option>
              <option value="MIG">MIG</option>
              <option value="Grinding">Grinding</option>
            </Select>
          </div>
          <Button variant="primary" onClick={fetchData} disabled={loading}>
            {loading ? "Loading…" : "Apply"}
          </Button>
        </div>
      </Card>

      {/* Summary cards */}
      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        {[
          { label: "Target ft", value: totalTarget.toFixed(1) },
          { label: "Actual ft", value: totalActual.toFixed(1) },
          { label: "Overall Efficiency", value: `${overallEff}%` },
          { label: "Workers Tracked", value: String(new Set(rows.map((r) => r.user_id)).size) },
        ].map(({ label, value }) => (
          <Card key={label}>
            <div className="p-4 text-center">
              <div className="text-xs font-bold uppercase tracking-wide text-ink-soft">{label}</div>
              <div className="font-data mt-1 text-2xl font-bold text-ink">{value}</div>
            </div>
          </Card>
        ))}
      </div>

      {/* Table */}
      {error && <p className="text-sm text-critical">{error}</p>}
      {rows.length === 0 && !loading && (
        <p className="text-sm text-ink-soft">No data for the selected range.</p>
      )}
      {rows.length > 0 && (
        <Card>
          <Table>
            <THead>
              <Tr>
                <Th>Worker</Th>
                <Th>Process</Th>
                <Th numeric>Target ft</Th>
                <Th numeric>Actual ft</Th>
                <Th numeric>Efficiency</Th>
                <Th numeric>Days Worked</Th>
              </Tr>
            </THead>
            <TBody>
              {rows.map((r, i) => (
                <Tr key={i}>
                  <Td>{r.worker_name}</Td>
                  <Td><Badge tone="brand">{r.process_type}</Badge></Td>
                  <Td numeric>{r.target_feet.toFixed(1)}</Td>
                  <Td numeric>{r.actual_feet.toFixed(1)}</Td>
                  <Td numeric>
                    <Badge tone={effTone(r.efficiency_pct)}>{r.efficiency_pct.toFixed(1)}%</Badge>
                  </Td>
                  <Td numeric>{r.days_worked}</Td>
                </Tr>
              ))}
            </TBody>
          </Table>
        </Card>
      )}
    </div>
  );
}
