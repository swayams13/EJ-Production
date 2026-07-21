"use client";
import { apiFetch } from "@/lib/api";
import Link from "next/link";
import { useState, useEffect } from "react";
import { Card, CardHeader, CardBody, Select, Label, Button, Badge, Spinner, useToast, Table, THead, TBody, Tr, Th, Td } from "@/components/ui";

interface WorkerMetric {
  user_id: number;
  name: string;
  department?: string;
  skill?: string;
  attendance_score: number;
  efficiency_score: number;
  quality_score: number;
  reliability_score: number;
}

const API = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8003";

export default function WorkforceDashboard() {
  const { showToast, toasts } = useToast();
  const [metrics, setMetrics] = useState<WorkerMetric[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedUser, setSelectedUser] = useState<number | null>(null);
  const [attendanceStatus, setAttendanceStatus] = useState("Present");
  const [submitting, setSubmitting] = useState(false);
  const [generating, setGenerating] = useState(false);

  const fetchMetrics = () => {
    setLoading(true);
    apiFetch(`${process.env.NEXT_PUBLIC_API_URL || "http://localhost:8003"}/api/v1/workforce/metrics`)
      .then((res) => res.json())
      .then((resData) => {
        setMetrics(resData.data || []);
        setLoading(false);
      })
      .catch((err) => {
        console.error(err);
        setLoading(false);
      });
  };

  useEffect(() => {
    fetchMetrics();
  }, []);

  const handleGenerateWorkOrders = () => {
    setGenerating(true);
    const today = new Date().toISOString().split("T")[0];
    apiFetch(`${API}/api/v1/scheduler/generate-work-orders?target_date=${today}`, { method: "POST" })
      .then((res) => res.json())
      .then((data) => {
        setGenerating(false);
        showToast(data.message || "Work orders generated!", "success");
      })
      .catch(() => {
        setGenerating(false);
        showToast("Failed to generate work orders.", "critical");
      });
  };

  const handleAttendanceSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedUser) return;
    setSubmitting(true);

    apiFetch(`${process.env.NEXT_PUBLIC_API_URL || "http://localhost:8003"}/api/v1/workforce/attendance`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        user_id: selectedUser,
        date: new Date().toISOString().split("T")[0],
        status: attendanceStatus,
      }),
    })
      .then((res) => res.json())
      .then(() => {
        setSubmitting(false);
        showToast("Attendance recorded successfully!", "success");
        fetchMetrics();
      })
      .catch((err) => {
        console.error(err);
        setSubmitting(false);
        showToast("Failed to record attendance.", "critical");
      });
  };

  return (
    <div>
      <div>
        <h1 className="font-display text-3xl font-extrabold uppercase tracking-wide text-ink">
          Workforce Intelligence
        </h1>
        <p className="text-ink-soft">Worker metrics, efficiency rankings, and attendance tracking.</p>
      </div>

      <div className="mt-6 grid grid-cols-1 gap-8 lg:grid-cols-3">
        <Card className="lg:col-span-1">
          <CardHeader title="Mark Daily Attendance" />
          <CardBody className="p-5">
            <form onSubmit={handleAttendanceSubmit} className="flex flex-col gap-4">
              <div>
                <Label>Select Worker</Label>
                <Select value={selectedUser || ""} onChange={(e) => setSelectedUser(Number(e.target.value))} required>
                  <option value="" disabled>
                    Select a worker...
                  </option>
                  {metrics.map((user) => (
                    <option key={user.user_id} value={user.user_id}>
                      {user.name} ({user.department || user.skill || "Unknown"})
                    </option>
                  ))}
                </Select>
              </div>
              <div>
                <Label>Status (Today)</Label>
                <Select value={attendanceStatus} onChange={(e) => setAttendanceStatus(e.target.value)}>
                  <option value="Present">Present</option>
                  <option value="Absent">Absent</option>
                  <option value="Leave">Leave</option>
                  <option value="Overtime">Overtime</option>
                </Select>
              </div>
              <Button type="submit" variant="primary" className="w-full justify-center" disabled={submitting}>
                {submitting ? "Saving…" : "Record Attendance"}
              </Button>
            </form>
            <div className="mt-4 border-t border-border pt-4">
              <p className="mb-2 text-xs text-ink-soft">After marking all attendance, generate today&apos;s work orders:</p>
              <Button variant="secondary" className="w-full justify-center" disabled={generating} onClick={handleGenerateWorkOrders}>
                {generating ? "Generating…" : "Generate Work Orders"}
              </Button>
            </div>
          </CardBody>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader title="Worker Performance Metrics" />
          {loading ? (
            <div className="p-6">
              <Spinner label="Loading metrics…" />
            </div>
          ) : (
            <Table>
              <THead>
                <Tr>
                  <Th>Name</Th>
                  <Th>Dept / Skill</Th>
                  <Th numeric>Attendance</Th>
                  <Th numeric>Efficiency</Th>
                  <Th numeric>Quality</Th>
                  <Th numeric>Reliability</Th>
                  <Th numeric>Profile</Th>
                </Tr>
              </THead>
              <TBody>
                {metrics.map((user) => (
                  <Tr key={user.user_id}>
                    <Td>
                      <Link href={`/workers/${user.user_id}`} className="font-bold text-brand underline underline-offset-2 hover:text-brand-deep">
                        {user.name}
                      </Link>
                    </Td>
                    <Td className="text-ink-soft">
                      {user.department || user.skill || "N/A"} {user.department && user.skill ? `/ ${user.skill}` : ""}
                    </Td>
                    <Td numeric>
                      <Badge tone={user.attendance_score >= 80 ? "success" : "critical"}>{user.attendance_score}%</Badge>
                    </Td>
                    <Td numeric className="font-semibold text-brand-deep">
                      {user.efficiency_score}%
                    </Td>
                    <Td numeric className="font-semibold text-ink">
                      {user.quality_score}%
                    </Td>
                    <Td numeric className="font-semibold text-ink">
                      {user.reliability_score}%
                    </Td>
                    <Td numeric>
                      <Link href={`/workers/${user.user_id}`} className="text-xs font-semibold text-brand hover:text-brand-deep">
                        View →
                      </Link>
                    </Td>
                  </Tr>
                ))}
                {metrics.length === 0 && (
                  <Tr>
                    <Td colSpan={6} className="text-center text-ink-soft">
                      No workforce data available.
                    </Td>
                  </Tr>
                )}
              </TBody>
            </Table>
          )}
        </Card>
      </div>

      {toasts}
    </div>
  );
}
