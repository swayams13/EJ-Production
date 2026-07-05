"use client";
import { apiFetch } from "@/lib/api";

import { useState, useEffect } from "react";
import { Card, CardHeader, CardBody, Button, Input, Select, Label, Alert, EmptyState, useConfirm, useToast } from "@/components/ui";

export default function OperatorsPage() {
  const { confirm, dialog } = useConfirm();
  const { showToast, toasts } = useToast();
  const [operators, setOperators] = useState<any[]>([]);

  // New Operator Form
  const [fullName, setFullName] = useState("");
  const [department, setDepartment] = useState("Welding");
  const [skill, setSkill] = useState("TIG Welder");
  const [experience, setExperience] = useState("");
  const [baseProductivity, setBaseProductivity] = useState("");

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [editingId, setEditingId] = useState<number | null>(null);

  const fetchOperators = () => {
    apiFetch(`${process.env.NEXT_PUBLIC_API_URL || "http://localhost:8003"}/api/v1/users`)
      .then((res) => res.json())
      .then((resData) => setOperators(resData.data.filter((u: any) => u.role === "Operator")))
      .catch((err) => console.error("Failed to fetch operators:", err));
  };

  useEffect(() => {
    fetchOperators();
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setError("");
    setSuccess("");

    try {
      const url = editingId
        ? `${process.env.NEXT_PUBLIC_API_URL || "http://localhost:8003"}/api/v1/users/${editingId}`
        : `${process.env.NEXT_PUBLIC_API_URL || "http://localhost:8003"}/api/v1/users`;

      const res = await apiFetch(url, {
        method: editingId ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          full_name: fullName,
          role: "Operator",
          department,
          skill,
          experience,
          base_productivity: baseProductivity ? parseFloat(baseProductivity) : null,
        }),
      });

      if (!res.ok) {
        const errData = await res.json();
        let errMsg = errData.detail;
        if (Array.isArray(errMsg)) {
          errMsg = errMsg.map((e: any) => `${e.loc.join(".")}: ${e.msg}`).join(" | ");
        }
        throw new Error(errMsg || "Failed to save operator");
      }

      setSuccess(editingId ? "Operator updated successfully!" : "Operator profile created successfully!");
      setFullName("");
      setExperience("");
      setBaseProductivity("");
      setEditingId(null);

      fetchOperators();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  };

  const handleEdit = (op: any) => {
    setEditingId(op.id);
    setFullName(op.name || "");
    setDepartment(op.department || "Welding");
    setSkill(op.skill || "TIG Welder");
    setExperience(op.experience || "");
    setBaseProductivity(op.base_productivity ? op.base_productivity.toString() : "");
  };

  const handleDelete = async (id: number) => {
    const ok = await confirm({
      title: "Delete this operator?",
      description: "This permanently removes their profile and cannot be undone.",
      confirmLabel: "Delete",
      tone: "danger",
    });
    if (!ok) return;
    try {
      const res = await apiFetch(`${process.env.NEXT_PUBLIC_API_URL || "http://localhost:8003"}/api/v1/users/${id}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        const errData = await res.json();
        showToast(`Failed to delete: ${errData.detail || "Unknown error"}`, "critical");
      } else {
        showToast("Operator deleted.", "success");
        fetchOperators();
      }
    } catch (err) {
      console.error(err);
      showToast("Failed to delete operator. Check your connection.", "critical");
    }
  };

  return (
    <div>
      <div>
        <h1 className="font-display text-3xl font-extrabold uppercase tracking-wide text-ink">Operator Profiles</h1>
        <p className="text-ink-soft">Manage shop floor operators who will log production.</p>
      </div>

      <div className="mt-6 grid grid-cols-1 gap-8 lg:grid-cols-3">
        <Card className="lg:col-span-1">
          <CardHeader
            title={editingId ? "Edit Operator" : "Add Operator"}
            action={
              editingId && (
                <Button
                  variant="ghost"
                  onClick={() => {
                    setEditingId(null);
                    setFullName("");
                    setBaseProductivity("");
                    setExperience("");
                  }}
                >
                  Cancel Edit
                </Button>
              )
            }
          />
          <CardBody className="p-5">
            {error && (
              <Alert tone="critical" title="Error">
                {error}
              </Alert>
            )}
            {success && (
              <Alert tone="success" title="Success">
                {success}
              </Alert>
            )}

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
                  <Input
                    type="number"
                    step="0.1"
                    value={baseProductivity}
                    onChange={(e) => setBaseProductivity(e.target.value)}
                    placeholder="e.g. 150 ft"
                  />
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
                    <p className="text-[13px] text-ink-soft">
                      @{op.username} • {op.department || "No Dept"} • {op.skill || "No Skill"}
                    </p>
                  </div>
                </div>
                <div className="flex flex-col items-end gap-2 text-right">
                  <div className="flex gap-2">
                    <Button variant="secondary" onClick={() => handleEdit(op)}>
                      Edit
                    </Button>
                    <Button variant="danger" onClick={() => handleDelete(op.id)}>
                      Delete
                    </Button>
                  </div>
                  {op.base_productivity && (
                    <span className="font-data text-xs font-semibold text-success">Target: {op.base_productivity}/day</span>
                  )}
                </div>
              </div>
            ))}

            {operators.length === 0 && (
              <div className="p-8">
                <EmptyState title="No operators found" description="Create one to get started." />
              </div>
            )}
          </div>
        </Card>
      </div>

      {dialog}
      {toasts}
    </div>
  );
}
