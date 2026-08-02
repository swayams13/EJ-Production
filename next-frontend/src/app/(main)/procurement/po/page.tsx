"use client";
import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { apiFetch } from "@/lib/api";
import { isManagementRole } from "@/lib/auth";
import {
  Button, Card, CardHeader, CardBody,
  Input, Label, Select, Textarea,
  Table, THead, TBody, Tr, Th, Td,
  Badge, Spinner, Alert,
  useToast,
} from "@/components/ui";

const API = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8003";

// ponytail: static tone map — no runtime interpolation
const STATUS_TONE: Record<string, "success" | "warning" | "critical" | "neutral"> = {
  draft: "neutral",
  raised: "neutral",
  sent: "warning",
  partially_received: "warning",
  received: "success",
  cancelled: "critical",
};

const STATUS_LABELS = ["draft", "raised", "sent", "partially_received", "received", "cancelled"] as const;

const MATERIALS = [
  "Element", "Collar", "Weldend", "Spool", "Flange", "Matching Flanges",
  "Liner", "Lug", "Limit rod", "Bolts, Nuts", "Gaskets", "Pipe-1", "Pipe-2",
  "Stopper Patti", "Pipe-1 flange", "Pipe-2 flange", "Stopper flange",
  "O-ring", "Studs Long", "Studs Short", "Box Packing",
];

interface Vendor { id: number; name: string; }
interface POLine {
  material_name: string;
  size: number;
  joint_type: string;
  ordered_qty: number;
  unit_price: string;
  part_id?: number;
}
interface PO {
  id: number;
  po_number: string;
  vendor_id: number | null;
  po_date: string | null;
  expected_delivery_date: string | null;
  status: string;
  total_value: number | null;
}

const EMPTY_LINE: POLine = { material_name: "Element", size: 150, joint_type: "EJ", ordered_qty: 1, unit_price: "" };

const EMPTY_FORM = {
  po_number: "",
  vendor_id: "",
  po_date: "",
  expected_delivery_date: "",
  total_value: "",
  notes: "",
};

export default function POListPage() {
  return (
    <Suspense fallback={<div className="flex items-center justify-center p-16"><Spinner label="Loading purchase orders…" /></div>}>
      <POListPageContent />
    </Suspense>
  );
}

function POListPageContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { showToast, toasts } = useToast();
  const [pos, setPos] = useState<PO[]>([]);
  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [vendorFilter, setVendorFilter] = useState("all");
  const [formOpen, setFormOpen] = useState(false);
  const [form, setForm] = useState({ ...EMPTY_FORM });
  const [lines, setLines] = useState<POLine[]>([{ ...EMPTY_LINE }]);
  const [saving, setSaving] = useState(false);

  // ponytail: localStorage role check — matches vendors page pattern
  const isManagement = typeof window !== "undefined" && isManagementRole(localStorage.getItem("user_role"));

  const load = async () => {
    setLoading(true);
    setFetchError("");
    try {
      const [poRes, vendorRes] = await Promise.all([
        apiFetch(`${API}/api/v1/procurement/po`),
        apiFetch(`${API}/api/v1/procurement/vendors`),
      ]);
      if (poRes.ok) setPos(await poRes.json());
      else { const b = await poRes.json().catch(() => ({})) as { detail?: string }; setFetchError(b.detail || "Failed to load POs."); }
      if (vendorRes.ok) setVendors(await vendorRes.json());
    } catch (e) {
      setFetchError(e instanceof Error ? e.message : "Network error.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  useEffect(() => {
    const prefill = searchParams.get("prefill");
    if (!prefill || !isManagement) return;
    try {
      const parsed = JSON.parse(prefill) as Array<{
        part_id: number; material_name: string; size: number; joint_type: string; ordered_qty: number;
      }>;
      if (Array.isArray(parsed) && parsed.length > 0) {
        setForm({ ...EMPTY_FORM });
        setLines(parsed.map(p => ({
          material_name: p.material_name,
          size: p.size,
          joint_type: p.joint_type,
          ordered_qty: p.ordered_qty,
          unit_price: "",
          part_id: p.part_id,
        })));
        setFormOpen(true);
      }
    } catch {
      // ponytail: malformed prefill param — ignore, form stays closed
    }
  }, []);

  const vendorName = (id: number | null) => vendors.find(v => v.id === id)?.name ?? "—";

  const filtered = pos.filter(p => {
    if (statusFilter !== "all" && p.status !== statusFilter) return false;
    if (vendorFilter !== "all" && String(p.vendor_id) !== vendorFilter) return false;
    return true;
  });

  const addLine = () => setLines(ls => [...ls, { ...EMPTY_LINE }]);
  const removeLine = (i: number) => setLines(ls => ls.filter((_, idx) => idx !== i));
  const updateLine = (i: number, patch: Partial<POLine>) =>
    setLines(ls => ls.map((l, idx) => idx === i ? { ...l, ...patch } : l));

  const openForm = () => { setForm({ ...EMPTY_FORM }); setLines([{ ...EMPTY_LINE }]); setFormOpen(true); };
  const closeForm = () => { setFormOpen(false); };

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      const body = {
        po_number: form.po_number,
        vendor_id: form.vendor_id ? +form.vendor_id : null,
        po_date: form.po_date || null,
        expected_delivery_date: form.expected_delivery_date || null,
        total_value: form.total_value ? +form.total_value : null,
        notes: form.notes || null,
        lines: lines.map(l => ({
          material_name: l.material_name,
          size: +l.size,
          joint_type: l.joint_type,
          ordered_qty: +l.ordered_qty,
          unit_price: l.unit_price ? +l.unit_price : null,
          allocations: l.part_id ? [{ part_id: l.part_id, allocated_qty: +l.ordered_qty }] : [],
        })),
      };
      const res = await apiFetch(`${API}/api/v1/procurement/po`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (res.ok) {
        showToast("PO created.");
        closeForm();
        load();
      } else {
        const b = await res.json().catch(() => ({})) as { detail?: string };
        showToast(b.detail || "Failed to create PO.", "critical");
      }
    } catch (e) {
      showToast(e instanceof Error ? e.message : "Network error.", "critical");
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <div className="flex items-center justify-center p-16"><Spinner label="Loading purchase orders…" /></div>;

  return (
    <div className="flex flex-col gap-6">
      {toasts}

      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-display text-3xl font-extrabold uppercase tracking-wide text-ink">Purchase Orders</h1>
          <p className="text-ink-soft">{pos.length} total PO{pos.length !== 1 ? "s" : ""}</p>
        </div>
        {isManagement && (
          <Button variant={formOpen ? "secondary" : "primary"} onClick={formOpen ? closeForm : openForm}>
            {formOpen ? "Cancel" : "+ New PO"}
          </Button>
        )}
      </div>

      {fetchError && <Alert tone="critical" title="Error loading purchase orders">{fetchError}</Alert>}

      {formOpen && (
        <Card>
          <CardHeader title="New Purchase Order" />
          <form onSubmit={save}>
            <CardBody className="flex flex-col gap-5 p-5">
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                <div>
                  <Label>PO Number *</Label>
                  <Input
                    required
                    value={form.po_number}
                    onChange={e => setForm({ ...form, po_number: e.target.value })}
                    placeholder="PO-2024-001"
                  />
                </div>
                <div>
                  <Label>Vendor</Label>
                  <Select value={form.vendor_id} onChange={e => setForm({ ...form, vendor_id: e.target.value })}>
                    <option value="">— None —</option>
                    {vendors.map(v => <option key={v.id} value={v.id}>{v.name}</option>)}
                  </Select>
                </div>
                <div>
                  <Label>PO Date</Label>
                  <Input type="date" value={form.po_date} onChange={e => setForm({ ...form, po_date: e.target.value })} />
                </div>
                <div>
                  <Label>Expected Delivery</Label>
                  <Input type="date" value={form.expected_delivery_date} onChange={e => setForm({ ...form, expected_delivery_date: e.target.value })} />
                </div>
                <div>
                  <Label>Total Value (₹)</Label>
                  <Input
                    type="number"
                    min={0}
                    step="0.01"
                    value={form.total_value}
                    onChange={e => setForm({ ...form, total_value: e.target.value })}
                    placeholder="Optional"
                  />
                </div>
                <div className="sm:col-span-2 lg:col-span-1">
                  <Label>Notes</Label>
                  <Textarea value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} placeholder="Any notes…" />
                </div>
              </div>

              <div>
                <div className="mb-2 flex items-center justify-between">
                  <span className="text-sm font-semibold text-ink">Line Items</span>
                  <Button type="button" variant="secondary" onClick={addLine}>+ Add Line</Button>
                </div>
                <div className="flex flex-col gap-3">
                  {lines.map((line, i) => (
                    <div key={i} className="grid grid-cols-2 gap-3 rounded-md border border-paper-raised bg-paper p-3 sm:grid-cols-3 lg:grid-cols-6">
                      <div>
                        <Label>Material</Label>
                        <Select value={line.material_name} onChange={e => updateLine(i, { material_name: e.target.value })}>
                          {MATERIALS.map(m => <option key={m} value={m}>{m}</option>)}
                        </Select>
                      </div>
                      <div>
                        <Label>Size (NB)</Label>
                        <Input type="number" min={0} value={line.size} onChange={e => updateLine(i, { size: +e.target.value })} />
                      </div>
                      <div>
                        <Label>Joint</Label>
                        <Select value={line.joint_type} onChange={e => updateLine(i, { joint_type: e.target.value })}>
                          <option value="EJ">EJ</option>
                          <option value="DJ">DJ</option>
                        </Select>
                      </div>
                      <div>
                        <Label>Ordered Qty</Label>
                        <Input type="number" min={1} value={line.ordered_qty} onChange={e => updateLine(i, { ordered_qty: +e.target.value })} />
                      </div>
                      <div>
                        <Label>Unit Price (₹)</Label>
                        <Input type="number" min={0} step="0.01" value={line.unit_price} onChange={e => updateLine(i, { unit_price: e.target.value })} placeholder="Optional" />
                      </div>
                      <div className="flex items-end">
                        {lines.length > 1 && (
                          <Button type="button" variant="danger" onClick={() => removeLine(i)}>Remove</Button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              <div className="flex justify-end">
                <Button type="submit" disabled={saving}>
                  {saving ? "Saving…" : "Create PO"}
                </Button>
              </div>
            </CardBody>
          </form>
        </Card>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-2">
          <Label>Status</Label>
          <Select value={statusFilter} onChange={e => setStatusFilter(e.target.value)} className="w-48">
            <option value="all">All statuses</option>
            {STATUS_LABELS.map(s => (
              <option key={s} value={s}>{s.replace(/_/g, " ")}</option>
            ))}
          </Select>
        </div>
        <div className="flex items-center gap-2">
          <Label>Vendor</Label>
          <Select value={vendorFilter} onChange={e => setVendorFilter(e.target.value)} className="w-48">
            <option value="all">All vendors</option>
            {vendors.map(v => <option key={v.id} value={v.id}>{v.name}</option>)}
          </Select>
        </div>
      </div>

      <Card>
        <CardHeader title="All Purchase Orders" />
        <Table>
          <THead>
            <Tr>
              <Th>PO Number</Th>
              <Th>Vendor</Th>
              <Th>PO Date</Th>
              <Th>Expected Delivery</Th>
              <Th>Status</Th>
              <Th numeric>Value (₹)</Th>
              <Th numeric>Actions</Th>
            </Tr>
          </THead>
          <TBody>
            {filtered.map(po => (
              <Tr key={po.id}>
                <Td className="font-mono font-bold text-ink">{po.po_number}</Td>
                <Td>{vendorName(po.vendor_id)}</Td>
                <Td className="font-data text-sm">{po.po_date ?? "—"}</Td>
                <Td className="font-data text-sm">{po.expected_delivery_date ?? "—"}</Td>
                <Td>
                  <Badge tone={STATUS_TONE[po.status] ?? "neutral"}>
                    {po.status.replace(/_/g, " ")}
                  </Badge>
                </Td>
                <Td numeric>
                  <span className="font-data font-bold text-ink">
                    {po.total_value != null ? `₹${po.total_value.toLocaleString("en-IN")}` : "—"}
                  </span>
                </Td>
                <Td numeric>
                  <Button variant="secondary" onClick={() => router.push(`/procurement/po/${po.id}`)}>
                    View
                  </Button>
                </Td>
              </Tr>
            ))}
            {filtered.length === 0 && (
              <Tr>
                <Td colSpan={7} className="py-10 text-center text-ink-soft">
                  {pos.length === 0 ? "No purchase orders yet." : "No POs match the selected filters."}
                </Td>
              </Tr>
            )}
          </TBody>
        </Table>
      </Card>
    </div>
  );
}
