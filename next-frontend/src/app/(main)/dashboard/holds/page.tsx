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

export default function HoldsDashboard() {
  const [holds, setHolds] = useState<HoldRow[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchHolds = () => {
    setLoading(true);
    apiFetch(`${process.env.NEXT_PUBLIC_API_URL || "http://localhost:8003"}/api/v1/projects/holds`)
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

  useEffect(() => {
    fetchHolds();
  }, []);

  const resumeProject = async (projectId: number) => {
    try {
      const res = await apiFetch(`${process.env.NEXT_PUBLIC_API_URL || "http://localhost:8003"}/api/v1/projects/${projectId}`, {
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
    </div>
  );
}
