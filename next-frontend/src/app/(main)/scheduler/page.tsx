"use client";
import { useState, useEffect } from "react";
import { apiFetch } from "@/lib/api";
import {
  Card, CardHeader, Table, THead, TBody, Tr, Th, Td,
  Badge, Button, Input, Select, Textarea, Label,
  Modal, Alert, Spinner, EmptyState,
  useConfirm, useToast,
} from "@/components/ui";

const API = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8003";

// ── Types ───────────────────────────────────────────────────────────────────

interface WorkOrder {
  id: number;
  project_id: number;
  user_id: number;
  part_id: number | null;
  date: string;
  process_type: string;
  target_feet: number;
  actual_feet: number | null;
  is_overtime: boolean;
  status: string;
  completed_part_process_id: number | null;
  notes: string | null;
  user?: { id: number; full_name: string | null };
  project?: { id: number; quotation_no: string };
  part?: {
    id: number;
    name: string;
    production_line?: { size: number | null; joint_type: string | null };
    processes: Array<{ id: number; process_name: string; status: string }>;
  };
}

interface ChangeRequest {
  id: number;
  subject_type: string;
  subject_id: number | null;
  target_date: string | null;
  proposed_by: number;
  status: string;
  changes_json: string;
  rejection_note: string | null;
  created_at: string;
  proposer?: { id: number; full_name: string | null };
}

interface Employee {
  id: number;
  emp_id: string;
  name: string;
  company: string;
  skill_1: string | null;
  skill_2: string | null;
  skill_3: string | null;
  skill_4: string | null;
  target_per_day: number;
  active: boolean;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

const STATUS_TONE: Record<string, "success" | "warning" | "critical" | "neutral"> = {
  Completed: "success",
  Pending: "warning",
  Blocked: "critical",
};

function partLabel(wo: WorkOrder): string {
  if (!wo.part) return "—";
  const size = wo.part.production_line?.size;
  return size ? `${wo.part.name} ${size}mm` : wo.part.name;
}

function crSummary(cr: ChangeRequest): string {
  try {
    const c = JSON.parse(cr.changes_json);
    if (cr.subject_type === "employee_profile") {
      return `Employee profile: ${Object.keys(c.changes ?? {}).join(", ")}`;
    }
    const excluded = (c.exclude_user_ids ?? []).length;
    const overridden = Object.keys(c.capacity_overrides ?? {}).length;
    return `Daily plan: ${excluded} excluded, ${overridden} capacity overrides`;
  } catch {
    return cr.subject_type;
  }
}

function getRole(): string {
  if (typeof window === "undefined") return "";
  return localStorage.getItem("user_role") ?? "";
}

// ── Page ─────────────────────────────────────────────────────────────────────

export default function SchedulerPage() {
  const { confirm, dialog } = useConfirm();
  const { showToast, toasts } = useToast();

  const [userRole, setUserRole] = useState("");
  const [date, setDate] = useState(new Date().toISOString().split("T")[0]);
  const [tab, setTab] = useState<"orders" | "approvals">("orders");
  const [orders, setOrders] = useState<WorkOrder[]>([]);
  const [changeRequests, setChangeRequests] = useState<ChangeRequest[]>([]);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [pendingCount, setPendingCount] = useState(0);
  const [noStockProjects, setNoStockProjects] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);

  // Complete modal
  const [completeWO, setCompleteWO] = useState<WorkOrder | null>(null);
  const [actualFeet, setActualFeet] = useState("");
  const [markProcessId, setMarkProcessId] = useState("");
  const [completeNotes, setCompleteNotes] = useState("");

  // Workforce modal
  const [workforceOpen, setWorkforceOpen] = useState(false);
  const [editedEmployees, setEditedEmployees] = useState<Record<number, Partial<Employee>>>({});

  // Override modal
  const [overrideOpen, setOverrideOpen] = useState(false);
  const [excludeIds, setExcludeIds] = useState<Set<number>>(new Set());
  const [capacityOverrides, setCapacityOverrides] = useState<Record<number, string>>({});
  const [overrideNotes, setOverrideNotes] = useState("");

  // Reject modal
  const [rejectCR, setRejectCR] = useState<ChangeRequest | null>(null);
  const [rejectNote, setRejectNote] = useState("");

  useEffect(() => { setUserRole(getRole()); }, []);

  const isManager = ["Developer", "GM", "Admin", "Production Manager", "Supervisor"].includes(userRole);

  useEffect(() => {
    fetchOrders();
  }, [date]);

  useEffect(() => {
    if (isManager && tab === "approvals") fetchPending();
  }, [isManager, tab]);

  const fetchOrders = async () => {
    setLoading(true);
    try {
      const res = await apiFetch(`${API}/api/v1/scheduler/work-orders?target_date=${date}`);
      if (res.ok) {
        const data: WorkOrder[] = await res.json();
        setOrders(data);
        const noStock = [
          ...new Set(
            data
              .filter(wo => wo.part_id === null)
              .map(wo => wo.project?.quotation_no ?? `Proj #${wo.project_id}`)
          ),
        ];
        setNoStockProjects(noStock);
      }
    } finally {
      setLoading(false);
    }
  };

  const fetchPending = async () => {
    const res = await apiFetch(`${API}/api/v1/scheduler/change-requests?status=pending_approval`);
    if (res.ok) {
      const data: ChangeRequest[] = await res.json();
      setChangeRequests(data);
      setPendingCount(data.length);
    }
  };

  const fetchEmployees = async () => {
    const res = await apiFetch(`${API}/api/v1/scheduler/employees`);
    if (res.ok) setEmployees(await res.json());
  };

  const handleGenerate = async () => {
    const ok = await confirm({
      title: "Generate work orders?",
      description: "This will overwrite existing work orders for this date.",
      confirmLabel: "Generate",
    });
    if (!ok) return;
    setLoading(true);
    try {
      const res = await apiFetch(
        `${API}/api/v1/scheduler/generate-work-orders?target_date=${date}`,
        { method: "POST" }
      );
      const data = await res.json();
      if (data.success) {
        showToast(`${data.orders_created} orders generated`, "success");
        fetchOrders();
      } else {
        showToast(data.message ?? "Failed to generate", "critical");
      }
    } finally {
      setLoading(false);
    }
  };

  const handleComplete = async () => {
    if (!completeWO || !actualFeet) return;
    const body = {
      actual_feet: parseFloat(actualFeet),
      status: "Completed",
      mark_step_ready: !!markProcessId,
      part_process_id: markProcessId ? parseInt(markProcessId) : null,
      notes: completeNotes || null,
    };
    const res = await apiFetch(`${API}/api/v1/scheduler/work-orders/${completeWO.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (res.ok) {
      showToast("Work order completed", "success");
      setCompleteWO(null);
      setActualFeet("");
      setMarkProcessId("");
      setCompleteNotes("");
      fetchOrders();
    } else {
      showToast("Failed to complete work order", "critical");
    }
  };

  const openWorkforce = async () => {
    setEditedEmployees({});
    await fetchEmployees();
    setWorkforceOpen(true);
  };

  const handleEmployeeEdit = (
    empId: number,
    field: keyof Employee,
    value: string | boolean | number
  ) => {
    setEditedEmployees(prev => ({
      ...prev,
      [empId]: { ...prev[empId], [field]: value },
    }));
  };

  const handleProposeEmployeeChanges = async () => {
    const entries = Object.entries(editedEmployees);
    if (!entries.length) { showToast("No changes to propose", "critical"); return; }
    let allOk = true;
    for (const [empIdStr, changes] of entries) {
      const payload = {
        subject_type: "employee_profile",
        subject_id: parseInt(empIdStr),
        target_date: null,
        changes_json: JSON.stringify({ employee_id: parseInt(empIdStr), changes }),
      };
      const res = await apiFetch(`${API}/api/v1/scheduler/change-requests`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) allOk = false;
    }
    showToast(
      allOk ? `${entries.length} change request(s) submitted for PM approval` : "Some requests failed",
      allOk ? "success" : "critical"
    );
    setWorkforceOpen(false);
    setEditedEmployees({});
    if (isManager) fetchPending();
  };

  const handleSubmitOverride = async () => {
    const payload = {
      subject_type: "daily_plan_override",
      subject_id: null,
      target_date: date,
      changes_json: JSON.stringify({
        exclude_user_ids: [...excludeIds],
        capacity_overrides: Object.fromEntries(
          Object.entries(capacityOverrides)
            .filter(([, v]) => v !== "")
            .map(([k, v]) => [k, parseFloat(v)])
        ),
        notes: overrideNotes,
      }),
    };
    const res = await apiFetch(`${API}/api/v1/scheduler/change-requests`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (res.ok) {
      showToast("Override request submitted for PM approval", "success");
      setOverrideOpen(false);
      setExcludeIds(new Set());
      setCapacityOverrides({});
      setOverrideNotes("");
    } else {
      showToast("Failed to submit override", "critical");
    }
  };

  const handleApprove = async (crId: number) => {
    const res = await apiFetch(
      `${API}/api/v1/scheduler/change-requests/${crId}/approve`,
      { method: "PATCH" }
    );
    if (res.ok) { showToast("Approved", "success"); fetchPending(); }
    else showToast("Failed to approve", "critical");
  };

  const handleReject = async () => {
    if (!rejectCR) return;
    const res = await apiFetch(
      `${API}/api/v1/scheduler/change-requests/${rejectCR.id}/reject`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rejection_note: rejectNote }),
      }
    );
    if (res.ok) {
      showToast("Rejected", "success");
      setRejectCR(null);
      setRejectNote("");
      fetchPending();
    } else {
      showToast("Failed to reject", "critical");
    }
  };

  // Workers visible in the override modal are inferred from current work orders
  const presentWorkers = [
    ...new Map(
      orders.map(wo => [wo.user_id, wo.user])
    ).entries(),
  ].map(([id, user]) => ({ id, full_name: user?.full_name ?? `User #${id}` }));

  // ── Render ──────────────────────────────────────────────────────────────────

  return (
    <div>
      {/* Header */}
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="font-display text-3xl font-extrabold uppercase tracking-wide text-ink">
            Work Orders
          </h1>
          <p className="text-ink-soft">Material-gated daily work assignment</p>
        </div>
        <div className="flex items-center gap-3">
          <Input
            type="date"
            value={date}
            onChange={e => setDate(e.target.value)}
            className="max-w-[180px]"
          />
          {isManager && (
            <Button variant="primary" disabled={loading} onClick={handleGenerate}>
              {loading ? "Generating…" : "Generate Work Orders"}
            </Button>
          )}
        </div>
      </div>

      {/* No-stock warning */}
      {noStockProjects.length > 0 && (
        <div className="mb-4">
          <Alert tone="warning" title="No stock for some assignments">
            Work orders created without matched materials for:{" "}
            {noStockProjects.join(", ")}
          </Alert>
        </div>
      )}

      {/* Tabs */}
      <div className="mb-4 flex items-center gap-4 border-b border-line">
        <button
          className={`pb-2 text-sm font-medium ${tab === "orders" ? "border-b-2 border-brand text-brand" : "text-ink-soft"}`}
          onClick={() => setTab("orders")}
        >
          Work Orders
          {orders.length > 0 && (
            <span className="ml-1.5 rounded-full bg-paper-raised px-1.5 py-0.5 text-xs font-data">
              {orders.length}
            </span>
          )}
        </button>
        {isManager && (
          <button
            className={`pb-2 text-sm font-medium ${tab === "approvals" ? "border-b-2 border-brand text-brand" : "text-ink-soft"}`}
            onClick={() => setTab("approvals")}
          >
            Pending Approvals
            {pendingCount > 0 && (
              <span className="ml-1.5 rounded-full bg-critical px-1.5 py-0.5 text-xs font-data text-white">
                {pendingCount}
              </span>
            )}
          </button>
        )}
      </div>

      {/* Work Orders tab */}
      {tab === "orders" && (
        <Card>
          <CardHeader
            title={`Work Orders — ${date}`}
            action={
              <Button variant="secondary" onClick={openWorkforce}>
                Manage Workforce
              </Button>
            }
          />
          {loading && orders.length === 0 ? (
            <div className="p-6">
              <Spinner label="Loading work orders…" />
            </div>
          ) : orders.length === 0 ? (
            <div className="p-6">
              <EmptyState
                title="No work orders for this date"
                description={isManager ? "Click Generate Work Orders to create today's plan." : "Ask the Production Manager to generate today's plan."}
              />
            </div>
          ) : (
            <Table>
              <THead>
                <Tr>
                  <Th>Worker</Th>
                  <Th>Project</Th>
                  <Th>Part</Th>
                  <Th>Process</Th>
                  <Th numeric>Target ft</Th>
                  <Th>OT</Th>
                  <Th>Status</Th>
                  <Th>Action</Th>
                </Tr>
              </THead>
              <TBody>
                {orders.map(wo => (
                  <Tr key={wo.id}>
                    <Td className="font-medium text-ink">
                      {wo.user?.full_name ?? `User #${wo.user_id}`}
                    </Td>
                    <Td>{wo.project?.quotation_no ?? `Proj #${wo.project_id}`}</Td>
                    <Td>
                      {wo.part_id === null ? (
                        <Badge tone="critical">⚠ No Stock</Badge>
                      ) : (
                        <span className="text-sm text-ink">{partLabel(wo)}</span>
                      )}
                    </Td>
                    <Td>
                      <Badge tone="brand">{wo.process_type}</Badge>
                    </Td>
                    <Td numeric>{wo.target_feet.toFixed(1)}</Td>
                    <Td>
                      {wo.is_overtime ? (
                        <Badge tone="warning">OT</Badge>
                      ) : (
                        <Badge tone="neutral">No</Badge>
                      )}
                    </Td>
                    <Td>
                      <Badge tone={STATUS_TONE[wo.status] ?? "neutral"}>{wo.status}</Badge>
                    </Td>
                    <Td>
                      {wo.status !== "Completed" && (
                        <Button
                          variant="secondary"
                          onClick={() => {
                            setCompleteWO(wo);
                            setActualFeet(String(wo.target_feet));
                            setMarkProcessId("");
                            setCompleteNotes("");
                          }}
                        >
                          Complete
                        </Button>
                      )}
                    </Td>
                  </Tr>
                ))}
              </TBody>
            </Table>
          )}
        </Card>
      )}

      {/* Pending Approvals tab — PM only */}
      {tab === "approvals" && isManager && (
        <Card>
          <CardHeader title="Pending Approvals" />
          {changeRequests.length === 0 ? (
            <div className="p-6">
              <EmptyState title="No pending approvals" description="Nothing to review right now." />
            </div>
          ) : (
            <Table>
              <THead>
                <Tr>
                  <Th>Type</Th>
                  <Th>Proposed By</Th>
                  <Th>Summary</Th>
                  <Th>Target Date</Th>
                  <Th>Submitted</Th>
                  <Th>Actions</Th>
                </Tr>
              </THead>
              <TBody>
                {changeRequests.map(cr => (
                  <Tr key={cr.id}>
                    <Td>
                      <Badge tone="brand">
                        {cr.subject_type === "employee_profile" ? "Employee" : "Daily Plan"}
                      </Badge>
                    </Td>
                    <Td>{cr.proposer?.full_name ?? `User #${cr.proposed_by}`}</Td>
                    <Td className="max-w-xs truncate text-sm text-ink-soft">{crSummary(cr)}</Td>
                    <Td className="text-sm text-ink-soft">{cr.target_date ?? "—"}</Td>
                    <Td className="text-sm text-ink-soft">
                      {new Date(cr.created_at).toLocaleDateString()}
                    </Td>
                    <Td>
                      <div className="flex gap-2">
                        <Button variant="primary" onClick={() => handleApprove(cr.id)}>
                          Approve
                        </Button>
                        <Button
                          variant="danger"
                          onClick={() => { setRejectCR(cr); setRejectNote(""); }}
                        >
                          Reject
                        </Button>
                      </div>
                    </Td>
                  </Tr>
                ))}
              </TBody>
            </Table>
          )}
        </Card>
      )}

      {/* ── Modals ──────────────────────────────────────────────────────────── */}

      {/* Complete Work Order Modal */}
      <Modal
        open={!!completeWO}
        onClose={() => setCompleteWO(null)}
        title="Complete Work Order"
        description={
          completeWO
            ? `${completeWO.user?.full_name ?? ""} — ${completeWO.project?.quotation_no ?? ""} (${completeWO.process_type})`
            : ""
        }
      >
        <div className="flex w-full flex-col gap-3 pb-4">
          <div>
            <Label>Actual Feet Completed</Label>
            <Input
              type="number"
              step="0.1"
              min="0"
              value={actualFeet}
              onChange={e => setActualFeet(e.target.value)}
              placeholder="e.g. 14.5"
            />
          </div>
          {(completeWO?.part?.processes?.filter(p => p.status !== "ready") ?? []).length > 0 && (
            <div>
              <Label>Mark Step Ready (optional)</Label>
              <Select value={markProcessId} onChange={e => setMarkProcessId(e.target.value)}>
                <option value="">— don&apos;t mark any step —</option>
                {completeWO!.part!.processes
                  .filter(p => p.status !== "ready")
                  .map(p => (
                    <option key={p.id} value={String(p.id)}>
                      {p.process_name}
                    </option>
                  ))}
              </Select>
            </div>
          )}
          <div>
            <Label>Notes (optional)</Label>
            <Textarea
              value={completeNotes}
              onChange={e => setCompleteNotes(e.target.value)}
              rows={2}
            />
          </div>
        </div>
        <div className="flex justify-end gap-2 pt-2">
          <Button variant="secondary" onClick={() => setCompleteWO(null)}>
            Cancel
          </Button>
          <Button
            variant="primary"
            onClick={handleComplete}
            disabled={!actualFeet || isNaN(parseFloat(actualFeet))}
          >
            Save
          </Button>
        </div>
      </Modal>

      {/* Manage Workforce Modal */}
      <Modal
        open={workforceOpen}
        onClose={() => setWorkforceOpen(false)}
        title="Manage Workforce"
      >
        <div className="w-full overflow-x-auto pb-4">
          {employees.length === 0 ? (
            <Spinner label="Loading employees…" />
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-line text-left text-ink-soft">
                  {["Name", "Co.", "Skill 1", "Skill 2", "Skill 3", "Skill 4", "Tgt/Day", "Active"].map(h => (
                    <th key={h} className="pb-2 pr-2 font-medium">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {employees.map(emp => {
                  const edits = editedEmployees[emp.id] ?? {};
                  return (
                    <tr key={emp.id} className="border-b border-line">
                      <td className="py-1 pr-2 font-medium">{emp.name}</td>
                      <td className="py-1 pr-2 text-ink-soft">{emp.company}</td>
                      {(["skill_1", "skill_2", "skill_3", "skill_4"] as const).map(f => (
                        <td key={f} className="py-1 pr-2">
                          <Input
                            value={edits[f] !== undefined ? String(edits[f]) : (emp[f] ?? "")}
                            onChange={e => handleEmployeeEdit(emp.id, f, e.target.value)}
                            className="w-24 text-xs"
                          />
                        </td>
                      ))}
                      <td className="py-1 pr-2">
                        <Input
                          type="number"
                          value={
                            edits.target_per_day !== undefined
                              ? String(edits.target_per_day)
                              : String(emp.target_per_day)
                          }
                          onChange={e =>
                            handleEmployeeEdit(emp.id, "target_per_day", parseFloat(e.target.value))
                          }
                          className="w-16 text-xs"
                        />
                      </td>
                      <td className="py-1">
                        <Select
                          value={String(edits.active !== undefined ? edits.active : emp.active)}
                          onChange={e =>
                            handleEmployeeEdit(emp.id, "active", e.target.value === "true")
                          }
                          className="w-16 text-xs"
                        >
                          <option value="true">Yes</option>
                          <option value="false">No</option>
                        </Select>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" onClick={() => { setOverrideOpen(true); }}>
            Override Today&apos;s Plan
          </Button>
          <Button variant="secondary" onClick={() => setWorkforceOpen(false)}>
            Cancel
          </Button>
          <Button
            variant="primary"
            disabled={Object.keys(editedEmployees).length === 0}
            onClick={handleProposeEmployeeChanges}
          >
            Propose Changes ({Object.keys(editedEmployees).length})
          </Button>
        </div>
      </Modal>

      {/* Daily Override Modal */}
      <Modal
        open={overrideOpen}
        onClose={() => setOverrideOpen(false)}
        title="Override Today's Plan"
        description="Changes require PM approval before they affect generation."
      >
        <div className="flex w-full flex-col gap-3 pb-4">
          <p className="text-sm text-ink-soft">Uncheck workers to exclude from today&apos;s run:</p>
          {presentWorkers.length === 0 && (
            <p className="text-sm text-ink-soft">No workers on today&apos;s orders yet.</p>
          )}
          {presentWorkers.map(w => (
            <div key={w.id} className="flex items-center gap-3">
              <input
                type="checkbox"
                id={`wo-${w.id}`}
                checked={!excludeIds.has(w.id)}
                onChange={e => {
                  setExcludeIds(prev => {
                    const next = new Set(prev);
                    if (e.target.checked) next.delete(w.id);
                    else next.add(w.id);
                    return next;
                  });
                }}
              />
              <label htmlFor={`wo-${w.id}`} className="flex-1 text-sm">
                {w.full_name}
              </label>
              <Input
                type="number"
                placeholder="Capacity override"
                value={capacityOverrides[w.id] ?? ""}
                onChange={e =>
                  setCapacityOverrides(prev => ({ ...prev, [w.id]: e.target.value }))
                }
                className="w-28 text-xs"
              />
            </div>
          ))}
          <div>
            <Label>Notes</Label>
            <Textarea
              value={overrideNotes}
              onChange={e => setOverrideNotes(e.target.value)}
              rows={2}
            />
          </div>
        </div>
        <div className="flex justify-end gap-2 pt-2">
          <Button variant="secondary" onClick={() => setOverrideOpen(false)}>Cancel</Button>
          <Button variant="primary" onClick={handleSubmitOverride}>Submit for Approval</Button>
        </div>
      </Modal>

      {/* Reject Modal */}
      <Modal
        open={!!rejectCR}
        onClose={() => setRejectCR(null)}
        title="Reject Change Request"
      >
        <div className="w-full pb-4">
          <Label>Reason for rejection</Label>
          <Textarea
            value={rejectNote}
            onChange={e => setRejectNote(e.target.value)}
            rows={3}
          />
        </div>
        <div className="flex justify-end gap-2 pt-2">
          <Button variant="secondary" onClick={() => setRejectCR(null)}>Cancel</Button>
          <Button
            variant="danger"
            onClick={handleReject}
            disabled={!rejectNote.trim()}
          >
            Reject
          </Button>
        </div>
      </Modal>

      {dialog}
      {toasts}
    </div>
  );
}
