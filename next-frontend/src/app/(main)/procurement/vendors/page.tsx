"use client";
import { useEffect, useState } from "react";
import { apiFetch } from "@/lib/api";
import {
  Button, Card, CardHeader, CardBody,
  Input, Label, Textarea,
  Table, THead, TBody, Tr, Th, Td,
  Badge, Spinner, Alert,
  useConfirm, useToast,
} from "@/components/ui";

const API = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8003";

const EMPTY_FORM = {
  name: "", contact_person: "", phone: "", email: "",
  gstin: "", payment_terms: "", notes: "",
};

interface Vendor {
  id: number;
  name: string;
  contact_person: string | null;
  phone: string | null;
  email: string | null;
  gstin: string | null;
  payment_terms: string | null;
  notes: string | null;
  avg_days_late: number;
}

export default function VendorsPage() {
  const { confirm, dialog } = useConfirm();
  const { showToast, toasts } = useToast();
  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState("");
  const [formOpen, setFormOpen] = useState(false);
  const [editId, setEditId] = useState<number | null>(null);
  const [form, setForm] = useState({ ...EMPTY_FORM });
  const [saving, setSaving] = useState(false);
  const isManagement = typeof window !== "undefined" && localStorage.getItem("user_role") === "MANAGEMENT";

  const load = async () => {
    setLoading(true);
    setFetchError("");
    try {
      const res = await apiFetch(`${API}/api/v1/procurement/vendors`);
      if (res.ok) {
        setVendors(await res.json());
      } else {
        const body = await res.json().catch(() => ({})) as { detail?: string };
        setFetchError(body.detail || "Failed to load vendors.");
      }
    } catch (e) {
      setFetchError(e instanceof Error ? e.message : "Network error.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const openAdd = () => { setEditId(null); setForm({ ...EMPTY_FORM }); setFormOpen(true); };
  const openEdit = (v: Vendor) => {
    setEditId(v.id);
    setForm({
      name: v.name,
      contact_person: v.contact_person ?? "",
      phone: v.phone ?? "",
      email: v.email ?? "",
      gstin: v.gstin ?? "",
      payment_terms: v.payment_terms ?? "",
      notes: v.notes ?? "",
    });
    setFormOpen(true);
  };
  const closeForm = () => { setFormOpen(false); setEditId(null); setForm({ ...EMPTY_FORM }); };

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      const url = editId
        ? `${API}/api/v1/procurement/vendors/${editId}`
        : `${API}/api/v1/procurement/vendors`;
      const res = await apiFetch(url, {
        method: editId ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      if (res.ok) {
        showToast(editId ? "Vendor updated." : "Vendor added.");
        closeForm();
        load();
      } else {
        const body = await res.json().catch(() => ({})) as { detail?: string };
        showToast(body.detail || "Save failed.", "critical");
      }
    } catch (e) {
      showToast(e instanceof Error ? e.message : "Network error.", "critical");
    } finally {
      setSaving(false);
    }
  };

  const remove = async (id: number, name: string) => {
    const ok = await confirm({ title: `Remove "${name}"?`, description: "This cannot be undone.", confirmLabel: "Remove", tone: "danger" });
    if (!ok) return;
    try {
      await apiFetch(`${API}/api/v1/procurement/vendors/${id}`, { method: "DELETE" });
      showToast("Vendor removed.");
      load();
    } catch (e) {
      showToast(e instanceof Error ? e.message : "Delete failed.", "critical");
    }
  };

  if (loading) return <div className="flex items-center justify-center p-16"><Spinner label="Loading vendors…" /></div>;

  return (
    <div className="flex flex-col gap-6">
      {dialog}
      {toasts}

      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-display text-3xl font-extrabold uppercase tracking-wide text-ink">Vendor Master</h1>
          <p className="text-ink-soft">Manage suppliers and track delivery performance.</p>
        </div>
        {isManagement && (
          <Button onClick={formOpen ? closeForm : openAdd} variant={formOpen ? "secondary" : "primary"}>
            {formOpen ? "Cancel" : "+ Add Vendor"}
          </Button>
        )}
      </div>

      {fetchError && <Alert tone="critical" title="Error loading vendors">{fetchError}</Alert>}

      {formOpen && (
        <Card>
          <CardHeader title={editId ? "Edit Vendor" : "New Vendor"} />
          <form onSubmit={save}>
            <CardBody className="grid grid-cols-1 gap-4 p-5 sm:grid-cols-2 lg:grid-cols-4">
              <div>
                <Label>Name *</Label>
                <Input required value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} placeholder="Vendor name" />
              </div>
              <div>
                <Label>Contact Person</Label>
                <Input value={form.contact_person} onChange={e => setForm({ ...form, contact_person: e.target.value })} placeholder="Full name" />
              </div>
              <div>
                <Label>Phone</Label>
                <Input value={form.phone} onChange={e => setForm({ ...form, phone: e.target.value })} placeholder="+91 98765 43210" />
              </div>
              <div>
                <Label>Email</Label>
                <Input type="email" value={form.email} onChange={e => setForm({ ...form, email: e.target.value })} placeholder="vendor@example.com" />
              </div>
              <div>
                <Label>GSTIN</Label>
                <Input value={form.gstin} onChange={e => setForm({ ...form, gstin: e.target.value })} placeholder="22AAAAA0000A1Z5" />
              </div>
              <div>
                <Label>Payment Terms</Label>
                <Input value={form.payment_terms} onChange={e => setForm({ ...form, payment_terms: e.target.value })} placeholder="Net 30" />
              </div>
              <div className="sm:col-span-2">
                <Label>Notes</Label>
                <Textarea value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} placeholder="Any additional notes…" />
              </div>
              <div className="flex items-end justify-end sm:col-span-2 lg:col-span-4">
                <Button type="submit" disabled={saving}>
                  {saving ? "Saving…" : editId ? "Update Vendor" : "Save Vendor"}
                </Button>
              </div>
            </CardBody>
          </form>
        </Card>
      )}

      <Card>
        <CardHeader title="All Vendors" />
        <Table>
          <THead>
            <Tr>
              <Th>Vendor</Th>
              <Th>Contact</Th>
              <Th>Phone</Th>
              <Th>GSTIN</Th>
              <Th>Payment Terms</Th>
              <Th numeric>Avg Delay</Th>
              {isManagement && <Th numeric>Actions</Th>}
            </Tr>
          </THead>
          <TBody>
            {vendors.map((v) => (
              <Tr key={v.id}>
                <Td className="font-semibold text-ink">{v.name}</Td>
                <Td>{v.contact_person || "—"}</Td>
                <Td className="font-data">{v.phone || "—"}</Td>
                <Td className="font-data text-sm">{v.gstin || "—"}</Td>
                <Td>{v.payment_terms || "—"}</Td>
                <Td numeric>
                  <Badge tone={v.avg_days_late > 3 ? "warning" : "success"}>
                    {v.avg_days_late > 0 ? `+${v.avg_days_late.toFixed(1)}d` : "On time"}
                  </Badge>
                </Td>
                {isManagement && (
                  <Td numeric>
                    <div className="flex items-center justify-end gap-2">
                      <Button variant="secondary" onClick={() => openEdit(v)}>Edit</Button>
                      <Button variant="danger" onClick={() => remove(v.id, v.name)}>Remove</Button>
                    </div>
                  </Td>
                )}
              </Tr>
            ))}
            {vendors.length === 0 && (
              <Tr>
                <Td colSpan={isManagement ? 7 : 6} className="py-10 text-center text-ink-soft">
                  {isManagement ? "No vendors yet. Click + Add Vendor to get started." : "No vendors yet."}
                </Td>
              </Tr>
            )}
          </TBody>
        </Table>
      </Card>
    </div>
  );
}
