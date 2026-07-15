"use client";
import React, { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { apiFetch } from "@/lib/api";
import {
  Button, Card, CardHeader, CardBody,
  Input, Label, Textarea,
  Table, THead, TBody, Tr, Th, Td,
  Badge, Spinner, Alert,
  useConfirm, useToast,
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

// Linear status progression
const NEXT_STATUS: Record<string, string> = {
  draft: "raised",
  raised: "sent",
  sent: "partially_received",
  partially_received: "received",
};

interface Allocation {
  id: number;
  part_id: number;
  allocated_qty: number;
  already_received: number;
}

interface POLine {
  id: number;
  material_name: string;
  size: number;
  joint_type: string;
  ordered_qty: number;
  unit_price: number | null;
  received_qty: number;
  status: string;
  allocations: Allocation[];
}

interface PO {
  id: number;
  po_number: string;
  vendor_id: number | null;
  po_date: string | null;
  expected_delivery_date: string | null;
  status: string;
  total_value: number | null;
  delay_reason: string | null;
  notes: string | null;
  lines: POLine[];
}

export default function PODetailPage() {
  const { id } = useParams<{ id: string }>();
  const { confirm, dialog } = useConfirm();
  const { showToast, toasts } = useToast();
  const [po, setPo] = useState<PO | null>(null);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState("");
  const [expandedLines, setExpandedLines] = useState<Set<number>>(new Set());
  const [vendors, setVendors] = useState<{id: number; name: string}[]>([]);

  // Receipt form state
  const [showReceipt, setShowReceipt] = useState(false);
  const [receiptDate, setReceiptDate] = useState("");
  const [receiptNotes, setReceiptNotes] = useState("");
  const [receiptQtys, setReceiptQtys] = useState<Record<number, string>>({});
  const [saving, setSaving] = useState(false);

  // ponytail: localStorage role check — matches vendors page pattern
  const isManagement = typeof window !== "undefined" && localStorage.getItem("user_role") === "MANAGEMENT";

  const load = async () => {
    setLoading(true);
    setFetchError("");
    try {
      const res = await apiFetch(`${API}/api/v1/procurement/po/${id}`);
      if (res.ok) {
        setPo(await res.json());
      } else {
        const b = await res.json().catch(() => ({})) as { detail?: string };
        setFetchError(b.detail || "PO not found.");
      }

      // Fetch vendors for name resolution
      const vendorRes = await apiFetch(`${API}/api/v1/procurement/vendors`);
      if (vendorRes.ok) {
        setVendors(await vendorRes.json());
      }
    } catch (e) {
      setFetchError(e instanceof Error ? e.message : "Network error.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, [id]);

  const toggleLine = (lineId: number) =>
    setExpandedLines(s => {
      const next = new Set(s);
      next.has(lineId) ? next.delete(lineId) : next.add(lineId);
      return next;
    });

  const advanceStatus = async (newStatus: string) => {
    const isDanger = newStatus === "cancelled";
    const ok = await confirm({
      title: `Mark PO as "${newStatus.replace(/_/g, " ")}"?`,
      description: isDanger ? "This will release all reserved stock." : undefined,
      confirmLabel: isDanger ? "Cancel PO" : "Confirm",
      tone: isDanger ? "danger" : "primary",
    });
    if (!ok) return;

    try {
      const res = await apiFetch(`${API}/api/v1/procurement/po/${id}/status`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: newStatus }),
      });
      if (res.ok) {
        showToast(`PO marked as ${newStatus.replace(/_/g, " ")}.`);
        load();
      } else {
        const b = await res.json().catch(() => ({})) as { detail?: string };
        showToast(b.detail || "Status update failed.", "critical");
      }
    } catch (e) {
      showToast(e instanceof Error ? e.message : "Network error.", "critical");
    }
  };

  const openReceipt = () => {
    setReceiptDate("");
    setReceiptNotes("");
    setReceiptQtys({});
    setShowReceipt(true);
  };

  const logReceipt = async (e: React.FormEvent) => {
    e.preventDefault();
    const lines = Object.entries(receiptQtys)
      .map(([po_line_id, qty]) => ({ po_line_id: +po_line_id, qty_received: +qty }))
      .filter(l => l.qty_received > 0);

    if (lines.length === 0) {
      showToast("Enter at least one received quantity.", "critical");
      return;
    }

    setSaving(true);
    try {
      const res = await apiFetch(`${API}/api/v1/procurement/po/${id}/receipt`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          receipt_date: receiptDate || null,
          notes: receiptNotes || null,
          lines,
        }),
      });
      if (res.ok) {
        showToast("Goods receipt logged.");
        setShowReceipt(false);
        load();
      } else {
        const b = await res.json().catch(() => ({})) as { detail?: string };
        showToast(b.detail || "Failed to log receipt.", "critical");
      }
    } catch (e) {
      showToast(e instanceof Error ? e.message : "Network error.", "critical");
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <div className="flex items-center justify-center p-16"><Spinner label="Loading PO…" /></div>;
  if (fetchError) return <div className="p-8"><Alert tone="critical" title="Error">{fetchError}</Alert></div>;
  if (!po) return null;

  const isTerminal = po.status === "received" || po.status === "cancelled";
  const nextStatus = NEXT_STATUS[po.status];
  const vendorName = vendors.find(v => v.id === po.vendor_id)?.name ?? (po.vendor_id ? `Vendor #${po.vendor_id}` : null);

  return (
    <div className="flex flex-col gap-6">
      {dialog}
      {toasts}

      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="font-display font-mono text-3xl font-extrabold uppercase tracking-wide text-ink">
            {po.po_number}
          </h1>
          <div className="mt-1 flex items-center gap-2">
            <Badge tone={STATUS_TONE[po.status] ?? "neutral"}>
              {po.status.replace(/_/g, " ")}
            </Badge>
            {vendorName && (
              <span className="text-sm text-ink-soft">{vendorName}</span>
            )}
          </div>
        </div>

        {isManagement && (
          <div className="flex flex-wrap items-center gap-2">
            {!isTerminal && nextStatus && (
              <Button onClick={() => advanceStatus(nextStatus)}>
                Mark as {nextStatus.replace(/_/g, " ")}
              </Button>
            )}
            {!isTerminal && (
              <Button variant="danger" onClick={() => advanceStatus("cancelled")}>
                Cancel PO
              </Button>
            )}
            {!isTerminal && (
              <Button variant="secondary" onClick={showReceipt ? () => setShowReceipt(false) : openReceipt}>
                {showReceipt ? "Close Receipt" : "Log Receipt"}
              </Button>
            )}
          </div>
        )}
      </div>

      {/* Info cards */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardBody className="p-4">
            <div className="text-xs font-semibold uppercase tracking-wide text-ink-soft">PO Date</div>
            <div className="mt-1 font-data font-bold text-ink">{po.po_date ?? "—"}</div>
          </CardBody>
        </Card>
        <Card>
          <CardBody className="p-4">
            <div className="text-xs font-semibold uppercase tracking-wide text-ink-soft">Expected Delivery</div>
            <div className="mt-1 font-data font-bold text-ink">{po.expected_delivery_date ?? "—"}</div>
          </CardBody>
        </Card>
        <Card>
          <CardBody className="p-4">
            <div className="text-xs font-semibold uppercase tracking-wide text-ink-soft">Total Value</div>
            <div className="mt-1 font-data text-lg font-extrabold text-ink">
              {po.total_value != null ? `₹${po.total_value.toLocaleString("en-IN")}` : "—"}
            </div>
          </CardBody>
        </Card>
        <Card>
          <CardBody className="p-4">
            <div className="text-xs font-semibold uppercase tracking-wide text-ink-soft">Lines</div>
            <div className="mt-1 font-data text-lg font-extrabold text-ink">{po.lines.length}</div>
          </CardBody>
        </Card>
      </div>

      {po.delay_reason && (
        <Alert tone="warning" title="Delay Reason">{po.delay_reason}</Alert>
      )}

      {/* Receipt form */}
      {showReceipt && (
        <Card>
          <CardHeader title="Log Goods Receipt" />
          <form onSubmit={logReceipt}>
            <CardBody className="flex flex-col gap-4 p-5">
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div>
                  <Label>Receipt Date</Label>
                  <Input type="date" value={receiptDate} onChange={e => setReceiptDate(e.target.value)} />
                </div>
                <div>
                  <Label>Notes</Label>
                  <Textarea
                    value={receiptNotes}
                    onChange={e => setReceiptNotes(e.target.value)}
                    placeholder="Delivery notes…"
                  />
                </div>
              </div>

              <div className="flex flex-col gap-3">
                <span className="text-sm font-semibold text-ink">Quantities Received</span>
                {po.lines.map(line => (
                  <div key={line.id} className="flex flex-wrap items-center gap-4 rounded-md border border-paper-raised bg-paper p-3">
                    <div className="flex-1">
                      <span className="font-semibold text-ink">{line.material_name}</span>
                      <span className="ml-2 text-sm text-ink-soft">{line.size} NB — {line.joint_type}</span>
                    </div>
                    <span className="text-sm text-ink-soft">
                      Ordered: <span className="font-data font-bold text-ink">{line.ordered_qty}</span>
                      {" "}| Received: <span className="font-data font-bold text-ink">{line.received_qty}</span>
                    </span>
                    <div className="w-36">
                      <Input
                        type="number"
                        min={0}
                        max={line.ordered_qty - line.received_qty}
                        placeholder="Qty"
                        value={receiptQtys[line.id] ?? ""}
                        onChange={e => setReceiptQtys({ ...receiptQtys, [line.id]: e.target.value })}
                      />
                    </div>
                  </div>
                ))}
              </div>

              <div className="flex justify-end gap-2">
                <Button type="button" variant="ghost" onClick={() => setShowReceipt(false)}>Cancel</Button>
                <Button type="submit" disabled={saving}>{saving ? "Saving…" : "Save Receipt"}</Button>
              </div>
            </CardBody>
          </form>
        </Card>
      )}

      {/* Line items */}
      <Card>
        <CardHeader title="Line Items" />
        <Table>
          <THead>
            <Tr>
              <Th>Material</Th>
              <Th>Size</Th>
              <Th>Joint</Th>
              <Th numeric>Ordered</Th>
              <Th numeric>Received</Th>
              <Th numeric>Unit Price</Th>
              <Th>Status</Th>
              <Th numeric>Allocations</Th>
            </Tr>
          </THead>
          <TBody>
            {po.lines.map(line => (
              <React.Fragment key={line.id}>
                <Tr>
                  <Td className="font-semibold text-ink">{line.material_name}</Td>
                  <Td className="font-data">{line.size} NB</Td>
                  <Td>{line.joint_type}</Td>
                  <Td numeric><span className="font-data font-bold text-ink">{line.ordered_qty}</span></Td>
                  <Td numeric><span className="font-data font-bold text-ink">{line.received_qty}</span></Td>
                  <Td numeric>
                    <span className="font-data text-ink-soft">
                      {line.unit_price != null ? `₹${line.unit_price}` : "—"}
                    </span>
                  </Td>
                  <Td>
                    <Badge tone={STATUS_TONE[line.status] ?? "neutral"}>
                      {line.status.replace(/_/g, " ")}
                    </Badge>
                  </Td>
                  <Td numeric>
                    {line.allocations.length > 0 && (
                      <Button variant="ghost" onClick={() => toggleLine(line.id)}>
                        {expandedLines.has(line.id) ? "Hide" : `${line.allocations.length} parts`}
                      </Button>
                    )}
                  </Td>
                </Tr>
                {expandedLines.has(line.id) && line.allocations.map(alloc => (
                  <Tr key={`alloc-${alloc.id}`} className="bg-paper">
                    <Td colSpan={3} className="pl-8 text-sm text-ink-soft">
                      Part ID: <span className="font-data font-bold text-ink">{alloc.part_id}</span>
                    </Td>
                    <Td numeric>
                      <span className="font-data text-sm text-ink-soft">{alloc.allocated_qty} allocated</span>
                    </Td>
                    <Td numeric>
                      <span className="font-data text-sm text-ink-soft">{alloc.already_received} received</span>
                    </Td>
                    <Td colSpan={3} />
                  </Tr>
                ))}
              </React.Fragment>
            ))}
            {po.lines.length === 0 && (
              <Tr>
                <Td colSpan={8} className="py-10 text-center text-ink-soft">No line items on this PO.</Td>
              </Tr>
            )}
          </TBody>
        </Table>
      </Card>

      {po.notes && (
        <Card>
          <CardBody className="p-4">
            <div className="text-xs font-semibold uppercase tracking-wide text-ink-soft">Notes</div>
            <p className="mt-1 text-sm text-ink-soft">{po.notes}</p>
          </CardBody>
        </Card>
      )}
    </div>
  );
}
