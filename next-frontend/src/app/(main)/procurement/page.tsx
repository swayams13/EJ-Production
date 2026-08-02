"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { apiFetch } from "@/lib/api";
import {
  Button, Card, CardHeader, CardBody,
  Textarea, Label,
  Table, THead, TBody, Tr, Th, Td,
  Badge, Spinner, Alert, EmptyState,
  useToast,
} from "@/components/ui";

const API = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8003";

// ponytail: static tone maps — no runtime Tailwind interpolation
const PRIORITY_TONE: Record<string, "critical" | "warning" | "brand" | "neutral"> = {
  P1: "critical",
  P2: "warning",
  P3: "brand",
};

const DAYS_LEFT_CLASS: Record<"red" | "orange" | "default", string> = {
  red: "text-critical font-bold",
  orange: "text-warning font-bold",
  default: "text-ink-soft",
};

function daysLeftClass(days: number): string {
  if (days <= 7) return DAYS_LEFT_CLASS.red;
  if (days <= 14) return DAYS_LEFT_CLASS.orange;
  return DAYS_LEFT_CLASS.default;
}

interface MorningListItem {
  part_id: number;
  project_name: string;
  priority: string;
  target_date: string | null;
  days_to_order_by: number;
  material_name: string;
  size: number;
  joint_type: string;
  still_needs_ordering: number;
  priority_score: number;
  bucket: string;
  delay_reason: string | null;
  qty_ordered_today: number;
  qty_received_today: number;
}

function SectionTable({
  items,
  showOrderBy,
  showActions,
  onCreatePO,
  onLogReason,
  onSaveLog,
  dimmed,
}: {
  items: MorningListItem[];
  showOrderBy?: boolean;
  showActions: boolean;
  onCreatePO: (item: MorningListItem) => void;
  onLogReason: (item: MorningListItem) => void;
  onSaveLog: (item: MorningListItem, qtyOrdered: number, qtyReceived: number) => void;
  dimmed?: boolean;
}) {
  // ponytail: uncontrolled inputs — defaultValue from server, onBlur saves; avoids a state map
  const colSpan = showActions ? (showOrderBy ? 12 : 11) : (showOrderBy ? 11 : 10);
  return (
    <Table>
      <THead>
        <Tr>
          <Th>Project</Th>
          <Th>Priority</Th>
          <Th>Deadline</Th>
          <Th numeric>Days Left</Th>
          <Th>Material</Th>
          <Th numeric>Size</Th>
          <Th numeric>Qty Needed</Th>
          <Th numeric>Ordered Today</Th>
          <Th numeric>Received Today</Th>
          <Th></Th>
          {showOrderBy && <Th>Order By</Th>}
          {showActions && <Th numeric>Action</Th>}
        </Tr>
      </THead>
      <TBody>
        {items.map(item => {
          let orderedRef: HTMLInputElement | null = null;
          let receivedRef: HTMLInputElement | null = null;
          const handleSave = () => {
            const o = parseInt(orderedRef?.value ?? "0", 10) || 0;
            const r = parseInt(receivedRef?.value ?? "0", 10) || 0;
            onSaveLog(item, o, r);
          };
          return (
            <Tr key={item.part_id} className={dimmed ? "opacity-75" : ""}>
              <Td>
                <div className="font-semibold text-ink">{item.project_name}</div>
                {item.delay_reason && (
                  <div className="mt-0.5 rounded bg-amber-100 px-1.5 py-0.5 text-xs text-amber-800">
                    {item.delay_reason}
                  </div>
                )}
              </Td>
              <Td>
                <Badge tone={PRIORITY_TONE[item.priority] ?? "neutral"}>
                  {item.priority}
                </Badge>
              </Td>
              <Td className="font-data text-sm">{item.target_date ?? "—"}</Td>
              <Td numeric>
                <span className={daysLeftClass(item.days_to_order_by)}>
                  {item.days_to_order_by}
                </span>
              </Td>
              <Td>{item.material_name}</Td>
              <Td numeric>{item.size}</Td>
              <Td numeric>{item.still_needs_ordering}</Td>
              <Td numeric>
                <input
                  key={`o-${item.part_id}-${item.qty_ordered_today}`}
                  ref={el => { orderedRef = el; }}
                  type="number"
                  min={0}
                  defaultValue={item.qty_ordered_today}
                  className="w-20 rounded border border-surface-border bg-surface px-2 py-1 text-right font-data text-sm text-ink focus:outline-none focus:ring-1 focus:ring-brand"
                />
              </Td>
              <Td numeric>
                <input
                  key={`r-${item.part_id}-${item.qty_received_today}`}
                  ref={el => { receivedRef = el; }}
                  type="number"
                  min={0}
                  defaultValue={item.qty_received_today}
                  className="w-20 rounded border border-surface-border bg-surface px-2 py-1 text-right font-data text-sm text-ink focus:outline-none focus:ring-1 focus:ring-brand"
                />
              </Td>
              <Td>
                <Button variant="secondary" onClick={handleSave}>Save</Button>
              </Td>
              {showOrderBy && (
                <Td className="font-data text-sm text-ink-soft">{item.target_date ?? "—"}</Td>
              )}
              {showActions && (
                <Td numeric>
                  <div className="flex items-center justify-center gap-2">
                    <Button variant="primary" onClick={() => onCreatePO(item)}>
                      Create PO
                    </Button>
                    {!item.delay_reason && (
                      <Button variant="ghost" onClick={() => onLogReason(item)}>
                        Log Reason
                      </Button>
                    )}
                  </div>
                </Td>
              )}
            </Tr>
          );
        })}
        {items.length === 0 && (
          <Tr>
            <Td colSpan={colSpan} className="py-8 text-center text-ink-soft">
              No items in this section.
            </Td>
          </Tr>
        )}
      </TBody>
    </Table>
  );
}

export default function ProcurementDashboard() {
  const router = useRouter();
  const { showToast, toasts } = useToast();

  const [items, setItems] = useState<MorningListItem[]>([]);
  const [materialHoldsCount, setMaterialHoldsCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState("");

  // delay-reason inline form
  const [reasonItem, setReasonItem] = useState<MorningListItem | null>(null);
  const [reason, setReason] = useState("");
  const [savingReason, setSavingReason] = useState(false);

  // ponytail: localStorage role check — matches vendors/po page pattern
  const isManagement = typeof window !== "undefined" && localStorage.getItem("user_role") === "MANAGEMENT";

  const load = async () => {
    setLoading(true);
    setFetchError("");
    try {
      const res = await apiFetch(`${API}/api/v1/procurement/morning-list`);
      if (res.ok) {
        const data = await res.json();
        setItems(data.items ?? []);
        setMaterialHoldsCount(data.material_holds_count ?? 0);
      } else {
        const b = await res.json().catch(() => ({})) as { detail?: string };
        setFetchError(b.detail || "Failed to load morning list.");
      }
    } catch (e) {
      setFetchError(e instanceof Error ? e.message : "Network error.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const logReason = async () => {
    if (!reasonItem || !reason.trim()) return;
    setSavingReason(true);
    try {
      const res = await apiFetch(`${API}/api/v1/procurement/delay-reason`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ part_id: reasonItem.part_id, reason: reason.trim() }),
      });
      if (res.ok) {
        showToast("Delay reason saved.");
        setReasonItem(null);
        setReason("");
        load();
      } else {
        const b = await res.json().catch(() => ({})) as { detail?: string };
        showToast(b.detail || "Failed to save reason.", "critical");
      }
    } catch (e) {
      showToast(e instanceof Error ? e.message : "Network error.", "critical");
    } finally {
      setSavingReason(false);
    }
  };

  const handleCreatePO = (item: MorningListItem) => {
    const payload = [{
      part_id: item.part_id,
      material_name: item.material_name,
      size: item.size,
      joint_type: item.joint_type,
      ordered_qty: item.still_needs_ordering,
    }];
    router.push(`/procurement/po?prefill=${encodeURIComponent(JSON.stringify(payload))}`);
  };

  const handleLogReason = (item: MorningListItem) => {
    setReasonItem(item);
    setReason("");
  };

  const handleSaveLog = async (item: MorningListItem, qtyOrdered: number, qtyReceived: number) => {
    if (qtyOrdered === item.qty_ordered_today && qtyReceived === item.qty_received_today) return;
    try {
      const res = await apiFetch(`${API}/api/v1/procurement/daily-log`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ part_id: item.part_id, qty_ordered: qtyOrdered, qty_received: qtyReceived }),
      });
      if (res.ok) {
        showToast(`${item.material_name}: saved.`);
        load();
      } else {
        const b = await res.json().catch(() => ({})) as { detail?: string };
        showToast(b.detail || "Failed to save.", "critical");
      }
    } catch (e) {
      showToast(e instanceof Error ? e.message : "Network error.", "critical");
    }
  };

  if (loading) return (
    <div className="flex items-center justify-center p-16">
      <Spinner label="Loading morning list…" />
    </div>
  );

  // Bucket the flat list client-side
  const redCritical = items.filter(i => i.bucket === "RED" && !i.delay_reason);
  const redDelayed = items.filter(i => i.bucket === "RED" && !!i.delay_reason);
  const orange = items.filter(i => i.bucket === "ORANGE");
  const green = items.filter(i => i.bucket === "GREEN");

  const totalItems = items.length;

  return (
    <div className="flex flex-col gap-6">
      {toasts}

      <div>
        <h1 className="font-display text-3xl font-extrabold uppercase tracking-wide text-ink">
          Morning Dashboard
        </h1>
        <p className="text-ink-soft">
          Procurement priorities for{" "}
          {new Date().toLocaleDateString("en-IN", { weekday: "long", day: "numeric", month: "long", year: "numeric" })}
        </p>
        {materialHoldsCount > 0 && (
          <a href="/dashboard/holds" className="inline-flex items-center gap-1.5 rounded-full bg-critical/10 px-3 py-1 text-sm font-semibold text-critical hover:bg-critical/20 transition-colors">
            {materialHoldsCount} part{materialHoldsCount !== 1 ? "s" : ""} blocked on shop floor ↗
          </a>
        )}
      </div>

      {fetchError && (
        <Alert tone="critical" title="Error loading morning list">{fetchError}</Alert>
      )}

      {/* Stats bar */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <Card>
          <CardBody className="p-4 text-center">
            <div className="font-data text-3xl font-extrabold text-critical">{redCritical.length}</div>
            <div className="mt-1 text-xs text-ink-soft">Order Today</div>
          </CardBody>
        </Card>
        <Card>
          <CardBody className="p-4 text-center">
            <div className="font-data text-3xl font-extrabold text-warning">{redDelayed.length}</div>
            <div className="mt-1 text-xs text-ink-soft">Delayed</div>
          </CardBody>
        </Card>
        <Card>
          <CardBody className="p-4 text-center">
            <div className="font-data text-3xl font-extrabold text-warning">{orange.length}</div>
            <div className="mt-1 text-xs text-ink-soft">Upcoming</div>
          </CardBody>
        </Card>
        <Card>
          <CardBody className="p-4 text-center">
            <div className="font-data text-3xl font-extrabold text-success">{green.length}</div>
            <div className="mt-1 text-xs text-ink-soft">This Week</div>
          </CardBody>
        </Card>
      </div>

      {/* Delay reason inline form */}
      {reasonItem && (
        <Card>
          <CardHeader title={`Log Delay Reason — ${reasonItem.project_name} / ${reasonItem.material_name}`} />
          <CardBody className="flex flex-col gap-3 p-5">
            <div>
              <Label>Reason for delay *</Label>
              <Textarea
                value={reason}
                onChange={e => setReason(e.target.value)}
                placeholder="Why is this PO delayed? (e.g. vendor unavailable, material shortage…)"
                rows={3}
              />
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="secondary" onClick={() => setReasonItem(null)}>Cancel</Button>
              <Button onClick={logReason} disabled={savingReason || !reason.trim()}>
                {savingReason ? "Saving…" : "Save Reason"}
              </Button>
            </div>
          </CardBody>
        </Card>
      )}

      {/* RED — Critical (no delay reason) */}
      {redCritical.length > 0 && (
        <div>
          <div className="mb-3 flex items-center gap-2 rounded-t-md border border-b-0 border-red-200 bg-red-50 px-4 py-2.5">
            <span className="inline-block h-3 w-3 rounded-full bg-critical" />
            <h2 className="font-display text-base font-bold uppercase tracking-wide text-critical">
              Critical — Order Today
            </h2>
            <span className="ml-auto font-data text-sm font-bold text-critical">{redCritical.length} item{redCritical.length !== 1 ? "s" : ""}</span>
          </div>
          <div className="rounded-b-md border border-red-200 bg-red-50">
            <SectionTable
              items={redCritical}
              showActions={isManagement}
              onCreatePO={handleCreatePO}
              onLogReason={handleLogReason}
              onSaveLog={handleSaveLog}
            />
          </div>
        </div>
      )}

      {/* RED — Delayed with reason (amber sub-section) */}
      {redDelayed.length > 0 && (
        <div>
          <div className="mb-3 flex items-center gap-2 rounded-t-md border border-b-0 border-amber-200 bg-amber-50 px-4 py-2.5">
            <span className="inline-block h-3 w-3 rounded-full bg-warning" />
            <h2 className="font-display text-base font-bold uppercase tracking-wide text-warning">
              Delayed — Reason Logged
            </h2>
            <span className="ml-auto font-data text-sm font-bold text-warning">{redDelayed.length} item{redDelayed.length !== 1 ? "s" : ""}</span>
          </div>
          <div className="rounded-b-md border border-amber-200 bg-amber-50">
            <SectionTable
              items={redDelayed}
              showActions={isManagement}
              onCreatePO={handleCreatePO}
              onLogReason={handleLogReason}
              onSaveLog={handleSaveLog}
              dimmed
            />
          </div>
        </div>
      )}

      {/* ORANGE — Urgent */}
      {orange.length > 0 && (
        <div>
          <div className="mb-3 flex items-center gap-2 rounded-t-md border border-b-0 border-orange-200 bg-orange-50 px-4 py-2.5">
            <span className="inline-block h-3 w-3 rounded-full bg-warning" />
            <h2 className="font-display text-base font-bold uppercase tracking-wide text-warning">
              Urgent — Order Soon
            </h2>
            <span className="ml-auto font-data text-sm font-bold text-warning">{orange.length} item{orange.length !== 1 ? "s" : ""}</span>
          </div>
          <div className="rounded-b-md border border-orange-200 bg-orange-50">
            <SectionTable
              items={orange}
              showOrderBy
              showActions={false}
              onCreatePO={handleCreatePO}
              onLogReason={handleLogReason}
              onSaveLog={handleSaveLog}
            />
          </div>
        </div>
      )}

      {/* GREEN — Planned */}
      {green.length > 0 && (
        <div>
          <div className="mb-3 flex items-center gap-2 rounded-t-md border border-b-0 border-green-200 bg-green-50 px-4 py-2.5">
            <span className="inline-block h-3 w-3 rounded-full bg-success" />
            <h2 className="font-display text-base font-bold uppercase tracking-wide text-success">
              Planned — This Week
            </h2>
            <span className="ml-auto font-data text-sm font-bold text-success">{green.length} item{green.length !== 1 ? "s" : ""}</span>
          </div>
          <div className="rounded-b-md border border-green-200 bg-green-50">
            <SectionTable
              items={green}
              showOrderBy
              showActions={false}
              onCreatePO={handleCreatePO}
              onLogReason={handleLogReason}
              onSaveLog={handleSaveLog}
            />
          </div>
        </div>
      )}

      {/* All clear */}
      {totalItems === 0 && !fetchError && (
        <EmptyState
          title="All clear — nothing to order today"
          description="No procurement action needed. Check back tomorrow or view all POs for open orders."
        />
      )}
    </div>
  );
}
