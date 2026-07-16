"use client";
import { apiFetch, ForbiddenError } from "@/lib/api";

import { useState, useEffect } from "react";
import { Card, Select, Label, Button, Input, Badge, Alert, useToast } from "@/components/ui";

interface ProjectOption {
  id: number;
  project_name?: string;
  quotation_no: string;
  status?: string;
}

interface RequirementOption {
  id: number;
  type: string;
  size: string;
  total_qty: number;
  tag_no?: string | null;
  paint_status?: string;
  joint_category?: string;
}

interface ProcessRow {
  id: string;
  process_name: string;
  completed_qty: number;
  qty_pending?: number;
  status?: string;
  date_ready?: string | null;
  date_pending?: string | null;
  po_number?: string | null;
}

interface FinalCheck {
  id: number;
  check_type: string;
  is_required: boolean;
  test_method?: string | null;
  paint_spec?: string | null;
  weight_kgs?: number | null;
  marking_type?: string | null;
  status: string;
  date_ready?: string | null;
  date_pending?: string | null;
  notes?: string | null;
}

interface AssemblyStep {
  id: number;
  step_no: number;
  label: string;
  status: string;
  completed_qty: number;
  date_ready?: string | null;
  notes?: string | null;
}

interface PartRow {
  id: string;
  name: string;
  processes: ProcessRow[];
  total_qty?: number;
}

interface WeldingSummary {
  targets: Record<string, number>;
  completed: Record<string, number>;
}

export default function OperatorEntry() {
  const [projects, setProjects] = useState<ProjectOption[]>([]);
  const [projectId, setProjectId] = useState("");

  const [requirements, setRequirements] = useState<RequirementOption[]>([]);
  const [requirementId, setRequirementId] = useState("");

  const [parts, setParts] = useState<PartRow[]>([]);
  const [totalQty, setTotalQty] = useState(0);
  const [partId, setPartId] = useState("");
  const [weldingSummary, setWeldingSummary] = useState<WeldingSummary | null>(null);
  const [paintStatus, setPaintStatus] = useState("");
  const [tagNo, setTagNo] = useState<string | null>(null);

  const [qtyInputs, setQtyInputs] = useState<{ [key: string]: string }>({});
  const [feetInputs, setFeetInputs] = useState<{ [key: string]: string }>({});
  const [submitting, setSubmitting] = useState(false);
  const [successMsg, setSuccessMsg] = useState("");
  const [errorMsg, setErrorMsg] = useState("");

  const [finalChecks, setFinalChecks] = useState<FinalCheck[]>([]);
  const [assemblySteps, setAssemblySteps] = useState<AssemblyStep[]>([]);
  const [activeTab, setActiveTab] = useState<"Material" | "Fabrication" | "Assembly" | "Welding" | "FinalChecks">("Material");

  const { showToast, toasts } = useToast();

  interface WOSlim {
    id: number;
    user_id: number;
    process_type: string;
    target_feet: number;
    user?: { id: number; full_name: string | null };
  }
  const [todayWorkOrders, setTodayWorkOrders] = useState<WOSlim[]>([]);
  const [weldingOperatorIds, setWeldingOperatorIds] = useState<Record<string, string>>({});

  const isWeldingProcess = (name: string) => /weld|grind|tig|mig/i.test(name);
  const isMaterialProcess = (name: string) => /^(PO|Material Received|Inward Insp)$/i.test(name);

  const getFabProcesses = (part: PartRow) =>
    part.processes.filter((p) => !isWeldingProcess(p.process_name) && !isMaterialProcess(p.process_name));
  const getMaterialReceivedQty = (part: PartRow) =>
    part.processes.find((p) => /^material received$/i.test(p.process_name))?.completed_qty ?? 0;

  useEffect(() => {
    apiFetch(`${process.env.NEXT_PUBLIC_API_URL || "http://localhost:8003"}/api/v1/projects`)
      .then((res) => res.json())
      .then((resData) => setProjects((resData.data || []).filter((p: ProjectOption) => p.status !== "Completed")))
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (!projectId) { setTodayWorkOrders([]); setWeldingOperatorIds({}); return; }
    const today = new Date().toISOString().split("T")[0];
    apiFetch(`${process.env.NEXT_PUBLIC_API_URL || "http://localhost:8003"}/api/v1/scheduler/work-orders?target_date=${today}&project_id=${projectId}`)
      .then((res) => res.json())
      .then((data: WOSlim[]) => { if (Array.isArray(data)) setTodayWorkOrders(data); })
      .catch(() => {});
  }, [projectId]);

  useEffect(() => {
    if (!projectId) {
      setRequirements([]);
      setRequirementId("");
      return;
    }
    apiFetch(`${process.env.NEXT_PUBLIC_API_URL || "http://localhost:8003"}/api/v1/production/requirements/${projectId}`)
      .then((res) => res.json())
      .then((resData) => setRequirements(resData.data || []))
      .catch(() => {});
  }, [projectId]);

  useEffect(() => {
    if (!requirementId) {
      setParts([]);
      setPartId("");
      setTotalQty(0);
      setPaintStatus("");
      setTagNo(null);
      setAssemblySteps([]);
      return;
    }
    apiFetch(`${process.env.NEXT_PUBLIC_API_URL || "http://localhost:8003"}/api/v1/production/parts/${requirementId}`)
      .then((res) => res.json())
      .then((resData) => {
        if (resData.success && resData.data) {
          setTotalQty(resData.data.total_qty);
          setParts(resData.data.parts);
          setFinalChecks(resData.data.final_checks || []);
          setAssemblySteps(resData.data.assembly_steps || []);
          setPaintStatus(resData.data.paint_status || "");
          setTagNo(resData.data.tag_no || resData.data.joint_type_code || null);
        }
      })
      .catch(() => {});

    apiFetch(`${process.env.NEXT_PUBLIC_API_URL || "http://localhost:8003"}/api/v1/production/requirements/${requirementId}/welding_summary`)
      .then((res) => res.json())
      .then((resData) => {
        if (resData.success) {
          setWeldingSummary(resData.data);
        }
      })
      .catch(() => {});
  }, [requirementId]);

  // If the active tab is "Assembly" but the current requirement has no assembly
  // steps, that tab is hidden — fall back to a tab that is always present so the
  // content area never renders blank.
  useEffect(() => {
    if (activeTab === "Assembly" && assemblySteps.length === 0) {
      setActiveTab("Fabrication");
    }
  }, [assemblySteps, activeTab]);

  const handleQtyChange = (processId: string, val: string) => {
    setQtyInputs({ ...qtyInputs, [processId]: val });
  };

  const handleFeetChange = (processId: string, val: string) => {
    setFeetInputs({ ...feetInputs, [processId]: val });
  };

  const handleSubmitProcess = async (processId: string, processName: string) => {
    const qty = parseInt(qtyInputs[processId] || "0");
    if (qty <= 0) {
      setErrorMsg("Quantity must be greater than 0");
      return;
    }

    const feet = parseFloat(feetInputs[processId] || "0");

    setSubmitting(true);
    setSuccessMsg("");
    setErrorMsg("");

    try {
      const res = await apiFetch(`${process.env.NEXT_PUBLIC_API_URL || "http://localhost:8003"}/api/v1/production/processes/${processId}/transactions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          quantity_completed: qty,
          feet_completed: feet > 0 ? feet : null,
          po_number: qtyInputs[`po_${processId}`] || null,
          operator_id: null,
        }),
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.detail || "Submission failed");
      }

      setSuccessMsg(`Successfully recorded ${qty} for ${processName}!`);
      setQtyInputs({ ...qtyInputs, [processId]: "" });
      setFeetInputs({ ...feetInputs, [processId]: "" });

      const reqId = requirementId;
      setRequirementId("");
      setTimeout(() => setRequirementId(reqId), 50);

      setTimeout(() => setSuccessMsg(""), 3000);
    } catch (err) {
      if (err instanceof ForbiddenError) showToast(err.message, "critical");
      else setErrorMsg(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  };

  const handleUpdateCheck = async (checkId: number, patch: Partial<FinalCheck>) => {
    setSubmitting(true); setErrorMsg("");
    try {
      const res = await apiFetch(`${process.env.NEXT_PUBLIC_API_URL || "http://localhost:8003"}/api/v1/production/final-checks/${checkId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      if (!res.ok) { const e = await res.json(); throw new Error(e.detail || "Update failed"); }
      setSuccessMsg("Final check updated");
      const reqId = requirementId; setRequirementId(""); setTimeout(() => setRequirementId(reqId), 50);
      setTimeout(() => setSuccessMsg(""), 3000);
    } catch (err) {
      if (err instanceof ForbiddenError) showToast(err.message, "critical");
      else setErrorMsg(err instanceof Error ? err.message : String(err));
    } finally { setSubmitting(false); }
  };

  const handleUpdateAssemblyStep = async (stepId: number, patch: Partial<AssemblyStep>) => {
    setSubmitting(true); setErrorMsg("");
    try {
      const res = await apiFetch(`${process.env.NEXT_PUBLIC_API_URL || "http://localhost:8003"}/api/v1/production/assembly-steps/${stepId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      if (!res.ok) { const e = await res.json(); throw new Error(e.detail || "Update failed"); }
      setSuccessMsg("Assembly step updated");
      const reqId = requirementId; setRequirementId(""); setTimeout(() => setRequirementId(reqId), 50);
      setTimeout(() => setSuccessMsg(""), 3000);
    } catch (err) {
      if (err instanceof ForbiddenError) showToast(err.message, "critical");
      else setErrorMsg(err instanceof Error ? err.message : String(err));
    } finally { setSubmitting(false); }
  };

  const handleGlobalWeldingSubmit = async (processType: string) => {
    const feet = parseFloat(feetInputs[processType] || "0");
    if (feet <= 0) {
      setErrorMsg("Feet done must be greater than 0");
      return;
    }
    if (!weldingOperatorIds[processType]) {
      setErrorMsg("Select a worker before logging feet.");
      return;
    }

    setSubmitting(true);
    setSuccessMsg("");
    setErrorMsg("");

    try {
      const res = await apiFetch(`${process.env.NEXT_PUBLIC_API_URL || "http://localhost:8003"}/api/v1/production/requirements/${requirementId}/welding_logs`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ process_type: processType, feet_done: feet, operator_id: parseInt(weldingOperatorIds[processType]) }),
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.detail || "Submission failed");
      }

      setSuccessMsg(`Successfully recorded ${feet} feet for ${processType}!`);
      setFeetInputs({ ...feetInputs, [processType]: "" });

      apiFetch(`${process.env.NEXT_PUBLIC_API_URL || "http://localhost:8003"}/api/v1/production/requirements/${requirementId}/welding_summary`)
        .then((res) => res.json())
        .then((resData) => {
          if (resData.success) setWeldingSummary(resData.data);
        });

      setTimeout(() => setSuccessMsg(""), 3000);
    } catch (err) {
      if (err instanceof ForbiddenError) showToast(err.message, "critical");
      else setErrorMsg(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  };

  const currentReqType = requirements.find((r) => r.id.toString() === requirementId)?.type;

  const PAINT_STATUS_OPTIONS = ["Yet to start", "Started", "In progress", "Completed"];

  const visibleTabs = (
    ["Material", "Fabrication", "Assembly", "Welding", "FinalChecks"] as const
  ).filter((tab) => tab !== "Assembly" || assemblySteps.length > 0);

  const handlePaintStatusChange = async (status: string) => {
    const prev = paintStatus;
    setPaintStatus(status);
    setSubmitting(true);
    setSuccessMsg("");
    setErrorMsg("");
    try {
      const res = await apiFetch(`${process.env.NEXT_PUBLIC_API_URL || "http://localhost:8003"}/api/v1/production/requirements/${requirementId}/paint-status`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.detail || "Failed to update paint status");
      }
      setSuccessMsg("Paint status updated");
      setTimeout(() => setSuccessMsg(""), 3000);
    } catch (err) {
      setPaintStatus(prev);
      if (err instanceof ForbiddenError) showToast(err.message, "critical");
      else setErrorMsg(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="mx-auto mb-20 max-w-7xl">
      <div>
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="font-display text-3xl font-extrabold uppercase tracking-wide text-ink">
            Daily Progress Tracker
          </h1>
          {tagNo && <Badge tone="neutral">Tag: {tagNo}</Badge>}
        </div>
        <p className="text-ink-soft">Record quantities and feet completed for each process today.</p>
      </div>

      <div className="mt-6 flex flex-col gap-6">
        {successMsg && (
          <Alert tone="success" title="Saved">
            {successMsg}
          </Alert>
        )}
        {errorMsg && (
          <Alert tone="critical" title="Error">
            {errorMsg}
          </Alert>
        )}

        <Card className="grid grid-cols-1 gap-4 p-5 md:grid-cols-3">
          <div>
            <Label>Project</Label>
            <Select value={projectId} onChange={(e) => setProjectId(e.target.value)}>
              <option value="">-- Choose Project --</option>
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.project_name || p.quotation_no}
                </option>
              ))}
            </Select>
          </div>

          <div>
            <Label>Requirement</Label>
            <Select value={requirementId} onChange={(e) => setRequirementId(e.target.value)} disabled={!projectId}>
              <option value="">-- Choose Requirement --</option>
              {requirements.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.tag_no ? `${r.tag_no} — ` : ""}{r.type} - {r.size} (Qty: {r.total_qty})
                </option>
              ))}
            </Select>
          </div>

          <div>
            <Label>Specific Part (Optional)</Label>
            <Select value={partId} onChange={(e) => setPartId(e.target.value)} disabled={!requirementId}>
              <option value="">All Parts</option>
              {parts.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </Select>
          </div>
        </Card>

        {requirementId && (
          <Card className="flex flex-col gap-2 p-5 md:max-w-xs">
            <Label>Paint Status</Label>
            <Select
              value={paintStatus}
              onChange={(e) => handlePaintStatusChange(e.target.value)}
              disabled={submitting}
            >
              {PAINT_STATUS_OPTIONS.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </Select>
          </Card>
        )}

        {requirementId && parts.length > 0 && (
          <div className="flex flex-col gap-6">
            <div className="border-b border-line pb-4">
              <h2 className="mb-4 text-xl font-bold text-ink">Track Production</h2>
              <div className="flex w-full flex-wrap gap-1 rounded-lg bg-paper p-1">
                {visibleTabs.map((tab) => {
                  const label =
                    tab === "Material" ? "Material Status" :
                    tab === "Fabrication" ? "Fabrication" :
                    tab === "Assembly" ? "Assembly" :
                    tab === "Welding" ? (currentReqType === "DJ" ? "Welding" : "Welding & Grinding") :
                    "Final Checks";
                  return (
                    <button
                      key={tab}
                      onClick={() => setActiveTab(tab)}
                      className={`flex-1 rounded-md px-4 py-2 text-sm font-bold transition-all ${
                        activeTab === tab ? "bg-paper-raised text-brand-deep shadow-sm" : "text-ink-soft hover:text-ink"
                      }`}
                    >
                      {label}
                    </button>
                  );
                })}
              </div>
            </div>

            {activeTab === "Material" ? (
              <div className="grid grid-cols-1 gap-6 lg:grid-cols-2 xl:grid-cols-3">
                {parts
                  .filter((p) => !partId || p.id.toString() === partId)
                  .filter((p) => p.processes.some((proc) => isMaterialProcess(proc.process_name)))
                  .map((part) => (
                    <Card key={part.id}>
                      <div className="flex items-center justify-between bg-ink px-4 py-3 text-white">
                        <h3 className="truncate pr-2 font-bold" title={part.name}>
                          {part.name}
                        </h3>
                        <Badge tone="neutral">Target: {part.total_qty ?? totalQty}</Badge>
                      </div>

                      <div className="divide-y divide-line">
                        {part.processes
                          .filter((proc) => isMaterialProcess(proc.process_name))
                          .map((proc) => {
                            const partTarget = part.total_qty ?? totalQty;
                            const pending = partTarget - proc.completed_qty;
                            const isComplete = pending <= 0;

                            return (
                              <div key={proc.id} className={`flex flex-col gap-3 p-4 ${isComplete ? "bg-success-tint/40" : ""}`}>
                                <div className="flex items-center justify-between">
                                  <span className={`font-bold ${isComplete ? "text-success" : "text-ink"}`}>
                                    {proc.process_name}
                                    {/^PO$/i.test(proc.process_name) && (
                                      <span className="ml-2 text-xs font-normal text-ink-soft">(Optional)</span>
                                    )}
                                  </span>
                                  <div className="flex flex-wrap gap-2">
                                    <Badge tone="success">Done: {proc.completed_qty}</Badge>
                                    <Badge tone="critical">Pend: {proc.qty_pending ?? Math.max(0, pending)}</Badge>
                                    {proc.status && proc.status !== "pending" && <Badge tone="neutral">{proc.status}</Badge>}
                                    {proc.po_number && <Badge tone="neutral">PO: {proc.po_number}</Badge>}
                                  </div>
                                </div>

                                {!isComplete && (
                                  <div className="mt-2 flex flex-col gap-2">
                                    {/^PO$/i.test(proc.process_name) && (
                                      <Input
                                        placeholder="PO Number (optional)"
                                        value={qtyInputs[`po_${proc.id}`] || ""}
                                        onChange={(e) => setQtyInputs({ ...qtyInputs, [`po_${proc.id}`]: e.target.value })}
                                      />
                                    )}
                                    <Input
                                      type="number"
                                      min="1"
                                      max={pending}
                                      placeholder="Today's Qty"
                                      value={qtyInputs[proc.id] || ""}
                                      onChange={(e) => handleQtyChange(proc.id, e.target.value)}
                                    />
                                    <Button
                                      variant="primary"
                                      className="w-full justify-center"
                                      disabled={submitting || !qtyInputs[proc.id]}
                                      onClick={() => handleSubmitProcess(proc.id, proc.process_name)}
                                    >
                                      Save
                                    </Button>
                                  </div>
                                )}
                                {isComplete && (
                                  <div className="mt-1 flex items-center gap-1 text-sm font-bold text-success">
                                    <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                                      <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                                    </svg>
                                    Fully Completed
                                  </div>
                                )}
                              </div>
                            );
                          })}
                      </div>
                    </Card>
                  ))}
                {parts.filter((p) => !partId || p.id.toString() === partId).filter((p) => p.processes.some((proc) => isMaterialProcess(proc.process_name))).length === 0 && (
                  <div className="col-span-full rounded-lg border border-dashed border-line py-12 text-center">
                    <p className="text-ink-soft">No material steps for this requirement.</p>
                  </div>
                )}
              </div>
            ) : activeTab === "Fabrication" ? (
              <div className="grid grid-cols-1 gap-6 lg:grid-cols-2 xl:grid-cols-3">
                {parts
                  .filter((p) => !partId || p.id.toString() === partId)
                  .map((part) => (
                    <Card key={part.id}>
                      <div className="flex items-center justify-between bg-ink px-4 py-3 text-white">
                        <h3 className="truncate pr-2 font-bold" title={part.name}>
                          {part.name}
                        </h3>
                        <Badge tone="neutral">Target: {part.total_qty ?? totalQty}</Badge>
                      </div>

                      <div className="divide-y divide-line">
                        {(() => {
                          const fabProcs = getFabProcesses(part);
                          const matQty = getMaterialReceivedQty(part);
                          return fabProcs.map((proc, fabIdx) => {
                            const partTarget = part.total_qty ?? totalQty;
                            const pending = partTarget - proc.completed_qty;
                            const isComplete = pending <= 0;
                            const maxQty = fabIdx === 0 ? matQty : (fabProcs[fabIdx - 1]?.completed_qty ?? 0);
                            const isGated = !isComplete && maxQty === 0;

                            return (
                              <div key={proc.id} className={`flex flex-col gap-3 p-4 ${isComplete ? "bg-success-tint/40" : ""}`}>
                                <div className="flex items-center justify-between">
                                  <span className={`font-bold ${isComplete ? "text-success" : "text-ink"}`}>
                                    {proc.process_name}
                                  </span>
                                  <div className="flex flex-wrap gap-2">
                                    <Badge tone="success">Done: {proc.completed_qty}</Badge>
                                    <Badge tone="critical">Pend: {proc.qty_pending ?? Math.max(0, pending)}</Badge>
                                    {proc.status && proc.status !== "pending" && <Badge tone="neutral">{proc.status}</Badge>}
                                    {proc.po_number && <Badge tone="neutral">PO: {proc.po_number}</Badge>}
                                  </div>
                                </div>

                                {!isComplete && (
                                  <div className="mt-2 flex flex-col gap-2">
                                    {isGated && (
                                      <p className="text-xs italic text-ink-soft">
                                        {fabIdx === 0 ? "Awaiting material receipt" : `Awaiting: ${fabProcs[fabIdx - 1].process_name}`}
                                      </p>
                                    )}
                                    <Input
                                      type="number"
                                      min="1"
                                      max={Math.min(pending, maxQty || Infinity)}
                                      placeholder="Today's Qty"
                                      value={qtyInputs[proc.id] || ""}
                                      onChange={(e) => handleQtyChange(proc.id, e.target.value)}
                                      disabled={isGated}
                                    />
                                    <Button
                                      variant="primary"
                                      className="w-full justify-center"
                                      disabled={submitting || isGated || !qtyInputs[proc.id]}
                                      onClick={() => handleSubmitProcess(proc.id, proc.process_name)}
                                    >
                                      Save
                                    </Button>
                                  </div>
                                )}
                                {isComplete && (
                                  <div className="mt-1 flex items-center gap-1 text-sm font-bold text-success">
                                    <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                                      <path
                                        fillRule="evenodd"
                                        d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z"
                                        clipRule="evenodd"
                                      />
                                    </svg>
                                    Fully Completed
                                  </div>
                                )}
                              </div>
                            );
                          });
                        })()}
                        {getFabProcesses(part).length === 0 && (
                          <div className="p-4 text-center text-sm italic text-ink-soft">
                            No fabrication processes for this part.
                          </div>
                        )}
                      </div>
                    </Card>
                  ))}

                {parts.filter((p) => !partId || p.id.toString() === partId).length === 0 && (
                  <div className="col-span-full rounded-lg border border-dashed border-line py-12 text-center">
                    <h3 className="mb-2 text-lg font-bold text-ink">No Parts Found</h3>
                    <p className="text-ink-soft">There are no parts for this requirement.</p>
                  </div>
                )}
              </div>
            ) : activeTab === "Assembly" ? (
              <Card className="p-5">
                <div className="mb-3 flex items-center gap-2">
                  <h3 className="font-bold text-ink">Proposed Assembly Sequence</h3>
                  <Badge tone="warning">Pending GM sign-off</Badge>
                </div>
                <div className="divide-y divide-line">
                  {[...assemblySteps]
                    .sort((a, b) => a.step_no - b.step_no)
                    .map((step, idx, sorted) => {
                      const stepPending = Math.max(0, totalQty - step.completed_qty);
                      const maxQty = idx === 0 ? totalQty : (sorted[idx - 1]?.completed_qty ?? 0);
                      const isGated = step.status !== "ready" && maxQty === 0;
                      const stepDone = step.completed_qty;
                      const inputKey = `assembly_${step.id}`;
                      return (
                        <div key={step.id} className={`flex flex-col gap-3 p-4 ${step.status === "ready" ? "bg-success-tint/40" : ""}`}>
                          <div className="flex flex-wrap items-center gap-2">
                            <span className={`font-bold ${step.status === "ready" ? "text-success" : "text-ink"}`}>
                              {step.step_no}. {step.label}
                            </span>
                            <Badge tone={step.status === "ready" ? "success" : "neutral"}>{step.status}</Badge>
                          </div>
                          <div className="flex flex-wrap gap-2">
                            <Badge tone="success">Done: {stepDone}</Badge>
                            <Badge tone="critical">Pend: {stepPending}</Badge>
                            <Badge tone="neutral">Target: {totalQty}</Badge>
                          </div>
                          {isGated && (
                            <p className="text-xs italic text-ink-soft">
                              Awaiting: {sorted[idx - 1]?.label}
                            </p>
                          )}
                          <div className="flex flex-wrap items-center gap-2">
                            <Input
                              type="number"
                              min="1"
                              max={Math.min(stepPending, maxQty || Infinity)}
                              placeholder="Today's Qty"
                              value={qtyInputs[inputKey] || ""}
                              onChange={(e) => setQtyInputs({ ...qtyInputs, [inputKey]: e.target.value })}
                              className="w-36"
                              disabled={isGated}
                            />
                            <Button
                              variant="secondary"
                              disabled={submitting || isGated || !qtyInputs[inputKey]}
                              onClick={() => {
                                const add = parseInt(qtyInputs[inputKey] || "0");
                                if (add > 0) {
                                  handleUpdateAssemblyStep(step.id, { completed_qty: step.completed_qty + add });
                                  setQtyInputs({ ...qtyInputs, [inputKey]: "" });
                                }
                              }}
                            >
                              Save Qty
                            </Button>
                            <Button
                              variant={step.status === "ready" ? "secondary" : "primary"}
                              disabled={submitting || (isGated && step.status !== "ready")}
                              onClick={() => handleUpdateAssemblyStep(step.id, { status: step.status === "ready" ? "pending" : "ready", date_ready: new Date().toISOString().slice(0, 10) })}
                            >
                              {step.status === "ready" ? "Mark Pending" : "Mark Ready"}
                            </Button>
                          </div>
                        </div>
                      );
                    })}
                </div>
              </Card>
            ) : activeTab === "Welding" ? (
              <div className="flex flex-col gap-10">
                <div>
                  <h3 className="mb-4 text-lg font-bold text-ink">Welding Footage</h3>
                  <div className="grid grid-cols-1 gap-6 md:grid-cols-3">
                    {(currentReqType === "DJ" ? ["MIG", "Grinding"] : ["TIG", "MIG", "Grinding"]).map((type) => {
                      const isDJ = currentReqType === "DJ";
                      const displayType = isDJ && type === "MIG" ? "Welding" : type;
                      const target = weldingSummary?.targets?.[type] || 0;
                      const completed = weldingSummary?.completed?.[type] || 0;
                      const pending = Math.max(0, target - completed);
                      const isComplete = pending <= 0 && target > 0;
                      return (
                        <Card key={type}>
                          <div className={`flex items-center justify-between px-4 py-3 text-white ${isComplete ? "bg-success" : "bg-brand"}`}>
                            <h3 className="font-bold">{displayType}</h3>
                            <Badge tone="neutral">Target: {target.toFixed(1)} ft</Badge>
                          </div>
                          <div className="flex flex-col gap-4 p-5">
                            <div className="flex items-center justify-between rounded-md border border-line bg-paper p-3">
                              <div className="text-center">
                                <div className="text-xs font-bold uppercase tracking-wide text-ink-soft">Done</div>
                                <div className="font-data tabular-nums text-lg font-bold text-brand-deep">
                                  {completed.toFixed(1)} <span className="text-sm font-normal text-ink-soft">ft</span>
                                </div>
                              </div>
                              <div className="h-8 w-px bg-line" />
                              <div className="text-center">
                                <div className="text-xs font-bold uppercase tracking-wide text-ink-soft">Pending</div>
                                <div className="font-data tabular-nums text-lg font-bold text-critical">
                                  {pending.toFixed(1)} <span className="text-sm font-normal text-ink-soft">ft</span>
                                </div>
                              </div>
                            </div>
                            {!isComplete && target > 0 ? (
                              <div className="mt-2 flex flex-col gap-2">
                                {(() => {
                                  const workers = todayWorkOrders.filter((wo) => wo.process_type === type);
                                  return workers.length === 0 ? (
                                    <p className="text-xs text-critical">No workers assigned to {displayType} today. Generate work orders first.</p>
                                  ) : (
                                    <Select
                                      value={weldingOperatorIds[type] || ""}
                                      onChange={(e) => setWeldingOperatorIds({ ...weldingOperatorIds, [type]: e.target.value })}
                                    >
                                      <option value="">-- Select Worker --</option>
                                      {workers.map((wo) => (
                                        <option key={wo.id} value={wo.user_id}>
                                          {wo.user?.full_name ?? `Worker #${wo.user_id}`} — {wo.target_feet.toFixed(1)} ft target
                                        </option>
                                      ))}
                                    </Select>
                                  );
                                })()}
                                <Input
                                  type="number"
                                  min="0.1"
                                  step="0.1"
                                  placeholder="Today's Feet Done"
                                  value={feetInputs[type] || ""}
                                  onChange={(e) => handleFeetChange(type, e.target.value)}
                                />
                                <Button
                                  variant="primary"
                                  className="w-full justify-center"
                                  disabled={submitting || !feetInputs[type] || !weldingOperatorIds[type]}
                                  onClick={() => handleGlobalWeldingSubmit(type)}
                                >
                                  Log {displayType} Progress
                                </Button>
                              </div>
                            ) : target === 0 ? (
                              <div className="py-4 text-center italic text-ink-soft">No {displayType} required for this size.</div>
                            ) : (
                              <div className="py-4 text-center font-bold text-success">Target Reached!</div>
                            )}
                          </div>
                        </Card>
                      );
                    })}
                  </div>
                </div>

                <div>
                  <h3 className="mb-4 text-lg font-bold text-ink">Component Welding Steps</h3>
                  <div className="grid grid-cols-1 gap-6 lg:grid-cols-2 xl:grid-cols-3">
                    {parts
                      .filter((p) => !partId || p.id.toString() === partId)
                      .filter((p) => p.processes.some((proc) => isWeldingProcess(proc.process_name)))
                      .map((part) => (
                        <Card key={part.id}>
                          <div className="flex items-center justify-between bg-ink px-4 py-3 text-white">
                            <h3 className="truncate pr-2 font-bold" title={part.name}>{part.name}</h3>
                            <Badge tone="neutral">Target: {part.total_qty ?? totalQty}</Badge>
                          </div>
                          <div className="divide-y divide-line">
                            {part.processes
                              .filter((proc) => isWeldingProcess(proc.process_name))
                              .map((proc) => {
                                const partTarget = part.total_qty ?? totalQty;
                                const pending = partTarget - proc.completed_qty;
                                const isComplete = pending <= 0;
                                return (
                                  <div key={proc.id} className={`flex flex-col gap-3 p-4 ${isComplete ? "bg-success-tint/40" : ""}`}>
                                    <div className="flex items-center justify-between">
                                      <span className={`font-bold ${isComplete ? "text-success" : "text-ink"}`}>
                                        {proc.process_name}
                                      </span>
                                      <div className="flex flex-wrap gap-2">
                                        <Badge tone="success">Done: {proc.completed_qty}</Badge>
                                        <Badge tone="critical">Pend: {proc.qty_pending ?? Math.max(0, pending)}</Badge>
                                        {proc.status && proc.status !== "pending" && <Badge tone="neutral">{proc.status}</Badge>}
                                      </div>
                                    </div>
                                    {!isComplete && (
                                      <div className="mt-2 flex flex-col gap-2">
                                        <Input
                                          type="number"
                                          min="1"
                                          max={pending}
                                          placeholder="Today's Qty"
                                          value={qtyInputs[proc.id] || ""}
                                          onChange={(e) => handleQtyChange(proc.id, e.target.value)}
                                        />
                                        <Button
                                          variant="primary"
                                          className="w-full justify-center"
                                          disabled={submitting || !qtyInputs[proc.id]}
                                          onClick={() => handleSubmitProcess(proc.id, proc.process_name)}
                                        >
                                          Save
                                        </Button>
                                      </div>
                                    )}
                                    {isComplete && (
                                      <div className="mt-1 flex items-center gap-1 text-sm font-bold text-success">
                                        <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                                          <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                                        </svg>
                                        Fully Completed
                                      </div>
                                    )}
                                  </div>
                                );
                              })}
                          </div>
                        </Card>
                      ))}
                    {parts
                      .filter((p) => !partId || p.id.toString() === partId)
                      .filter((p) => p.processes.some((proc) => isWeldingProcess(proc.process_name)))
                      .length === 0 && (
                      <div className="col-span-full rounded-lg border border-dashed border-line py-12 text-center">
                        <p className="text-ink-soft">No welding steps for this requirement.</p>
                      </div>
                    )}
                  </div>
                </div>

              </div>
            ) : null}

            {activeTab === "FinalChecks" && (
              finalChecks.length > 0 ? (
                <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-4">
                  {finalChecks.filter((c) => ["testing", "painting", "weight", "marking", "packing"].includes(c.check_type)).map((c) => (
                    <Card key={c.id} className="p-4">
                      <div className="mb-3 flex items-center justify-between">
                        <h3 className="font-bold capitalize text-ink">{c.check_type}</h3>
                        <Badge tone={c.status === "ready" ? "success" : "neutral"}>{c.status}</Badge>
                      </div>
                      {c.test_method && <p className="text-sm text-ink-soft">Method: {c.test_method}</p>}
                      {c.marking_type && <p className="text-sm text-ink-soft">Marking: {c.marking_type}</p>}
                      {c.check_type === "weight" && (
                        <Input
                          type="number" step="0.1" placeholder="Weight (kgs)"
                          defaultValue={c.weight_kgs ?? ""}
                          onBlur={(e) => e.target.value && handleUpdateCheck(c.id, { weight_kgs: parseFloat(e.target.value) })}
                          className="mt-2"
                        />
                      )}
                      {c.check_type === "painting" && (
                        <Input
                          placeholder="Paint spec"
                          defaultValue={c.paint_spec ?? ""}
                          onBlur={(e) => e.target.value && handleUpdateCheck(c.id, { paint_spec: e.target.value })}
                          className="mt-2"
                        />
                      )}
                      <Button
                        variant={c.status === "ready" ? "secondary" : "primary"}
                        className="mt-3 w-full justify-center"
                        disabled={submitting}
                        onClick={() => handleUpdateCheck(c.id, { status: c.status === "ready" ? "pending" : "ready", date_ready: new Date().toISOString().slice(0, 10) })}
                      >
                        {c.status === "ready" ? "Mark Pending" : "Mark Ready"}
                      </Button>
                    </Card>
                  ))}
                </div>
              ) : (
                <div className="rounded-lg border border-dashed border-line py-12 text-center">
                  <p className="text-ink-soft">No final checks for this requirement.</p>
                </div>
              )
            )}

          </div>
        )}
      </div>
      {toasts}
    </div>
  );
}
