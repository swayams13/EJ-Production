"use client";

import { useEffect, useState } from "react";
import { apiFetch } from "@/lib/api";
import { Card, CardHeader, Table, THead, TBody, Tr, Th, Td, Badge, Button, Spinner, EmptyState } from "@/components/ui";

interface HoldRow {
  id: number;
  project_id: number;
  quotation_no: string;
  project_name?: string;
  hold_type: string;
  comments?: string;
  days_on_hold: number;
}

interface MaterialHoldRow {
  id: number;
  project_id: number;
  quotation_no: string;
  project_name: string;
  part_name: string;
  material_name: string;
  size: number;
  joint_type: string;
  required_qty: number;
  days_blocked: number;
  po_eta: string | null;
  po_number: string | null;
}

const API = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8003";

export default function HoldsDashboard() {
  const [holds, setHolds] = useState<HoldRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [materialHolds, setMaterialHolds] = useState<MaterialHoldRow[]>([]);
  const [materialLoading, setMaterialLoading] = useState(true);
  const [resolvingId, setResolvingId] = useState<number | null>(null);
  const [resolveNote, setResolveNote] = useState("");
  const [resolveOpenId, setResolveOpenId] = useState<number | null>(null);

  const fetchHolds = () => {
    setLoading(true);
    apiFetch(`${API}/api/v1/projects/holds`)
      .then((res) => res.json())
      .then((data) => {
        setHolds(data.data || []);
        setLoading(false);
      })
      .catch((err) => {
        console.error(err);
        setLoading(false);
      });
  };

  const fetchMaterialHolds = () => {
    setMaterialLoading(true);
    apiFetch(`${API}/api/v1/projects/material-holds`)
      .then((res) => res.json())
      .then((data) => {
        setMaterialHolds(Array.isArray(data) ? data : []);
        setMaterialLoading(false);
      })
      .catch(() => setMaterialLoading(false));
  };

  const resolveHold = async (id: number) => {
    setResolvingId(id);
    try {
      const res = await apiFetch(`${API}/api/v1/projects/material-holds/${id}/resolve`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ resolution_note: resolveNote || null }),
      });
      if (res.ok) {
        setResolveOpenId(null);
        setResolveNote("");
        fetchMaterialHolds();
      }
    } finally {
      setResolvingId(null);
    }
  };

  useEffect(() => {
    fetchHolds();
    fetchMaterialHolds();
  }, []);

  const resumeProject = async (projectId: number) => {
    try {
      const res = await apiFetch(`${API}/api/v1/projects/${projectId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "Active" }),
      });
      if (res.ok) {
        fetchHolds();
      }
    } catch (e) {
      console.error(e);
    }
  };

  return (
    <div className="flex flex-col gap-8">
      <div>
        <h1 className="font-display text-3xl font-extrabold uppercase tracking-wide text-ink">
          Hold Resolution Center
        </h1>
        <p className="text-ink-soft">Track and unblock projects that are currently on hold.</p>
      </div>

      <Card>
        <CardHeader title={`Active Holds (${holds.length})`} />
        {loading ? (
          <div className="p-6">
            <Spinner label="Loading holds…" />
          </div>
        ) : holds.length === 0 ? (
          <div className="p-6">
            <EmptyState title="No active holds!" description="All projects are progressing normally." />
          </div>
        ) : (
          <Table>
            <THead>
              <Tr>
                <Th>Project</Th>
                <Th>Reason</Th>
                <Th>Duration</Th>
                <Th>Action</Th>
              </Tr>
            </THead>
            <TBody>
              {holds.map((h) => (
                <Tr key={h.id}>
                  <Td>
                    <div className="font-bold text-ink">{h.quotation_no}</div>
                    <div className="text-xs text-ink-soft">{h.project_name}</div>
                  </Td>
                  <Td>
                    <div className="font-semibold text-ink">{h.hold_type}</div>
                    <div className="mt-1 max-w-xs truncate text-xs text-ink-soft">{h.comments || "No comments"}</div>
                  </Td>
                  <Td>
                    <Badge tone={h.days_on_hold > 7 ? "critical" : "warning"}>
                      {h.days_on_hold} {h.days_on_hold === 1 ? "Day" : "Days"}
                    </Badge>
                  </Td>
                  <Td>
                    <Button variant="primary" onClick={() => resumeProject(h.project_id)}>
                      Resume Production
                    </Button>
                  </Td>
                </Tr>
              ))}
            </TBody>
          </Table>
        )}
      </Card>

      <Card>
        <CardHeader title={`Material Shortages (${materialHolds.length})`} />
        {materialLoading ? (
          <div className="p-6"><Spinner label="Loading material holds…" /></div>
        ) : materialHolds.length === 0 ? (
          <div className="p-6">
            <EmptyState title="No material shortages!" description="All parts have sufficient warehouse stock." />
          </div>
        ) : (
          <Table>
            <THead>
              <Tr>
                <Th>Project</Th>
                <Th>Material</Th>
                <Th>Days Blocked</Th>
                <Th>PO ETA</Th>
                <Th>Action</Th>
              </Tr>
            </THead>
            <TBody>
              {materialHolds.map((h) => (
                <Tr key={h.id}>
                  <Td>
                    <div className="font-bold text-ink">{h.quotation_no}</div>
                    <div className="text-xs text-ink-soft">{h.project_name}</div>
                  </Td>
                  <Td>
                    <div className="font-semibold text-ink">{h.material_name}</div>
                    <div className="text-xs text-ink-soft">{h.size}NB · {h.joint_type}</div>
                  </Td>
                  <Td>
                    <Badge tone={h.days_blocked > 3 ? "critical" : "warning"}>
                      {h.days_blocked}d
                    </Badge>
                  </Td>
                  <Td>
                    {h.po_eta ? (
                      <div>
                        <Badge tone="warning">ETA {h.po_eta}</Badge>
                        <div className="text-xs text-ink-soft mt-0.5">{h.po_number}</div>
                      </div>
                    ) : (
                      <Badge tone="critical">No PO Raised</Badge>
                    )}
                  </Td>
                  <Td>
                    {resolveOpenId === h.id ? (
                      <div className="flex flex-col gap-1">
                        <input
                          className="rounded border border-ink-subtle px-2 py-1 text-xs text-ink"
                          placeholder="Resolution note (optional)"
                          value={resolveNote}
                          onChange={(e) => setResolveNote(e.target.value)}
                        />
                        <div className="flex gap-1">
                          <Button
                            variant="primary"
                            onClick={() => resolveHold(h.id)}
                            disabled={resolvingId === h.id}
                          >
                            {resolvingId === h.id ? "Saving…" : "Confirm"}
                          </Button>
                          <Button
                            variant="secondary"
                            onClick={() => { setResolveOpenId(null); setResolveNote(""); }}
                          >
                            Cancel
                          </Button>
                        </div>
                      </div>
                    ) : (
                      <Button variant="secondary" onClick={() => setResolveOpenId(h.id)}>
                        Mark Resolved
                      </Button>
                    )}
                  </Td>
                </Tr>
              ))}
            </TBody>
          </Table>
        )}
      </Card>
    </div>
  );
}
