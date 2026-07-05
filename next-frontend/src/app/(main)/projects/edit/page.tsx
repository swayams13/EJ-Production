"use client";
import { apiFetch } from "@/lib/api";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Card,
  CardBody,
  Button,
  Input,
  Select,
  Textarea,
  Label,
  Alert,
  Modal,
  Spinner,
  useToast,
} from "@/components/ui";

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

interface ProjectRow {
  id: number;
  quotation_no: string;
  status?: string;
  status_note?: string;
  hold_type?: string;
  hold_until_date?: string;
  target_date?: string;
  payroll?: string;
  assigned_tig?: number;
  assigned_mig?: number;
  assigned_grinders?: number;
  bellows?: Array<{ size: number; quantity: number; type?: string; pn_rating?: string }>;
}

export default function EditProjects() {
  const router = useRouter();
  const { showToast, toasts } = useToast();
  const [projects, setProjects] = useState<ProjectRow[]>([]);
  const [loading, setLoading] = useState(true);

  const [selectedProjectId, setSelectedProjectId] = useState<string>("");
  const [status, setStatus] = useState("Active");
  const [payroll, setPayroll] = useState("Company");
  const [targetDate, setTargetDate] = useState<string>("");
  const [assignedTig, setAssignedTig] = useState<number>(0);
  const [assignedMig, setAssignedMig] = useState<number>(0);
  const [assignedGrinders, setAssignedGrinders] = useState<number>(0);

  const [statusNote, setStatusNote] = useState<string>("");
  const [holdType, setHoldType] = useState<string>("");
  const [holdUntilDate, setHoldUntilDate] = useState<string>("");

  const [bellows, setBellows] = useState<BellowRow[]>([]);
  const [masterData, setMasterData] = useState<MasterSize[]>([]);
  const [duration, setDuration] = useState<number | null>(null);

  const [customSizeModalOpen, setCustomSizeModalOpen] = useState(false);
  const [customSizeData, setCustomSizeData] = useState({ size: "", tig_feet: "", mig_feet: "", grinding_feet: "", joint_type: "EJ" });
  const [customSizeRowIndex, setCustomSizeRowIndex] = useState(-1);
  const [savingCustomSize, setSavingCustomSize] = useState(false);

  const [deleteModalOpen, setDeleteModalOpen] = useState(false);
  const [deleteConfirmText, setDeleteConfirmText] = useState("");

  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState({ type: "", text: "" });

  useEffect(() => {
    fetchProjects();
    apiFetch(`${process.env.NEXT_PUBLIC_API_URL || "http://localhost:8003"}/api/v1/master/welding`)
      .then((res) => res.json())
      .then((json) => {
        setMasterData(json.data || []);
      });
  }, []);

  const fetchProjects = () => {
    setLoading(true);
    apiFetch(`${process.env.NEXT_PUBLIC_API_URL || "http://localhost:8003"}/api/v1/projects`)
      .then((res) => res.json())
      .then((resData) => {
        setProjects(resData.data || []);
        setLoading(false);
      });
  };

  const handleProjectSelect = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const id = e.target.value;
    setSelectedProjectId(id);
    if (id) {
      const p = projects.find((proj) => proj.id.toString() === id);
      if (p) {
        setStatus(p.status || "Active");
        setStatusNote(p.status_note || "");
        setHoldType(p.hold_type || "");
        setHoldUntilDate(p.hold_until_date || "");
        setTargetDate(p.target_date ? p.target_date.split("T")[0] : "");
        setPayroll(p.payroll || "Company");
        setAssignedTig(p.assigned_tig || 0);
        setAssignedMig(p.assigned_mig || 0);
        setAssignedGrinders(p.assigned_grinders || 0);
        setBellows(
          p.bellows?.map((b) => ({ size: b.size, qty: b.quantity, type: b.type || "EJ", pn_rating: b.pn_rating || "" })) || []
        );
        fetchDuration(id, p.assigned_tig || 0, p.assigned_mig || 0, p.assigned_grinders || 0);
      }
    } else {
      setBellows([]);
      setDuration(null);
      setTargetDate("");
      setStatusNote("");
      setHoldUntilDate("");
    }
  };

  const fetchDuration = (id: string, tig: number, mig: number, grind: number) => {
    apiFetch(`${process.env.NEXT_PUBLIC_API_URL || "http://localhost:8003"}/api/v1/projects/duration`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ project_id: parseInt(id), assigned_tig: tig, assigned_mig: mig, assigned_grinders: grind }),
    })
      .then((res) => res.json())
      .then((resData) => setDuration(resData.data ? resData.data.estimated_duration_days : 0))
      .catch(() => {});
  };

  useEffect(() => {
    if (selectedProjectId) {
      fetchDuration(selectedProjectId, assignedTig, assignedMig, assignedGrinders);
    }
  }, [assignedTig, assignedMig, assignedGrinders, selectedProjectId]);

  useEffect(() => {
    const validBellows = bellows
      .filter((b) => b.size && b.qty > 0)
      .map((b) => ({ size: Number(b.size), qty: Number(b.qty), type: b.type, pn_rating: b.pn_rating }));

    let tDate = targetDate;
    if (!tDate && selectedProjectId) {
      const p = projects.find((proj) => proj.id.toString() === selectedProjectId);
      if (p && p.target_date) tDate = p.target_date;
    }

    if (validBellows.length > 0) {
      apiFetch(`${process.env.NEXT_PUBLIC_API_URL || "http://localhost:8003"}/api/v1/projects/simulate_resources`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ bellows: validBellows, target_date: tDate }),
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
  }, [bellows, selectedProjectId, projects, targetDate]);

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
    if (!selectedProjectId) return;

    setSubmitting(true);
    setMessage({ type: "", text: "" });

    try {
      const res = await apiFetch(`${process.env.NEXT_PUBLIC_API_URL || "http://localhost:8003"}/api/v1/projects/${selectedProjectId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          status,
          status_note: status === "Hold" || status === "Cancelled" ? statusNote : null,
          hold_until_date: status === "Hold" && holdUntilDate ? holdUntilDate : null,
          hold_type: status === "Hold" ? holdType : null,
          target_date: targetDate || null,
          payroll: payroll,
          assigned_tig: assignedTig,
          assigned_mig: assignedMig,
          assigned_grinders: assignedGrinders,
        }),
      });

      const validBellows = bellows
        .filter((b) => b.size && b.qty > 0)
        .map((b) => ({ size: Number(b.size), qty: Number(b.qty), type: b.type, pn_rating: b.pn_rating }));

      await apiFetch(`${process.env.NEXT_PUBLIC_API_URL || "http://localhost:8003"}/api/v1/projects/${selectedProjectId}/bellows`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(validBellows),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || "Failed to update project");

      setMessage({ type: "success", text: "Project updated successfully!" });

      if (status === "Completed") {
        setTimeout(() => {
          router.push("/projects");
        }, 1500);
      }
    } catch (err) {
      setMessage({ type: "error", text: err instanceof Error ? err.message : String(err) });
    } finally {
      setSubmitting(false);
    }
  };

  const confirmDelete = async () => {
    setDeleteModalOpen(false);
    setDeleteConfirmText("");
    setSubmitting(true);
    try {
      const res = await apiFetch(`${process.env.NEXT_PUBLIC_API_URL || "http://localhost:8003"}/api/v1/projects/${selectedProjectId}`, {
        method: "DELETE",
      });
      if (!res.ok) throw new Error("Failed to delete project");

      setMessage({ type: "success", text: "Project deleted successfully!" });
      setSelectedProjectId("");
      fetchProjects();
    } catch (err) {
      setMessage({ type: "error", text: err instanceof Error ? err.message : String(err) });
    } finally {
      setSubmitting(false);
    }
  };

  if (loading && projects.length === 0) return <Spinner label="Loading active projects…" />;

  return (
    <div className="mx-auto max-w-4xl">
      <h1 className="font-display text-3xl font-extrabold uppercase tracking-wide text-ink">Edit Projects</h1>
      <p className="mb-8 text-ink-soft">Assign workforce to projects or mark them as completed.</p>

      <form onSubmit={handleSubmit} className="flex flex-col gap-8">
        <Card>
          <CardBody className="p-5">
            <Label>Select Active Project *</Label>
            <Select value={selectedProjectId} onChange={handleProjectSelect} required>
              <option value="">-- Choose a project --</option>
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.quotation_no} {p.status === "Completed" ? "(Completed)" : ""}
                </option>
              ))}
            </Select>

            {selectedProjectId && (
              <div className="mt-6 flex flex-col gap-6">
                <div className="grid grid-cols-1 gap-6 border-t border-line pt-4 md:grid-cols-2">
                  <div>
                    <Label>Project Status</Label>
                    <Select value={status} onChange={(e) => setStatus(e.target.value)}>
                      <option value="">Select Status</option>
                      <option value="Active">Active</option>
                      <option value="Hold">Hold</option>
                      <option value="Planning">Planning</option>
                      <option value="Completed">Completed</option>
                      <option value="Cancelled">Cancelled</option>
                    </Select>
                    <p className="mt-1 text-xs text-ink-soft">Status changes affect capacity metrics on dashboards.</p>
                  </div>

                  <div>
                    <Label>Target Date</Label>
                    <Input type="date" value={targetDate} onChange={(e) => setTargetDate(e.target.value)} />
                    <p className="mt-1 text-xs text-ink-soft">Overrides the deadline in the Master Schedule.</p>
                  </div>

                  <div>
                    <Label>Payroll Option</Label>
                    <Select value={payroll} onChange={(e) => setPayroll(e.target.value)}>
                      <option value="Company">Company</option>
                      <option value="Contractor">Contractor</option>
                    </Select>
                  </div>

                  {status === "Hold" && (
                    <div>
                      <Label>Hold Type</Label>
                      <Select value={holdType} onChange={(e) => setHoldType(e.target.value)}>
                        <option value="">Select Hold Reason</option>
                        <option value="Client Hold">Client Hold</option>
                        <option value="Material Hold">Material Hold</option>
                        <option value="Engineering Hold">Engineering Hold</option>
                        <option value="Inspection Hold">Inspection Hold</option>
                        <option value="Financial Hold">Financial Hold</option>
                        <option value="Vendor Hold">Vendor Hold</option>
                        <option value="General Hold">General Hold</option>
                      </Select>
                    </div>
                  )}

                  {(status === "Hold" || status === "Cancelled") && (
                    <div>
                      <Label>Reason for {status}</Label>
                      <Textarea
                        rows={2}
                        value={statusNote}
                        onChange={(e) => setStatusNote(e.target.value)}
                        placeholder={`Explain why project is ${status.toLowerCase()}...`}
                        required
                      />
                    </div>
                  )}

                  {status === "Hold" && (
                    <div>
                      <Label>Hold Until Date (Optional)</Label>
                      <Input type="date" value={holdUntilDate} onChange={(e) => setHoldUntilDate(e.target.value)} />
                    </div>
                  )}
                </div>

                <div className="border-t border-line pt-4">
                  <h3 className="mb-4 text-lg font-medium text-ink">Resource Allocation Override</h3>
                  <div className="grid grid-cols-1 gap-6 md:grid-cols-3">
                    <div>
                      <Label>Assigned TIG Welders</Label>
                      <Input type="number" min="0" value={assignedTig} onChange={(e) => setAssignedTig(parseInt(e.target.value) || 0)} />
                    </div>
                    <div>
                      <Label>Assigned MIG Welders</Label>
                      <Input type="number" min="0" value={assignedMig} onChange={(e) => setAssignedMig(parseInt(e.target.value) || 0)} />
                    </div>
                    <div>
                      <Label>Assigned Grinders</Label>
                      <Input type="number" min="0" value={assignedGrinders} onChange={(e) => setAssignedGrinders(parseInt(e.target.value) || 0)} />
                    </div>
                  </div>
                </div>

                {duration !== null && (
                  <Alert tone="info" title="Estimated Time Required">
                    Based on these assignments, it will take <strong>{duration} working days</strong> to complete.
                  </Alert>
                )}

                <div className="border-t border-line pt-4">
                  <div className="mb-4 flex items-center justify-between">
                    <h3 className="text-lg font-medium text-ink">Edit Joints &amp; Bellows</h3>
                    <Button type="button" variant="ghost" onClick={handleAddBellow}>
                      + Add Row
                    </Button>
                  </div>

                  <div className="flex flex-col gap-4">
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
                        <Button type="button" variant="ghost" className="text-critical hover:bg-critical-tint" onClick={() => handleRemoveBellow(index)}>
                          Remove
                        </Button>
                      </div>
                    ))}
                    {bellows.length === 0 && (
                      <p className="text-sm italic text-ink-soft">No expansion joints added to this project yet.</p>
                    )}
                  </div>
                </div>
              </div>
            )}
          </CardBody>
        </Card>

        {message.text && (
          <Alert tone={message.type === "error" ? "critical" : "success"} title={message.type === "error" ? "Error" : "Success"}>
            {message.text}
          </Alert>
        )}

        <div className="flex items-center justify-between pt-2">
          {selectedProjectId ? (
            <Button type="button" variant="ghost" className="text-critical hover:bg-critical-tint" onClick={() => setDeleteModalOpen(true)}>
              Delete Project
            </Button>
          ) : (
            <div />
          )}

          <Button type="submit" variant="primary" disabled={submitting || !selectedProjectId}>
            {submitting ? "Updating…" : "Save Changes"}
          </Button>
        </div>
      </form>

      <Modal
        open={deleteModalOpen}
        onClose={() => {
          setDeleteModalOpen(false);
          setDeleteConfirmText("");
        }}
        title="Delete this project?"
        description="This permanently removes all of its data - production logs, bellows, and resource assignments. Type DELETE to confirm."
      >
        <div className="flex w-full flex-col gap-3">
          <Input
            value={deleteConfirmText}
            onChange={(e) => setDeleteConfirmText(e.target.value)}
            placeholder="Type DELETE to confirm"
          />
          <div className="flex justify-end gap-2">
            <Button
              type="button"
              variant="secondary"
              onClick={() => {
                setDeleteModalOpen(false);
                setDeleteConfirmText("");
              }}
            >
              Cancel
            </Button>
            <Button type="button" variant="danger" disabled={deleteConfirmText !== "DELETE"} onClick={confirmDelete}>
              Delete Project
            </Button>
          </div>
        </div>
      </Modal>

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
