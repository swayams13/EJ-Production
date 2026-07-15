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
  project_priority: string;
  deadline: string;
  days_to_deadline: number;
  material_name: string;
  size: number;
  joint_type: string;
  qty_needed: number;
  priority_score: number;
  bucket: string;
  has_delay_reason: boolean;
  delay_reason: string | null;
  open_po_count: number;
}

function SectionTable({
  items,
  showOrderBy,
  showActions,
  onCreatePO,
  onLogReason,
  dimmed,
}: {
  items: MorningListItem[];
  showOrderBy?: boolean;
  showActions: boolean;
  onCreatePO: (item: MorningListItem) => void;
  onLogReason: (item: MorningListItem) => void;
  dimmed?: boolean;
}) {
  const colSpan = showActions ? (showOrderBy ? 9 : 8) : (showOrderBy ? 8 : 7);
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
          {showOrderBy && <Th>Order By</Th>}
          {showActions && <Th numeric>Action</Th>}
        </Tr>
      </THead>
      <TBody>
        {items.map(item => (
          <Tr key={item.part_id} className={dimmed ? "opacity-75" : ""}>
            <Td>
              <div className="font-semibold text-ink">{item.project_name}</div>
              {item.has_delay_reason && item.delay_reason && (
                <div className="mt-0.5 rounded bg-amber-100 px-1.5 py-0.5 text-xs text-amber-800">
                  {item.delay_reason}
                </div>
              )}
            </Td>
            <Td>
              <Badge tone={PRIORITY_TONE[item.project_priority] ?? "neutral"}>
                {item.project_priority}
              </Badge>
            </Td>
            <Td className="font-data text-sm">{item.deadline}</Td>
            <Td numeric>
              <span className={daysLeftClass(item.days_to_deadline)}>
                {item.days_to_deadline}
              </span>
            </Td>
            <Td>{item.material_name}</Td>
            <Td numeric>{item.size}</Td>
            <Td numeric>{item.qty_needed}</Td>
            {showOrderBy && (
              <Td className="font-data text-sm text-ink-soft">{item.deadline}</Td>
            )}
            {showActions && (
              <Td numeric>
                <div className="flex items-center justify-center gap-2">
                  <Button variant="primary" onClick={() => onCreatePO(item)}>
                    Create PO
                  </Button>
                  {!item.has_delay_reason && (
                    <Button variant="ghost" onClick={() => onLogReason(item)}>
                      Log Reason
                    </Button>
                  )}
                </div>
              </Td>
            )}
          </Tr>
        ))}
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
        setItems(await res.json());
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
    router.push(`/procurement/po?prefill=${encodeURIComponent(JSON.stringify(item))}`);
  };

  const handleLogReason = (item: MorningListItem) => {
    setReasonItem(item);
    setReason("");
  };

  if (loading) return (
    <div className="flex items-center justify-center p-16">
      <Spinner label="Loading morning list…" />
    </div>
  );

  // Bucket the flat list client-side
  const redCritical = items.filter(i => i.bucket === "RED" && !i.has_delay_reason);
  const redDelayed = items.filter(i => i.bucket === "RED" && i.has_delay_reason);
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
