"use client";
import { useState, useEffect } from "react";
import { apiFetch } from "@/lib/api";
import {
  Card,
  CardHeader,
  CardBody,
  Button,
  Input,
  Select,
  Label,
  Badge,
  Alert,
  Spinner,
  Table,
  THead,
  TBody,
  Tr,
  Th,
  Td,
  useConfirm,
} from "@/components/ui";

export default function InventoryPage() {
  const { confirm, dialog } = useConfirm();
  const [inventory, setInventory] = useState<any[]>([]);
  const [shortages, setShortages] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState("");

  const [isAdding, setIsAdding] = useState(false);
  const [newMaterial, setNewMaterial] = useState({
    material_name: "Bellows",
    size: 150,
    joint_type: "EJ",
    current_stock: 0,
    minimum_required_stock: 10,
  });

  const fetchData = async () => {
    setLoading(true);
    try {
      const invRes = await apiFetch(`${process.env.NEXT_PUBLIC_API_URL || "http://localhost:8003"}/api/v1/inventory`);
      if (invRes.ok) {
        const data = await invRes.json();
        setInventory(data);
      }

      const shortRes = await apiFetch(`${process.env.NEXT_PUBLIC_API_URL || "http://localhost:8003"}/api/v1/inventory/shortages`);
      if (shortRes.ok) {
        const data = await shortRes.json();
        setShortages(data);
      }
    } catch (err: any) {
      setErrorMsg("Failed to fetch inventory data.");
    }
    setLoading(false);
  };

  useEffect(() => {
    fetchData();
  }, []);

  const handleAddSubmit = async (e: any) => {
    e.preventDefault();
    try {
      const res = await apiFetch(`${process.env.NEXT_PUBLIC_API_URL || "http://localhost:8003"}/api/v1/inventory`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(newMaterial),
      });
      if (res.ok) {
        setIsAdding(false);
        fetchData();
      } else {
        const err = await res.json();
        setErrorMsg(err.detail || "Failed to add inventory.");
      }
    } catch (err) {
      setErrorMsg("Error saving inventory.");
    }
  };

  const handleDelete = async (id: number) => {
    const ok = await confirm({
      title: "Remove this material entry?",
      confirmLabel: "Remove",
      tone: "danger",
    });
    if (!ok) return;
    try {
      await apiFetch(`${process.env.NEXT_PUBLIC_API_URL || "http://localhost:8003"}/api/v1/inventory/${id}`, { method: "DELETE" });
      fetchData();
    } catch (err) {}
  };

  if (loading) {
    return (
      <div className="p-10">
        <Spinner label="Loading Material Intelligence Engine…" />
      </div>
    );
  }

  return (
    <div>
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-display text-3xl font-extrabold uppercase tracking-wide text-ink">Material Intelligence</h1>
          <p className="text-ink-soft">Track raw materials and prevent production blockages.</p>
        </div>
        <Button onClick={() => setIsAdding(!isAdding)}>{isAdding ? "Cancel" : "Add/Update Stock"}</Button>
      </div>

      {errorMsg && (
        <div className="mt-6">
          <Alert tone="critical" title="Error">
            {errorMsg}
          </Alert>
        </div>
      )}

      {isAdding && (
        <Card className="mt-6">
          <form onSubmit={handleAddSubmit}>
            <CardBody className="grid grid-cols-1 gap-4 p-5 md:grid-cols-6 md:items-end">
              <div>
                <Label>Material Name</Label>
                <Select
                  value={newMaterial.material_name}
                  onChange={(e) => setNewMaterial({ ...newMaterial, material_name: e.target.value })}
                >
                  <option value="Bellows">Bellows</option>
                  <option value="Collar">Collar</option>
                  <option value="Flange">Flange</option>
                </Select>
              </div>
              <div>
                <Label>Size (NB)</Label>
                <Input
                  type="number"
                  value={newMaterial.size}
                  onChange={(e) => setNewMaterial({ ...newMaterial, size: parseInt(e.target.value) })}
                />
              </div>
              <div>
                <Label>Joint Type</Label>
                <Select value={newMaterial.joint_type} onChange={(e) => setNewMaterial({ ...newMaterial, joint_type: e.target.value })}>
                  <option value="EJ">EJ</option>
                  <option value="DJ">DJ</option>
                </Select>
              </div>
              <div>
                <Label>Current Stock</Label>
                <Input
                  type="number"
                  value={newMaterial.current_stock}
                  onChange={(e) => setNewMaterial({ ...newMaterial, current_stock: parseInt(e.target.value) })}
                />
              </div>
              <div>
                <Label>Minimum Req</Label>
                <Input
                  type="number"
                  value={newMaterial.minimum_required_stock}
                  onChange={(e) => setNewMaterial({ ...newMaterial, minimum_required_stock: parseInt(e.target.value) })}
                />
              </div>
              <Button type="submit" className="justify-center">
                Save
              </Button>
            </CardBody>
          </form>
        </Card>
      )}

      {shortages.length > 0 && (
        <Card className="mt-6 border-critical/30">
          <CardHeader title="⚠ Production Blocked: Material Shortages Detected" />
          <CardBody className="gap-3 p-5">
            {shortages.map((s: any, idx: number) => (
              <div key={idx} className="flex items-center justify-between rounded-md border border-line bg-paper-raised p-4">
                <div>
                  <div className="font-bold text-ink">{s.project_code}</div>
                  <div className="text-[13px] text-ink-soft">
                    Requires <span className="font-bold text-ink">{s.required_qty}x</span> {s.material_name} {s.size} NB ({s.joint_type})
                  </div>
                </div>
                <div className="text-right">
                  <div className="font-data text-lg font-extrabold text-critical">DEFICIT: {s.deficit}</div>
                  <div className="text-xs text-ink-soft">Current Stock: {s.current_stock}</div>
                </div>
              </div>
            ))}
          </CardBody>
        </Card>
      )}

      <Card className="mt-6">
        <CardHeader title="Master Raw Material Inventory" />
        <Table>
          <THead>
            <Tr>
              <Th>Material</Th>
              <Th>Size &amp; Type</Th>
              <Th numeric>Current Stock</Th>
              <Th>Status</Th>
              <Th numeric>Actions</Th>
            </Tr>
          </THead>
          <TBody>
            {inventory.map((inv: any) => {
              const isLow = inv.current_stock < inv.minimum_required_stock;
              return (
                <Tr key={inv.id}>
                  <Td className="font-bold text-ink">{inv.material_name}</Td>
                  <Td className="text-ink-soft">
                    {inv.size} NB - {inv.joint_type}
                  </Td>
                  <Td numeric>
                    <span className="font-data text-base font-extrabold text-ink">{inv.current_stock}</span>
                    <span className="ml-2 text-xs text-ink-soft">/ Min {inv.minimum_required_stock}</span>
                  </Td>
                  <Td>
                    <Badge tone={isLow ? "warning" : "success"}>{isLow ? "Low Stock" : "Healthy"}</Badge>
                  </Td>
                  <Td numeric>
                    <Button variant="danger" onClick={() => handleDelete(inv.id)}>
                      Delete
                    </Button>
                  </Td>
                </Tr>
              );
            })}
            {inventory.length === 0 && (
              <Tr>
                <Td colSpan={5} className="text-center text-ink-soft">
                  No inventory tracked yet.
                </Td>
              </Tr>
            )}
          </TBody>
        </Table>
      </Card>

      {dialog}
    </div>
  );
}
