"use client";
import { useEffect, useState } from "react";
import { apiFetch } from "@/lib/api";
import {
  Button, Card, CardHeader, CardBody,
  Input, Label, Select,
  Table, THead, TBody, Tr, Th, Td,
  Badge, Spinner, Alert,
  useToast,
} from "@/components/ui";

const API = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8003";

const MATERIALS = [
  "Element", "Collar", "Weldend", "Spool", "Flange", "Matching Flanges",
  "Liner", "Lug", "Limit rod", "Bolts, Nuts", "Gaskets", "Pipe-1", "Pipe-2",
  "Stopper Patti", "Pipe-1 flange", "Pipe-2 flange", "Stopper flange",
  "O-ring", "Studs Long", "Studs Short", "Box Packing",
];

const EMPTY_FORM = {
  material_name: "Element",
  size: 150,
  joint_type: "EJ",
  qty_on_hand: 0,
  minimum_stock: 0,
};

interface StockRow {
  id: number;
  material_name: string;
  size: number;
  joint_type: string;
  qty_on_hand: number;
  reserved_qty: number;
  minimum_stock: number;
  updated_at: string;
}

export default function StockPage() {
  const { showToast, toasts } = useToast();
  const [stock, setStock] = useState<StockRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState("");
  const [adjusting, setAdjusting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({ ...EMPTY_FORM });
  // ponytail: localStorage role check — matches vendors page pattern
  const isManagement = typeof window !== "undefined" && localStorage.getItem("user_role") === "MANAGEMENT";

  const load = async () => {
    setLoading(true);
    setFetchError("");
    try {
      const res = await apiFetch(`${API}/api/v1/procurement/stock`);
      if (res.ok) {
        setStock(await res.json());
      } else {
        const body = await res.json().catch(() => ({})) as { detail?: string };
        setFetchError(body.detail || "Failed to load stock.");
      }
    } catch (e) {
      setFetchError(e instanceof Error ? e.message : "Network error.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      const res = await apiFetch(`${API}/api/v1/procurement/stock/adjust`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      if (res.ok) {
        showToast("Stock adjusted.");
        setAdjusting(false);
        setForm({ ...EMPTY_FORM });
        load();
      } else {
        const body = await res.json().catch(() => ({})) as { detail?: string };
        showToast(body.detail || "Adjustment failed.", "critical");
      }
    } catch (e) {
      showToast(e instanceof Error ? e.message : "Network error.", "critical");
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <div className="flex items-center justify-center p-16"><Spinner label="Loading stock…" /></div>;

  return (
    <div className="flex flex-col gap-6">
      {toasts}

      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-display text-3xl font-extrabold uppercase tracking-wide text-ink">Warehouse Stock</h1>
          <p className="text-ink-soft">Buffer stock levels across all materials.</p>
        </div>
        {isManagement && (
          <Button
            variant={adjusting ? "secondary" : "primary"}
            onClick={() => { setAdjusting(!adjusting); setForm({ ...EMPTY_FORM }); }}
          >
            {adjusting ? "Cancel" : "+ Adjust Stock"}
          </Button>
        )}
      </div>

      {fetchError && <Alert tone="critical" title="Error loading stock">{fetchError}</Alert>}

      {adjusting && (
        <Card>
          <CardHeader title="Adjust Stock" />
          <form onSubmit={save}>
            <CardBody className="grid grid-cols-1 gap-4 p-5 sm:grid-cols-2 lg:grid-cols-3">
              <div>
                <Label>Material</Label>
                <Select value={form.material_name} onChange={e => setForm({ ...form, material_name: e.target.value })}>
                  {MATERIALS.map(m => <option key={m} value={m}>{m}</option>)}
                </Select>
              </div>
              <div>
                <Label>Size (NB)</Label>
                <Input
                  type="number"
                  value={form.size}
                  onChange={e => setForm({ ...form, size: +e.target.value })}
                  min={0}
                />
              </div>
              <div>
                <Label>Joint Type</Label>
                <Select value={form.joint_type} onChange={e => setForm({ ...form, joint_type: e.target.value })}>
                  <option value="EJ">EJ</option>
                  <option value="DJ">DJ</option>
                </Select>
              </div>
              <div>
                <Label>Qty On Hand</Label>
                <Input
                  type="number"
                  value={form.qty_on_hand}
                  onChange={e => setForm({ ...form, qty_on_hand: +e.target.value })}
                  min={0}
                />
              </div>
              <div>
                <Label>Minimum Stock</Label>
                <Input
                  type="number"
                  value={form.minimum_stock}
                  onChange={e => setForm({ ...form, minimum_stock: +e.target.value })}
                  min={0}
                />
              </div>
              <div className="flex items-end sm:col-span-2 lg:col-span-3 justify-end">
                <Button type="submit" disabled={saving}>
                  {saving ? "Saving…" : "Save Adjustment"}
                </Button>
              </div>
            </CardBody>
          </form>
        </Card>
      )}

      <Card>
        <CardHeader title="Current Stock Levels" />
        <Table>
          <THead>
            <Tr>
              <Th>Material</Th>
              <Th>Size &amp; Type</Th>
              <Th numeric>On Hand</Th>
              <Th numeric>Reserved</Th>
              <Th numeric>Available</Th>
              <Th numeric>Minimum</Th>
              <Th>Health</Th>
            </Tr>
          </THead>
          <TBody>
            {stock.map((s) => {
              const available = s.qty_on_hand - s.reserved_qty;
              const isLow = s.qty_on_hand < s.minimum_stock;
              return (
                <Tr key={s.id}>
                  <Td className="font-semibold text-ink">{s.material_name}</Td>
                  <Td className="text-ink-soft">{s.size} NB — {s.joint_type}</Td>
                  <Td numeric><span className="font-data font-bold text-ink">{s.qty_on_hand}</span></Td>
                  <Td numeric><span className="font-data text-ink-soft">{s.reserved_qty}</span></Td>
                  <Td numeric><span className="font-data font-bold text-ink">{available}</span></Td>
                  <Td numeric><span className="font-data text-ink-soft">{s.minimum_stock}</span></Td>
                  <Td><Badge tone={isLow ? "warning" : "success"}>{isLow ? "Low Stock" : "Healthy"}</Badge></Td>
                </Tr>
              );
            })}
            {stock.length === 0 && (
              <Tr>
                <Td colSpan={7} className="py-10 text-center text-ink-soft">
                  No stock records yet.{isManagement ? " Click + Adjust Stock to add entries." : ""}
                </Td>
              </Tr>
            )}
          </TBody>
        </Table>
      </Card>
    </div>
  );
}
