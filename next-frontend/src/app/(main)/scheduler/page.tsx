"use client";
import { useState, useEffect } from "react";
import { apiFetch } from "@/lib/api";
import { Card, CardHeader, Input, Button, Badge, Alert, Spinner, EmptyState, useConfirm, useToast, Table, THead, TBody, Tr, Th, Td } from "@/components/ui";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8003";

interface TaskAssignment {
  id: number;
  user_id: number;
  user?: { full_name?: string; base_productivity?: number };
  project_id: number;
  project?: { quotation_no?: string };
  process_type: string;
  target_feet: number;
  is_overtime: boolean;
  status: string;
  notes?: string;
}

export default function SchedulerPage() {
  const { confirm, dialog } = useConfirm();
  const { showToast, toasts } = useToast();
  const [assignments, setAssignments] = useState<TaskAssignment[]>([]);
  const [loading, setLoading] = useState(false);
  const [date, setDate] = useState(new Date().toISOString().split("T")[0]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchAssignments();
  }, [date]);

  const fetchAssignments = async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await apiFetch(`${API_URL}/api/v1/scheduler/assignments?target_date=${date}`);
      if (response.ok) {
        const data = await response.json();
        setAssignments(data);
      } else {
        setError("Failed to fetch assignments. You may not be authorized or the server returned an error.");
      }
    } catch (error) {
      console.error("Error fetching assignments:", error);
      setError("Error fetching assignments. Please check your connection.");
    }
    setLoading(false);
  };

  const handleAutoAssign = async () => {
    const ok = await confirm({
      title: "Re-run auto-assign?",
      description: "This will overwrite existing 'Pending' assignments for today.",
      confirmLabel: "Re-run",
    });
    if (!ok) return;

    setLoading(true);
    setError(null);
    try {
      const response = await apiFetch(`${API_URL}/api/v1/scheduler/auto-assign?target_date=${date}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      });
      const data = await response.json();
      if (data.success) {
        showToast("Auto-assignment complete!", "success");
        fetchAssignments();
      } else {
        showToast(data.message || "Failed to auto-assign", "critical");
      }
    } catch (error) {
      console.error("Error running auto-assign:", error);
      showToast("Error running auto-assign", "critical");
    }
    setLoading(false);
  };

  const statusTone = (status: string) => (status === "Completed" ? "success" : status === "Pending" ? "warning" : "neutral");

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="font-display text-3xl font-extrabold uppercase tracking-wide text-ink">Daily Scheduler</h1>
          <p className="text-ink-soft">Smart Task Allocation Engine</p>
        </div>
        <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="max-w-[180px]" />
      </div>

      {error && (
        <div className="mb-4">
          <Alert tone="critical" title="Error">
            {error}
          </Alert>
        </div>
      )}

      <Card>
        <CardHeader
          title={`Task Assignments for ${date}`}
          action={
            <Button variant="primary" disabled={loading} onClick={handleAutoAssign}>
              {loading ? "Processing…" : "Re-Run Auto-Assign"}
            </Button>
          }
        />
        <p className="border-b border-line px-4 py-3 text-sm text-ink-soft">
          Assignments are generated seamlessly every day based on worker attendance and Takt Time pacing.
        </p>

        {loading && assignments.length === 0 ? (
          <div className="p-6">
            <Spinner label="Loading assignments…" />
          </div>
        ) : assignments.length === 0 ? (
          <div className="p-6">
            <EmptyState title="No assignments for this date" description="Run Auto-Assign to generate today's tasks." />
          </div>
        ) : (
          <Table>
            <THead>
              <Tr>
                <Th>Worker Name</Th>
                <Th>Project (Quote No)</Th>
                <Th>Process Type</Th>
                <Th numeric>Target Feet</Th>
                <Th>Overtime</Th>
                <Th>Status</Th>
                <Th>Notes</Th>
              </Tr>
            </THead>
            <TBody>
              {assignments.map((task) => (
                <Tr key={task.id}>
                  <Td className="font-medium text-ink">{task.user?.full_name || `User #${task.user_id}`}</Td>
                  <Td className="text-ink">{task.project?.quotation_no || `Proj #${task.project_id}`}</Td>
                  <Td>
                    <Badge tone="brand">{task.process_type}</Badge>
                  </Td>
                  <Td numeric>{task.target_feet}</Td>
                  <Td>
                    {task.is_overtime ? (
                      <Badge tone="warning">
                        {task.user?.base_productivity
                          ? `${Math.round((task.target_feet / task.user.base_productivity) * 10) / 10} hrs`
                          : "Yes"}
                      </Badge>
                    ) : (
                      <Badge tone="neutral">No</Badge>
                    )}
                  </Td>
                  <Td>
                    <Badge tone={statusTone(task.status)}>{task.status}</Badge>
                  </Td>
                  <Td className="max-w-xs truncate text-sm text-ink-soft">{task.notes || "-"}</Td>
                </Tr>
              ))}
            </TBody>
          </Table>
        )}
      </Card>

      {dialog}
      {toasts}
    </div>
  );
}
