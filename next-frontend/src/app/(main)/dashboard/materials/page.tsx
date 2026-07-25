"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { apiFetch } from "@/lib/api";
import {
  Card,
  CardHeader,
  Table,
  THead,
  TBody,
  Tr,
  Th,
  Td,
  Badge,
  Spinner,
  Alert,
  EmptyState,
} from "@/components/ui";

interface MaterialRow {
  material_name: string;
  size: number | null;
  joint_type: string | null;
  qty_on_hand: number;
  reserved_qty: number;
  minimum_stock: number;
  incoming_qty: number;
  expected_delivery_date: string | null;
  total_demand: number;
  net_gap: number;
  status: "red" | "amber" | "green";
  projects: Array<{
    id: number;
    name: string;
    qty_needed: number;
    delivery_date: string | null;
  }>;
}

type FilterType = "All" | "At Risk" | "Low Stock";

const API = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8003";

export default function MaterialIntelligenceDashboard() {
  const [rows, setRows] = useState<MaterialRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<FilterType>("All");

  useEffect(() => {
    apiFetch(`${API}/api/v1/dashboard/materials`)
      .then((res) => {
        if (!res.ok) throw new Error(`Server error: ${res.status}`);
        return res.json();
      })
      .then((data) => {
        setRows(Array.isArray(data) ? data : (data.data ?? []));
        setLoading(false);
      })
      .catch((err) => {
        setError(err.message || "Failed to load materials");
        setLoading(false);
      });
  }, []);

  const atRisk = rows.filter((r) => r.status === "red").length;
  const lowStock = rows.filter((r) => r.status === "amber").length;
  const healthy = rows.filter((r) => r.status === "green").length;

  const filtered =
    filter === "At Risk"
      ? rows.filter((r) => r.status === "red")
      : filter === "Low Stock"
      ? rows.filter((r) => r.status === "amber")
      : rows;

  return (
    <div className="flex flex-col gap-8">
      <div>
        <h1 className="font-display text-3xl font-extrabold uppercase tracking-wide text-ink">
          Material Intelligence
        </h1>
        <p className="text-ink-soft">
          Live view of material stock, demand, and shortage risk across all active projects.
        </p>
      </div>

      {/* Summary bar */}
      <div className="flex flex-wrap gap-3">
        <span className="inline-flex items-center gap-2 rounded-full bg-red-100 px-4 py-1.5 text-sm font-semibold text-red-700">
          <span className="text-lg font-extrabold">{atRisk}</span> at risk
        </span>
        <span className="inline-flex items-center gap-2 rounded-full bg-amber-100 px-4 py-1.5 text-sm font-semibold text-amber-700">
          <span className="text-lg font-extrabold">{lowStock}</span> low stock
        </span>
        <span className="inline-flex items-center gap-2 rounded-full bg-green-100 px-4 py-1.5 text-sm font-semibold text-green-700">
          <span className="text-lg font-extrabold">{healthy}</span> healthy
        </span>
      </div>

      {/* Filter chips */}
      <div className="flex gap-2">
        {(["All", "At Risk", "Low Stock"] as FilterType[]).map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={
              filter === f
                ? "rounded-full bg-ink px-4 py-1.5 text-sm font-semibold text-white"
                : "rounded-full border border-ink-subtle px-4 py-1.5 text-sm font-semibold text-ink-soft hover:border-ink hover:text-ink"
            }
          >
            {f}
          </button>
        ))}
      </div>

      <Card>
        <CardHeader title="Material Stock & Demand" />

        {loading ? (
          <div className="p-6">
            <Spinner label="Loading materials…" />
          </div>
        ) : error ? (
          <div className="p-6">
            <Alert tone="critical" title="Failed to load">{error}</Alert>
          </div>
        ) : filtered.length === 0 ? (
          <div className="p-6">
            <EmptyState title="All materials fully covered" />
          </div>
        ) : (
          <Table>
            <THead>
              <Tr>
                <Th>Material</Th>
                <Th>Size</Th>
                <Th>Type</Th>
                <Th numeric>Stock</Th>
                <Th numeric>Incoming</Th>
                <Th numeric>Demand</Th>
                <Th numeric>Gap</Th>
                <Th>Status</Th>
              </Tr>
            </THead>
            <TBody>
              {filtered.map((row, i) => (
                <>
                  <Tr key={`${row.material_name}-${row.size}-${i}`}>
                    <Td>
                      <div className="font-semibold text-ink">{row.material_name}</div>
                    </Td>
                    <Td>{row.size != null ? `${row.size}NB` : "—"}</Td>
                    <Td>{row.joint_type ?? "—"}</Td>
                    <Td numeric>{row.qty_on_hand}</Td>
                    <Td numeric>{row.incoming_qty}</Td>
                    <Td numeric>{row.total_demand}</Td>
                    <Td numeric>
                      {row.net_gap > 0 ? (
                        <span className="text-red-600 font-semibold">+{row.net_gap}</span>
                      ) : (
                        <span className="text-ink-soft">—</span>
                      )}
                    </Td>
                    <Td>
                      <div className="flex items-center gap-2">
                        {row.status === "red" && <Badge tone="critical">Short</Badge>}
                        {row.status === "amber" && <Badge tone="warning">Low</Badge>}
                        {row.status === "green" && <Badge tone="success">OK</Badge>}
                        {row.status === "red" && (
                          <Link
                            href="/procurement"
                            className="text-xs font-semibold text-blue-600 hover:underline"
                          >
                            Order →
                          </Link>
                        )}
                      </div>
                    </Td>
                  </Tr>
                  {(row.status === "red" || row.status === "amber") &&
                    row.projects.map((p) => (
                      <Tr key={`${row.material_name}-${row.size}-proj-${p.id}`}>
                        <Td colSpan={8}>
                          <div className="pl-4 text-xs text-ink-soft">
                            <span className="font-medium text-ink">{p.name}</span>
                            {" · needs "}
                            <span className="font-semibold">{p.qty_needed}</span>
                            {p.delivery_date ? ` · due ${p.delivery_date}` : ""}
                          </div>
                        </Td>
                      </Tr>
                    ))}
                </>
              ))}
            </TBody>
          </Table>
        )}
      </Card>
    </div>
  );
}
