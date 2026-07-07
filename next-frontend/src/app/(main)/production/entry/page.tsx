"use client";
import { apiFetch } from "@/lib/api";

import { useState, useEffect } from "react";
import { Card, Select, Label, Button, Input, Badge, Alert } from "@/components/ui";

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

interface PartRow {
  id: string;
  name: string;
  processes: ProcessRow[];
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

  const [qtyInputs, setQtyInputs] = useState<{ [key: string]: string }>({});
  const [feetInputs, setFeetInputs] = useState<{ [key: string]: string }>({});
  const [submitting, setSubmitting] = useState(false);
  const [successMsg, setSuccessMsg] = useState("");
  const [errorMsg, setErrorMsg] = useState("");

  const [finalChecks, setFinalChecks] = useState<FinalCheck[]>([]);
  const [activeTab, setActiveTab] = useState("Fabrication");

  const isWeldingProcess = (name: string) => /weld|grind|tig|mig/i.test(name);

  useEffect(() => {
    apiFetch(`${process.env.NEXT_PUBLIC_API_URL || "http://localhost:8003"}/api/v1/projects`)
      .then((res) => res.json())
      .then((resData) => setProjects((resData.data || []).filter((p: ProjectOption) => p.status !== "Completed")));
  }, []);

  useEffect(() => {
    if (!projectId) {
      setRequirements([]);
      setRequirementId("");
      return;
    }
    apiFetch(`${process.env.NEXT_PUBLIC_API_URL || "http://localhost:8003"}/api/v1/production/requirements/${projectId}`)
      .then((res) => res.json())
      .then((resData) => setRequirements(resData.data || []));
  }, [projectId]);

  useEffect(() => {
    if (!requirementId) {
      setParts([]);
      setPartId("");
      setTotalQty(0);
      return;
    }
    apiFetch(`${process.env.NEXT_PUBLIC_API_URL || "http://localhost:8003"}/api/v1/production/parts/${requirementId}`)
      .then((res) => res.json())
      .then((resData) => {
        if (resData.success && resData.data) {
          setTotalQty(resData.data.total_qty);
          setParts(resData.data.parts);
          setFinalChecks(resData.data.final_checks || []);
        }
      });

    apiFetch(`${process.env.NEXT_PUBLIC_API_URL || "http://localhost:8003"}/api/v1/production/requirements/${requirementId}/welding_summary`)
      .then((res) => res.json())
      .then((resData) => {
        if (resData.success) {
          setWeldingSummary(resData.data);
        }
      });
  }, [requirementId]);

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
      setErrorMsg(err instanceof Error ? err.message : String(err));
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
      setErrorMsg(err instanceof Error ? err.message : String(err));
    } finally { setSubmitting(false); }
  };

  const handleGlobalWeldingSubmit = async (processType: string) => {
    const feet = parseFloat(feetInputs[processType] || "0");
    if (feet <= 0) {
      setErrorMsg("Feet done must be greater than 0");
      return;
    }

    setSubmitting(true);
    setSuccessMsg("");
    setErrorMsg("");

    try {
      const res = await apiFetch(`${process.env.NEXT_PUBLIC_API_URL || "http://localhost:8003"}/api/v1/production/requirements/${requirementId}/welding_logs`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ process_type: processType, feet_done: feet }),
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
      setErrorMsg(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  };

  const currentReqType = requirements.find((r) => r.id.toString() === requirementId)?.type;

  return (
    <div className="mx-auto mb-20 max-w-7xl">
      <div>
        <h1 className="font-display text-3xl font-extrabold uppercase tracking-wide text-ink">
          Daily Progress Tracker
        </h1>
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
                  {r.type} - {r.size} (Qty: {r.total_qty})
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

        {requirementId && parts.length > 0 && (
          <div className="flex flex-col gap-6">
            <div className="border-b border-line pb-4">
              <h2 className="mb-4 text-xl font-bold text-ink">Track Production</h2>
              <div className="flex w-full max-w-md rounded-lg bg-paper p-1">
                <button
                  onClick={() => setActiveTab("Fabrication")}
                  className={`flex-1 rounded-md px-4 py-2 text-sm font-bold transition-all ${
                    activeTab === "Fabrication" ? "bg-paper-raised text-brand-deep shadow-sm" : "text-ink-soft hover:text-ink"
                  }`}
                >
                  Fabrication &amp; Assembly
                </button>
                <button
                  onClick={() => setActiveTab("Welding")}
                  className={`flex-1 rounded-md px-4 py-2 text-sm font-bold transition-all ${
                    activeTab === "Welding" ? "bg-paper-raised text-brand-deep shadow-sm" : "text-ink-soft hover:text-ink"
                  }`}
                >
                  {currentReqType === "DJ" ? "Welding" : "Welding & Grinding"}
                </button>
              </div>
            </div>

            {activeTab === "Fabrication" ? (
              <div className="grid grid-cols-1 gap-6 lg:grid-cols-2 xl:grid-cols-3">
                {parts
                  .filter((p) => !partId || p.id.toString() === partId)
                  .map((part) => (
                    <Card key={part.id}>
                      <div className="flex items-center justify-between bg-ink px-4 py-3 text-white">
                        <h3 className="truncate pr-2 font-bold" title={part.name}>
                          {part.name}
                        </h3>
                        <Badge tone="neutral">Target: {totalQty}</Badge>
                      </div>

                      <div className="divide-y divide-line">
                        {part.processes
                          .filter((proc) => !isWeldingProcess(proc.process_name))
                          .map((proc) => {
                            const pending = totalQty - proc.completed_qty;
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
                                    {proc.status && <Badge tone="neutral">{proc.status}</Badge>}
                                    {proc.po_number && <Badge tone="neutral">PO: {proc.po_number}</Badge>}
                                  </div>
                                </div>

                                {!isComplete && (
                                  <div className="mt-2 flex flex-col gap-2">
                                    {/PO|Material Received/i.test(proc.process_name) && (
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
                          })}
                        {part.processes.filter((proc) => !isWeldingProcess(proc.process_name)).length === 0 && (
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
            ) : (
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
                              disabled={submitting || !feetInputs[type]}
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
            )}

            {finalChecks.length > 0 && (
              <div className="border-t border-line pt-6">
                <h2 className="mb-4 text-xl font-bold text-ink">Final Checks</h2>
                <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-4">
                  {finalChecks.map((c) => (
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
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
