"use client";
import { apiFetch } from "@/lib/api";
import { useState, useEffect } from "react";
import { Card, CardHeader, CardBody, Button, Input, Select, Label, Alert, EmptyState, useConfirm, useToast } from "@/components/ui";

const API = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8003";

export default function OperatorsPage() {
  const { confirm, dialog } = useConfirm();
  const { showToast, toasts } = useToast();
  const [activeTab, setActiveTab] = useState<"operators" | "supervisors">("operators");

  // ── Operators ──────────────────────────────────────────────
  const [operators, setOperators] = useState<any[]>([]);
  const [fullName, setFullName] = useState("");
  const [department, setDepartment] = useState("Welding");
  const [skill, setSkill] = useState("TIG Welder");
  const [experience, setExperience] = useState("");
  const [baseProductivity, setBaseProductivity] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [editingId, setEditingId] = useState<number | null>(null);

  // ── Supervisors ────────────────────────────────────────────
  const [supervisors, setSupervisors] = useState<any[]>([]);
  const [supName, setSupName] = useState("");
  const [supUsername, setSupUsername] = useState("");
  const [supPassword, setSupPassword] = useState("");
  const [supConfirm, setSupConfirm] = useState("");
  const [supSubmitting, setSupSubmitting] = useState(false);
  const [supError, setSupError] = useState("");
  const [supSuccess, setSupSuccess] = useState("");
  const [resetId, setResetId] = useState<number | null>(null);
  const [resetPw, setResetPw] = useState("");

  const fetchAll = () => {
    apiFetch(`${API}/api/v1/users`)
      .then((res) => res.json())
      .then((resData) => {
        setOperators(resData.data.filter((u: any) => u.role === "Operator"));
        setSupervisors(resData.data.filter((u: any) => u.role === "Supervisor"));
      })
      .catch((err) => console.error("Failed to fetch users:", err));
  };

  useEffect(() => { fetchAll(); }, []);

  // ── Operator handlers ──────────────────────────────────────
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setError(""); setSuccess("");
    try {
      const url = editingId ? `${API}/api/v1/users/${editingId}` : `${API}/api/v1/users`;
      const res = await apiFetch(url, {
        method: editingId ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ full_name: fullName, role: "Operator", department, skill, experience, base_productivity: baseProductivity ? parseFloat(baseProductivity) : null }),
      });
      if (!res.ok) {
        const d = await res.json();
        let msg = d.detail;
        if (Array.isArray(msg)) msg = msg.map((e: any) => `${e.loc.join(".")}: ${e.msg}`).join(" | ");
        throw new Error(msg || "Failed to save");
      }
      setSuccess(editingId ? "Operator updated!" : "Operator created!");
      setFullName(""); setExperience(""); setBaseProductivity(""); setEditingId(null);
      fetchAll();
    } catch (err: any) { setError(err.message); }
    finally { setSubmitting(false); }
  };

  const handleEdit = (op: any) => {
    setEditingId(op.id);
    setFullName(op.name || ""); setDepartment(op.department || "Welding");
    setSkill(op.skill || "TIG Welder"); setExperience(op.experience || "");
    setBaseProductivity(op.base_productivity ? op.base_productivity.toString() : "");
  };

  const handleDelete = async (id: number, label: string) => {
    const ok = await confirm({ title: `Delete ${label}?`, description: "This permanently removes their profile.", confirmLabel: "Delete", tone: "danger" });
    if (!ok) return;
    try {
      const res = await apiFetch(`${API}/api/v1/users/${id}`, { method: "DELETE" });
      if (!res.ok) { const d = await res.json(); showToast(`Failed: ${d.detail || "Unknown error"}`, "critical"); }
      else { showToast("Deleted.", "success"); fetchAll(); }
    } catch { showToast("Failed to delete. Check connection.", "critical"); }
  };

  // ── Supervisor handlers ────────────────────────────────────
  const handleSupSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (supPassword !== supConfirm) { setSupError("Passwords do not match."); return; }
    if (supPassword.length < 6) { setSupError("Password must be at least 6 characters."); return; }
    setSupSubmitting(true); setSupError(""); setSupSuccess("");
    try {
      const res = await apiFetch(`${API}/api/v1/users`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ full_name: supName, username: supUsername, password: supPassword, role: "Supervisor" }),
      });
      if (!res.ok) {
        const d = await res.json();
        throw new Error(d.detail || "Failed to create supervisor");
      }
      setSupSuccess(`Supervisor "${supName}" created. Login ID: ${supUsername}`);
      setSupName(""); setSupUsername(""); setSupPassword(""); setSupConfirm("");
      fetchAll();
    } catch (err: any) { setSupError(err.message); }
    finally { setSupSubmitting(false); }
  };

  const handleResetPassword = async (id: number) => {
    if (!resetPw || resetPw.length < 6) { showToast("Password must be at least 6 characters.", "critical"); return; }
    try {
      const res = await apiFetch(`${API}/api/v1/users/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password: resetPw }),
      });
      if (!res.ok) throw new Error("Failed to reset password");
      showToast("Password updated.", "success");
      setResetId(null); setResetPw("");
    } catch { showToast("Failed to reset password.", "critical"); }
  };

  return (
    <div>
      <div>
        <h1 className="font-display text-3xl font-extrabold uppercase tracking-wide text-ink">User Management</h1>
        <p className="text-ink-soft">Manage supervisors (login accounts) and shop floor operators.</p>
      </div>

      {/* Tab switcher */}
      <div className="mt-6 flex gap-1 border-b border-line">
        {(["supervisors", "operators"] as const).map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`px-4 py-2 text-sm font-semibold capitalize transition-colors border-b-2 -mb-px ${
              activeTab === tab ? "border-brand text-brand" : "border-transparent text-ink-soft hover:text-ink"
            }`}
          >
            {tab}
          </button>
        ))}
      </div>

      {/* ── Supervisors tab ── */}
      {activeTab === "supervisors" && (
        <div className="mt-6 grid grid-cols-1 gap-8 lg:grid-cols-3">
          <Card className="lg:col-span-1">
            <CardHeader title="Add Supervisor" />
            <CardBody className="p-5">
              {supError && <Alert tone="critical" title="Error">{supError}</Alert>}
              {supSuccess && <Alert tone="success" title="Created">{supSuccess}</Alert>}
              <form onSubmit={handleSupSubmit} className="flex flex-col gap-4">
                <div>
                  <Label>Full Name *</Label>
                  <Input required value={supName} onChange={(e) => setSupName(e.target.value)} placeholder="e.g. Ramesh Kumar" />
                </div>
                <div>
                  <Label>Login ID (username) *</Label>
                  <Input required value={supUsername} onChange={(e) => setSupUsername(e.target.value.trim())} placeholder="e.g. ramesh.sup" />
                </div>
                <div>
                  <Label>Password *</Label>
                  <Input type="password" required value={supPassword} onChange={(e) => setSupPassword(e.target.value)} placeholder="Min. 6 characters" />
                </div>
                <div>
                  <Label>Confirm Password *</Label>
                  <Input type="password" required value={supConfirm} onChange={(e) => setSupConfirm(e.target.value)} placeholder="Repeat password" />
                </div>
                <Button type="submit" disabled={supSubmitting} className="w-full justify-center">
                  {supSubmitting ? "Creating…" : "Create Supervisor"}
                </Button>
              </form>
            </CardBody>
          </Card>

          <Card className="lg:col-span-2">
            <CardHeader title="Supervisor Accounts" action={<span className="text-[13px] font-semibold text-ink-soft">{supervisors.length} Total</span>} />
            <div className="divide-y divide-line">
              {supervisors.map((sup) => (
                <div key={sup.id} className="p-5">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-4">
                      <div className="flex h-11 w-11 items-center justify-center rounded-full bg-brand-tint text-lg font-black text-brand-deep">
                        {sup.name.charAt(0).toUpperCase()}
                      </div>
                      <div>
                        <h3 className="font-bold text-ink">{sup.name}</h3>
                        <p className="font-data text-[13px] text-ink-soft">Login ID: {sup.username}</p>
                      </div>
                    </div>
                    <div className="flex gap-2">
                      <Button variant="secondary" onClick={() => { setResetId(resetId === sup.id ? null : sup.id); setResetPw(""); }}>
                        {resetId === sup.id ? "Cancel" : "Reset Password"}
                      </Button>
                      <Button variant="danger" onClick={() => handleDelete(sup.id, sup.name)}>Delete</Button>
                    </div>
                  </div>
                  {resetId === sup.id && (
                    <div className="mt-3 flex gap-2">
                      <Input type="password" value={resetPw} onChange={(e) => setResetPw(e.target.value)} placeholder="New password (min 6 chars)" />
                      <Button onClick={() => handleResetPassword(sup.id)}>Save</Button>
                    </div>
                  )}
                </div>
              ))}
              {supervisors.length === 0 && (
                <div className="p-8"><EmptyState title="No supervisors yet" description="Use the form to create the first supervisor account." /></div>
              )}
            </div>
          </Card>
        </div>
      )}

      {/* ── Operators tab ── */}
      {activeTab === "operators" && (
        <div className="mt-6 grid grid-cols-1 gap-8 lg:grid-cols-3">
          <Card className="lg:col-span-1">
            <CardHeader
              title={editingId ? "Edit Operator" : "Add Operator"}
              action={editingId && (
                <Button variant="ghost" onClick={() => { setEditingId(null); setFullName(""); setBaseProductivity(""); setExperience(""); }}>
                  Cancel Edit
                </Button>
              )}
            />
            <CardBody className="p-5">
              {error && <Alert tone="critical" title="Error">{error}</Alert>}
              {success && <Alert tone="success" title="Success">{success}</Alert>}
              <form onSubmit={handleSubmit} className="flex flex-col gap-4">
                <div>
                  <Label>Full Name *</Label>
                  <Input type="text" required value={fullName} onChange={(e) => setFullName(e.target.value)} placeholder="e.g. John Doe" />
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <Label>Dept *</Label>
                    <Select value={department} onChange={(e) => setDepartment(e.target.value)}>
                      <option value="Welding">Welding</option>
                      <option value="Grinding">Grinding</option>
                      <option value="Assembly">Assembly</option>
                      <option value="Painting">Painting</option>
                    </Select>
                  </div>
                  <div>
                    <Label>Skill *</Label>
                    <Select value={skill} onChange={(e) => setSkill(e.target.value)}>
                      <option value="TIG Welder">TIG Welder</option>
                      <option value="MIG Welder">MIG Welder</option>
                      <option value="Grinder">Grinder</option>
                      <option value="Fitter">Fitter</option>
                    </Select>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <Label>Experience</Label>
                    <Input type="text" value={experience} onChange={(e) => setExperience(e.target.value)} placeholder="e.g. 5 Yrs" />
                  </div>
                  <div>
                    <Label>Target/Day</Label>
                    <Input type="number" step="0.1" value={baseProductivity} onChange={(e) => setBaseProductivity(e.target.value)} placeholder="e.g. 150 ft" />
                  </div>
                </div>
                <Button type="submit" disabled={submitting} className="w-full justify-center">
                  {submitting ? "Saving…" : editingId ? "Update Profile" : "Create Profile"}
                </Button>
              </form>
            </CardBody>
          </Card>

          <Card className="lg:col-span-2">
            <CardHeader title="Active Operators" action={<span className="text-[13px] font-semibold text-ink-soft">{operators.length} Total</span>} />
            <div className="divide-y divide-line">
              {operators.map((op) => (
                <div key={op.id} className="flex items-center justify-between p-5">
                  <div className="flex items-center gap-4">
                    <div className="flex h-11 w-11 items-center justify-center rounded-full bg-brand-tint text-lg font-black text-brand-deep">
                      {op.name.charAt(0).toUpperCase()}
                    </div>
                    <div>
                      <h3 className="font-bold text-ink">{op.name}</h3>
                      <p className="text-[13px] text-ink-soft">@{op.username} • {op.department || "No Dept"} • {op.skill || "No Skill"}</p>
                    </div>
                  </div>
                  <div className="flex flex-col items-end gap-2 text-right">
                    <div className="flex gap-2">
                      <Button variant="secondary" onClick={() => handleEdit(op)}>Edit</Button>
                      <Button variant="danger" onClick={() => handleDelete(op.id, op.name)}>Delete</Button>
                    </div>
                    {op.base_productivity && <span className="font-data text-xs font-semibold text-success">Target: {op.base_productivity}/day</span>}
                  </div>
                </div>
              ))}
              {operators.length === 0 && (
                <div className="p-8"><EmptyState title="No operators found" description="Create one to get started." /></div>
              )}
            </div>
          </Card>
        </div>
      )}

      {dialog}
      {toasts}
    </div>
  );
}
