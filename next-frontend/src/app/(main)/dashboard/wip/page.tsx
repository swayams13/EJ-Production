"use client";
import { apiFetch } from "@/lib/api";

import { useEffect, useState } from "react";
import { Card, ProgressBar, Spinner, Table, THead, TBody, Tr, Th, Td, Badge } from "@/components/ui";

interface ShopWip {
  required: number;
  completed: number;
}

interface LineRow {
  project_name: string;
  quotation_no: string;
  line_type: string;
  size: string;
  tag_no?: string | null;
  qty: number;
  current_stage: string;
}

const SHOP_TONES: Array<"brand" | "success" | "warning" | "critical"> = [
  "warning",
  "brand",
  "success",
  "critical",
];

export default function WipDashboard() {
  const [wipData, setWipData] = useState<Record<string, ShopWip>>({});
  const [lines, setLines] = useState<LineRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchWip = () => {
      apiFetch(`${process.env.NEXT_PUBLIC_API_URL || "http://localhost:8003"}/api/v1/dashboard/wip`)
        .then((res) => res.json())
        .then((resData) => {
          setWipData(resData.data || {});
          setLoading(false);
        })
        .catch((err) => {
          console.error(err);
          setLoading(false);
        });
    };

    fetchWip();
    apiFetch(`${process.env.NEXT_PUBLIC_API_URL || "http://localhost:8003"}/api/v1/dashboard/wip/lines`)
      .then((res) => res.json())
      .then((d) => setLines(d.data || []))
      .catch(() => {});
    const interval = setInterval(fetchWip, 3000);
    return () => clearInterval(interval);
  }, []);

  return (
    <div className="flex flex-col gap-8">
      <div>
        <h1 className="font-display text-3xl font-extrabold uppercase tracking-wide text-ink">
          WIP Tracking Center
        </h1>
        <p className="text-ink-soft">Live work-in-progress inventory across all production departments.</p>
      </div>

      {loading ? (
        <Spinner label="Loading WIP data…" />
      ) : (
        <div className="grid grid-cols-1 gap-6 md:grid-cols-2 xl:grid-cols-3">
          {Object.entries(wipData).map(([shopName, data], i) => {
            const pending = Math.max(0, (data.required || 0) - (data.completed || 0));
            const progress = data.required > 0 ? (data.completed / data.required) * 100 : 0;
            const tone = SHOP_TONES[i % SHOP_TONES.length];
            const toneBg =
              tone === "warning" ? "bg-warning" : tone === "brand" ? "bg-brand" : tone === "success" ? "bg-success" : "bg-critical";

            return (
              <Card key={shopName}>
                <div className={`h-1.5 w-full ${toneBg}`} />
                <div className="flex flex-col gap-5 p-5">
                  <h3 className="text-lg font-bold text-ink">{shopName}</h3>

                  <div className="grid grid-cols-3 gap-3">
                    <div className="rounded-md bg-paper p-3 text-center">
                      <div className="font-data tabular-nums text-xl font-bold text-ink">{data.required || 0}</div>
                      <div className="mt-1 text-[10px] font-bold uppercase text-ink-soft">Required</div>
                    </div>
                    <div className="rounded-md bg-success-tint p-3 text-center">
                      <div className="font-data tabular-nums text-xl font-bold text-success">{data.completed || 0}</div>
                      <div className="mt-1 text-[10px] font-bold uppercase text-[#3f6b4e]">Done</div>
                    </div>
                    <div className="rounded-md bg-critical-tint p-3 text-center">
                      <div className="font-data tabular-nums text-xl font-bold text-critical">{pending}</div>
                      <div className="mt-1 text-[10px] font-bold uppercase text-[#8a4437]">Pending</div>
                    </div>
                  </div>

                  <div>
                    <div className="mb-2 flex justify-between text-xs font-bold">
                      <span className="uppercase tracking-wide text-ink-soft">Progress</span>
                      <span className="font-data tabular-nums text-ink">{progress.toFixed(1)}%</span>
                    </div>
                    <ProgressBar label={shopName} showLabel={false} percent={progress} tone={tone} />
                  </div>
                </div>
              </Card>
            );
          })}
          {Object.keys(wipData).length === 0 && (
            <p className="text-sm text-ink-soft">No active production data.</p>
          )}
        </div>
      )}

      {lines.length > 0 && (
        <div>
          <h2 className="mb-4 text-xl font-bold text-ink">Current Stage by Line</h2>
          <Card>
            <Table>
              <THead>
                <Tr>
                  <Th>Project</Th>
                  <Th>Type</Th>
                  <Th>Size</Th>
                  <Th numeric>Qty</Th>
                  <Th>Current Stage</Th>
                </Tr>
              </THead>
              <TBody>
                {lines.map((row, i) => (
                  <Tr key={i}>
                    <Td>
                      <span className="font-bold text-ink">{row.project_name}</span>
                      {row.tag_no && <span className="ml-2 text-xs text-ink-soft">{row.tag_no}</span>}
                    </Td>
                    <Td>{row.line_type}</Td>
                    <Td>{row.size}</Td>
                    <Td numeric>{row.qty}</Td>
                    <Td>
                      <Badge tone={row.current_stage === "Complete" ? "success" : "neutral"}>
                        {row.current_stage}
                      </Badge>
                    </Td>
                  </Tr>
                ))}
              </TBody>
            </Table>
          </Card>
        </div>
      )}
    </div>
  );
}
