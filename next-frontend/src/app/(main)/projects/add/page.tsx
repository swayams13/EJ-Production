"use client";
import { apiFetch } from "@/lib/api";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Card, CardHeader, CardBody, Button, Input, Select, Label, Alert, Modal, Spinner, useToast } from "@/components/ui";

interface MasterSize {
  size: number;
  type: string;
}

interface BellowRow {
  size: string | number;
  qty: number;
  type: string;
  pn_rating: string;
}

interface Simulation {
  invalidDate?: boolean;
  days?: number;
  req_tig?: number;
  req_mig?: number;
  req_grind?: number;
}

export default function AddProjects() {
  const router = useRouter();
  const { showToast, toasts } = useToast();
  const [masterData, setMasterData] = useState<MasterSize[]>([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  const [quotationNo, setQuotationNo] = useState("");
  const [payroll, setPayroll] = useState("Company");
  const [startDate, setStartDate] = useState(new Date(Date.now() + 86400000).toISOString().split("T")[0]);
  const [targetDate, setTargetDate] = useState("");
  const [bellows, setBellows] = useState<BellowRow[]>([{ size: "", qty: 1, type: "EJ", pn_rating: "" }]);

  const [assignedTig, setAssignedTig] = useState<number>(0);
  const [assignedMig, setAssignedMig] = useState<number>(0);
  const [assignedGrinders, setAssignedGrinders] = useState<number>(0);

  const [simulation, setSimulation] = useState<Simulation | null>(null);
  const [duration, setDuration] = useState<number | null>(null);

  const [customSizeModalOpen, setCustomSizeModalOpen] = useState(false);
  const [customSizeData, setCustomSizeData] = useState({ size: "", tig_feet: "", mig_feet: "", grinding_feet: "", joint_type: "EJ" });
  const [customSizeRowIndex, setCustomSizeRowIndex] = useState(-1);
  const [savingCustomSize, setSavingCustomSize] = useState(false);

  useEffect(() => {
    apiFetch(`${process.env.NEXT_PUBLIC_API_URL || "http://localhost:8003"}/api/v1/master/welding`)
      .then((res) => res.json())
      .then((resData) => {
        const data = resData.data || [];
        setMasterData(data);
        setLoading(false);
      });
  }, []);

  useEffect(() => {
    const validBellows = bellows
      .filter((b) => b.size && b.qty > 0)
      .map((b) => ({ size: Number(b.size), qty: Number(b.qty), type: b.type, pn_rating: b.pn_rating }));

    if (validBellows.length > 0 && targetDate && startDate) {
      const start = new Date(startDate);
      const target = new Date(targetDate);
      const days = Math.ceil((target.getTime() - start.getTime()) / (1000 * 3600 * 24));

      if (days > 0) {
        apiFetch(`${process.env.NEXT_PUBLIC_API_URL || "http://localhost:8003"}/api/v1/projects/simulate`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ target_days: days, bellows: validBellows }),
        })
          .then((res) => res.json())
          .then((resData) => setSimulation({ ...resData.data, days }))
          .catch((err) => console.error(err));
      } else {
        setSimulation({ invalidDate: true });
      }
    } else {
      setSimulation(null);
    }

    if (validBellows.length > 0 && (assignedTig > 0 || assignedMig > 0 || assignedGrinders > 0)) {
      apiFetch(`${process.env.NEXT_PUBLIC_API_URL || "http://localhost:8003"}/api/v1/projects/simulate_duration`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          bellows: validBellows,
          assigned_tig: assignedTig,
          assigned_mig: assignedMig,
          assigned_grinders: assignedGrinders,
        }),
      })
        .then((res) => res.json())
        .then((resData) => setDuration(resData.data ? resData.data.estimated_duration_days : 0))
        .catch((err) => console.error(err));
    } else {
      setDuration(null);
    }
  }, [bellows, targetDate, startDate, assignedTig, assignedMig, assignedGrinders]);

  useEffect(() => {
    const validBellows = bellows
      .filter((b) => b.size && b.qty > 0)
      .map((b) => ({ size: Number(b.size), qty: Number(b.qty), type: b.type, pn_rating: b.pn_rating }));

    if (validBellows.length > 0) {
      apiFetch(`${process.env.NEXT_PUBLIC_API_URL || "http://localhost:8003"}/api/v1/projects/simulate_resources`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ bellows: validBellows, target_date: targetDate || null }),
      })
        .then((res) => res.json())
        .then((resData) => {
          if (resData.data) {
            setAssignedTig(resData.data.assigned_tig);
            setAssignedMig(resData.data.assigned_mig);
            setAssignedGrinders(resData.data.assigned_grinders);
          }
        })
        .catch((err) => console.error(err));
    }
  }, [bellows, targetDate]);

  const handleAddBellow = () => {
    setBellows([...bellows, { size: "", qty: 1, type: "EJ", pn_rating: "" }]);
  };

  const handleRemoveBellow = (index: number) => {
    setBellows(bellows.filter((_, i) => i !== index));
  };

  const handleBellowChange = (index: number, field: "size" | "qty" | "type" | "pn_rating", value: string | number) => {
    if (field === "size" && value === "CUSTOM") {
      setCustomSizeRowIndex(index);
      setCustomSizeData({ size: "", tig_feet: "", mig_feet: "", grinding_feet: "", joint_type: bellows[index].type || "EJ" });
      setCustomSizeModalOpen(true);
      return;
    }
    const newBellows = [...bellows];
    newBellows[index] = { ...newBellows[index], [field]: value };
    setBellows(newBellows);
  };

  const saveCustomSize = async () => {
    try {
      setSavingCustomSize(true);
      const res = await apiFetch(`${process.env.NEXT_PUBLIC_API_URL || "http://localhost:8003"}/api/v1/master/welding-size`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          size: Number(customSizeData.size),
          tig_feet: Number(customSizeData.tig_feet),
          mig_feet: Number(customSizeData.mig_feet),
          grinding_feet: Number(customSizeData.grinding_feet),
          joint_type: customSizeData.joint_type,
        }),
      });
      const data = await res.json();
      if (data.success) {
        setMasterData([...masterData, data.data]);
        const newBellows = [...bellows];
        newBellows[customSizeRowIndex].size = data.data.size;
        setBellows(newBellows);
        setCustomSizeModalOpen(false);
      } else {
        showToast(data.detail || data.message || "Failed to save custom size", "critical");
      }
    } catch {
      showToast("Network error while saving size", "critical");
    } finally {
      setSavingCustomSize(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setError("");

    const validBellows = bellows
      .filter((b) => b.size && b.qty > 0)
      .map((b) => ({ size: Number(b.size), qty: Number(b.qty), type: b.type, pn_rating: b.pn_rating }));

    try {
      const res = await apiFetch(`${process.env.NEXT_PUBLIC_API_URL || "http://localhost:8003"}/api/v1/projects`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          quotation_no: quotationNo,
          target_date: targetDate || null,
          payroll: payroll,
          bellows: validBellows,
          assigned_tig: assignedTig,
          assigned_mig: assignedMig,
          assigned_grinders: assignedGrinders,
        }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || "Failed to create project");

      router.push("/dashboard");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setSubmitting(false);
    }
  };

  if (loading) return <Spinner label="Loading form…" />;

  return (
    <div className="mx-auto max-w-4xl">
      <h1 className="font-display text-3xl font-extrabold uppercase tracking-wide text-ink">Create New Project</h1>
      <p className="mb-8 text-ink-soft">Add a new project and assign its expansion joints.</p>

      <form onSubmit={handleSubmit} className="flex flex-col gap-8">
        <Card>
          <CardHeader title="Project Details" />
          <CardBody className="grid grid-cols-1 gap-6 p-5 md:grid-cols-2 lg:grid-cols-4">
            <div>
              <Label>Project Code *</Label>
              <Input required placeholder="e.g. PROJ-001" value={quotationNo} onChange={(e) => setQuotationNo(e.target.value)} />
            </div>
            <div>
              <Label>Payroll Option</Label>
              <Select value={payroll} onChange={(e) => setPayroll(e.target.value)}>
                <option value="Company">Company</option>
                <option value="Contractor">Contractor</option>
              </Select>
            </div>
            <div>
              <Label>Start Date</Label>
              <Input type="date" required value={startDate} onChange={(e) => setStartDate(e.target.value)} />
            </div>
            <div>
              <Label>Target Deadline</Label>
              <Input type="date" required value={targetDate} onChange={(e) => setTargetDate(e.target.value)} />
            </div>
          </CardBody>
        </Card>

        <Card>
          <CardHeader
            title="Joints & Bellows"
            action={
              <Button type="button" variant="ghost" onClick={handleAddBellow}>
                + Add Row
              </Button>
            }
          />
          <CardBody className="gap-4 p-5">
            {bellows.map((bellow, index) => (
              <div key={index} className="flex items-end gap-4">
                <div className="w-12 text-center">
                  <Label>Sr. No.</Label>
                  <div className="py-2 text-sm font-semibold text-ink">{index + 1}</div>
                </div>
                <div className="w-48">
                  <Label>Type</Label>
                  <Select
                    value={bellow.type}
                    onChange={(e) => handleBellowChange(index, "type", e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter") e.preventDefault(); }}
                    required
                  >
                    <option value="EJ">Expansion Joint</option>
                    <option value="DJ">Dismantling Joint</option>
                  </Select>
                </div>
                <div className="w-32">
                  <Label>PN Rating</Label>
                  <Select
                    value={bellow.pn_rating || ""}
                    onChange={(e) => handleBellowChange(index, "pn_rating", e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter") e.preventDefault(); }}
                  >
                    <option value="">None</option>
                    <option value="PN 6">PN 6</option>
                    <option value="PN 10">PN 10</option>
                    <option value="PN 16">PN 16</option>
                    <option value="PN 20">PN 20</option>
                    <option value="PN 25">PN 25</option>
                  </Select>
                </div>
                <div className="flex-1">
                  <Label>Size (NB)</Label>
                  <Select
                    value={bellow.size}
                    onChange={(e) => handleBellowChange(index, "size", e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter") e.preventDefault(); }}
                    required
                  >
                    <option value="">Select Size</option>
                    {masterData.filter((m) => m.type === bellow.type).map((m) => (
                      <option key={`${m.size}-${m.type}`} value={m.size}>
                        {m.size} NB
                      </option>
                    ))}
                    <option value="CUSTOM">+ Add Custom Size</option>
                  </Select>
                </div>
                <div className="w-32">
                  <Label>Quantity</Label>
                  <Input
                    type="number"
                    min="1"
                    required
                    value={bellow.qty}
                    onChange={(e) => handleBellowChange(index, "qty", parseInt(e.target.value) || 0)}
                    onKeyDown={(e) => { if (e.key === "Enter") e.preventDefault(); }}
                  />
                </div>
                {bellows.length > 1 && (
                  <Button type="button" variant="ghost" className="text-critical hover:bg-critical-tint" onClick={() => handleRemoveBellow(index)}>
                    Remove
                  </Button>
                )}
              </div>
            ))}
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="Manual Resource Assignment (Optional)" />
          <CardBody className="p-5">
            <div className="grid grid-cols-1 gap-6 md:grid-cols-3">
              <div>
                <Label>TIG Welders</Label>
                <Input type="number" min="0" value={assignedTig} onChange={(e) => setAssignedTig(parseInt(e.target.value) || 0)} />
              </div>
              <div>
                <Label>MIG Welders</Label>
                <Input type="number" min="0" value={assignedMig} onChange={(e) => setAssignedMig(parseInt(e.target.value) || 0)} />
              </div>
              <div>
                <Label>Grinders</Label>
                <Input type="number" min="0" value={assignedGrinders} onChange={(e) => setAssignedGrinders(parseInt(e.target.value) || 0)} />
              </div>
            </div>

            {duration !== null && (
              <div className="mt-6">
                <Alert tone="info" title="Estimated Time Required">
                  Based on these assigned resources, it will take <strong>{duration} working days</strong> to
                  complete.
                </Alert>
              </div>
            )}
          </CardBody>
        </Card>

        {simulation && (
          <div>
            {simulation.invalidDate ? (
              <Alert tone="warning" title="Invalid deadline">
                The target deadline is today or in the past.
              </Alert>
            ) : (
              <Card className="border-brand/20 bg-brand-tint p-5">
                <h3 className="mb-2 text-sm font-bold text-brand-deep">Algorithmic Suggestion</h3>
                <p className="text-sm text-brand-deep">
                  To complete this work by the deadline (which is <strong>{simulation.days} working days</strong>{" "}
                  away), you will need approximately:
                </p>
                <div className="mt-4 grid grid-cols-3 gap-4">
                  <div className="rounded-md border border-brand/20 bg-paper-raised p-3 text-center">
                    <div className="font-data tabular-nums text-2xl font-bold text-brand-deep">{simulation.req_tig}</div>
                    <div className="mt-1 text-xs font-semibold uppercase text-ink-soft">TIG Welders</div>
                  </div>
                  <div className="rounded-md border border-brand/20 bg-paper-raised p-3 text-center">
                    <div className="font-data tabular-nums text-2xl font-bold text-brand-deep">{simulation.req_mig}</div>
                    <div className="mt-1 text-xs font-semibold uppercase text-ink-soft">MIG Welders</div>
                  </div>
                  <div className="rounded-md border border-brand/20 bg-paper-raised p-3 text-center">
                    <div className="font-data tabular-nums text-2xl font-bold text-brand-deep">{simulation.req_grind}</div>
                    <div className="mt-1 text-xs font-semibold uppercase text-ink-soft">Grinders</div>
                  </div>
                </div>
              </Card>
            )}
          </div>
        )}

        {error && <Alert tone="critical" title="Error">{error}</Alert>}

        <div className="flex justify-end pt-4">
          <Button type="submit" variant="primary" disabled={submitting}>
            {submitting ? "Creating Project…" : "Save Project & Calculate Resources"}
          </Button>
        </div>
      </form>

      <Modal
        open={customSizeModalOpen}
        onClose={() => setCustomSizeModalOpen(false)}
        title={`Add Custom ${customSizeData.joint_type} Size`}
      >
        <div className="flex w-full flex-col gap-4 text-left">
          <div>
            <Label>Size (NB)</Label>
            <Input
              type="number"
              placeholder="e.g. 5000"
              value={customSizeData.size}
              onChange={(e) => setCustomSizeData({ ...customSizeData, size: e.target.value })}
            />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label>TIG (Feet)</Label>
              <Input
                type="number"
                step="0.1"
                value={customSizeData.tig_feet}
                onChange={(e) => setCustomSizeData({ ...customSizeData, tig_feet: e.target.value })}
              />
            </div>
            <div>
              <Label>MIG (Feet)</Label>
              <Input
                type="number"
                step="0.1"
                value={customSizeData.mig_feet}
                onChange={(e) => setCustomSizeData({ ...customSizeData, mig_feet: e.target.value })}
              />
            </div>
          </div>
          <div>
            <Label>Grinding (Sq. Feet)</Label>
            <Input
              type="number"
              step="0.1"
              value={customSizeData.grinding_feet}
              onChange={(e) => setCustomSizeData({ ...customSizeData, grinding_feet: e.target.value })}
            />
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="secondary" onClick={() => setCustomSizeModalOpen(false)}>
              Cancel
            </Button>
            <Button type="button" variant="primary" disabled={savingCustomSize || !customSizeData.size} onClick={saveCustomSize}>
              {savingCustomSize ? "Saving…" : "Save Custom Size"}
            </Button>
          </div>
        </div>
      </Modal>

      {toasts}
    </div>
  );
}
