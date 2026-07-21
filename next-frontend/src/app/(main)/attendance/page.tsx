"use client";

import { useEffect, useRef, useState } from "react";
import * as XLSX from "xlsx";
import { apiFetch } from "@/lib/api";
import { Button, Card, CardBody, CardHeader, Spinner } from "@/components/ui";
import { useToast } from "@/components/ui";

const API = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8003";

const STATUSES = [
  { key: "Present",  short: "P",  bg: "bg-success",  text: "text-white" },
  { key: "Overtime", short: "OT", bg: "bg-brand",    text: "text-white" },
  { key: "Leave",    short: "L",  bg: "bg-warning",  text: "text-white" },
  { key: "Absent",   short: "A",  bg: "bg-critical", text: "text-white" },
] as const;

const STATUS_LABEL_MAP: Record<string, string> = {
  P: "Present", PRESENT: "Present",
  OT: "Overtime", OVERTIME: "Overtime",
  L: "Leave", LEAVE: "Leave",
  A: "Absent", ABSENT: "Absent",
};

function todayISO() {
  return new Date().toISOString().split("T")[0];
}

interface Worker { id: number; name: string; skill?: string; department?: string; role: string; }
interface MarkMap { [userId: number]: string }
interface PreviewRow { user_id: number; name: string; status: string; valid: boolean }

export default function AttendancePage() {
  const { showToast } = useToast();
  const [tab, setTab] = useState<"quick" | "excel">("quick");
  const [date, setDate] = useState(todayISO);
  const [workers, setWorkers] = useState<Worker[]>([]);
  const [marks, setMarks] = useState<MarkMap>({});
  const [loadingWorkers, setLoadingWorkers] = useState(true);
  const [submitting, setSubmitting] = useState(false);

  // Excel tab state
  const fileRef = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState<PreviewRow[]>([]);
  const [parseError, setParseError] = useState("");

  useEffect(() => {
    apiFetch(`${API}/api/v1/users`)
      .then((r) => r.json())
      .then((d) => {
        const list: Worker[] = (d.data ?? []).filter((u: Worker) =>
          ["Operator", "Supervisor"].includes(u.role)
        );
        setWorkers(list);
        const defaults: MarkMap = {};
        list.forEach((w) => { defaults[w.id] = "Present"; });
        setMarks(defaults);
        setLoadingWorkers(false);
      })
      .catch(() => setLoadingWorkers(false));
  }, []);

  function toggle(userId: number, status: string) {
    setMarks((prev) => ({ ...prev, [userId]: status }));
  }

  async function submitBulk(rows: { user_id: number; status: string }[]) {
    setSubmitting(true);
    try {
      const records = rows.map((r) => ({ user_id: r.user_id, date, status: r.status }));
      const res = await apiFetch(`${API}/api/v1/workforce/attendance/bulk`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(records),
      });
      if (!res.ok) throw new Error("Server error");
      const d = await res.json();
      showToast(`Saved ${d.count} attendance records for ${date}.`, "success");
      setPreview([]);
    } catch {
      showToast("Failed to save attendance. Try again.", "critical");
    } finally {
      setSubmitting(false);
    }
  }

  function handleQuickSubmit() {
    const rows = Object.entries(marks).map(([uid, status]) => ({
      user_id: Number(uid),
      status,
    }));
    submitBulk(rows);
  }

  function downloadTemplate() {
    const rows = [["Name", "Status (P / OT / L / A)", "user_id"]];
    workers.forEach((w) => rows.push([w.name, "P", String(w.id)]));
    const ws = XLSX.utils.aoa_to_sheet(rows);
    ws["!cols"] = [{ wch: 28 }, { wch: 22 }, { wch: 10 }];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Attendance");
    XLSX.writeFile(wb, `attendance_template_${date}.xlsx`);
  }

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    setParseError(""); setPreview([]);
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const wb = XLSX.read(ev.target?.result, { type: "array" });
        const ws = wb.Sheets[wb.SheetNames[0]];
        const rows = XLSX.utils.sheet_to_json<string[]>(ws, { header: 1 }) as string[][];
        const workerById = new Map(workers.map((w) => [w.id, w.name]));
        const workerByName = new Map(workers.map((w) => [w.name.toLowerCase().trim(), w.id]));

        const parsed: PreviewRow[] = [];
        for (let i = 1; i < rows.length; i++) {
          const row = rows[i];
          if (!row || row.length < 2) continue;
          const nameCell = String(row[0] ?? "").trim();
          const statusRaw = String(row[1] ?? "").trim().toUpperCase();
          const userIdCell = row[2] != null ? Number(row[2]) : NaN;

          const status = STATUS_LABEL_MAP[statusRaw];
          const user_id = !isNaN(userIdCell) && workerById.has(userIdCell)
            ? userIdCell
            : workerByName.get(nameCell.toLowerCase()) ?? NaN;
          const name = workerById.get(user_id) ?? nameCell;
          parsed.push({ user_id, name, status: status ?? statusRaw, valid: !isNaN(user_id) && !!status });
        }
        if (!parsed.length) { setParseError("No data rows found. Make sure you didn't delete the header."); return; }
        setPreview(parsed);
      } catch {
        setParseError("Could not read the file. Make sure it's an .xlsx or .csv file.");
      }
    };
    reader.readAsArrayBuffer(file);
  }

  function handleExcelSubmit() {
    const valid = preview.filter((r) => r.valid);
    submitBulk(valid.map((r) => ({ user_id: r.user_id, status: r.status })));
  }

  const presentCount = Object.values(marks).filter((s) => s === "Present").length;
  const overtimeCount = Object.values(marks).filter((s) => s === "Overtime").length;
  const absentCount = Object.values(marks).filter((s) => s === "Absent").length;
  const leaveCount = Object.values(marks).filter((s) => s === "Leave").length;

  return (
    <div className="max-w-2xl">
      <div className="mb-6">
        <h1 className="font-display text-3xl font-extrabold uppercase tracking-wide text-ink">Daily Attendance</h1>
        <p className="mt-1 text-sm text-ink-soft">Mark attendance for all workers in one go.</p>
      </div>

      {/* Date picker + tab toggle */}
      <div className="mb-5 flex flex-wrap items-center gap-3">
        <input
          type="date"
          value={date}
          max={todayISO()}
          onChange={(e) => setDate(e.target.value)}
          className="rounded border border-line bg-paper px-3 py-2 text-sm text-ink focus:border-brand focus:outline-none"
        />
        <div className="flex rounded border border-line bg-paper-raised p-1">
          {(["quick", "excel"] as const).map((t) => (
            <button key={t} onClick={() => setTab(t)}
              className={`rounded px-4 py-1.5 text-sm font-semibold transition-colors ${tab === t ? "bg-ink text-white" : "text-ink-soft hover:text-ink"}`}>
              {t === "quick" ? "Quick Mark" : "Excel Upload"}
            </button>
          ))}
        </div>
      </div>

      {/* ── QUICK MARK TAB ── */}
      {tab === "quick" && (
        <>
          {loadingWorkers ? (
            <div className="flex justify-center py-12"><Spinner label="Loading workers…" /></div>
          ) : workers.length === 0 ? (
            <p className="text-sm text-ink-soft">No workers found.</p>
          ) : (
            <>
              {/* Summary bar */}
              <div className="mb-4 flex flex-wrap gap-3 text-sm">
                <span className="font-semibold text-success">{presentCount} Present</span>
                <span className="text-ink-soft">·</span>
                <span className="font-semibold text-brand">{overtimeCount} Overtime</span>
                <span className="text-ink-soft">·</span>
                <span className="font-semibold text-warning">{leaveCount} Leave</span>
                <span className="text-ink-soft">·</span>
                <span className="font-semibold text-critical">{absentCount} Absent</span>
              </div>

              {/* Worker cards */}
              <div className="flex flex-col gap-2">
                {workers.map((w) => {
                  const current = marks[w.id] ?? "Present";
                  return (
                    <Card key={w.id}>
                      <CardBody className="flex items-center gap-3 p-3">
                        {/* Name */}
                        <div className="min-w-0 flex-1">
                          <p className="truncate font-semibold text-sm text-ink">{w.name}</p>
                          <p className="text-xs text-ink-soft">{w.skill || w.department || w.role}</p>
                        </div>
                        {/* Status chips */}
                        <div className="flex flex-shrink-0 gap-1">
                          {STATUSES.map(({ key, short, bg, text }) => (
                            <button
                              key={key}
                              onClick={() => toggle(w.id, key)}
                              className={`min-w-[36px] rounded px-2 py-1.5 text-xs font-bold transition-all ${
                                current === key
                                  ? `${bg} ${text} shadow-sm`
                                  : "bg-paper-raised text-ink-soft hover:text-ink"
                              }`}
                            >
                              {short}
                            </button>
                          ))}
                        </div>
                      </CardBody>
                    </Card>
                  );
                })}
              </div>

              {/* Submit */}
              <div className="sticky bottom-4 mt-4">
                <Button
                  variant="primary"
                  onClick={handleQuickSubmit}
                  disabled={submitting || workers.length === 0}
                  className="w-full py-3 text-base shadow-lg"
                >
                  {submitting ? "Saving…" : `Submit Attendance for ${workers.length} Workers`}
                </Button>
              </div>
            </>
          )}
        </>
      )}

      {/* ── EXCEL UPLOAD TAB ── */}
      {tab === "excel" && (
        <div className="flex flex-col gap-5">
          <Card>
            <CardHeader title="Step 1 — Download Template" />
            <CardBody className="p-5">
              <p className="mb-3 text-sm text-ink-soft">
                Download the pre-filled template with all worker names. Fill column B with{" "}
                <strong>P</strong> (Present), <strong>OT</strong> (Overtime), <strong>L</strong> (Leave),
                or <strong>A</strong> (Absent).
              </p>
              <Button variant="secondary" onClick={downloadTemplate} disabled={workers.length === 0}>
                {workers.length === 0 ? "Loading workers…" : "Download Template (.xlsx)"}
              </Button>
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="Step 2 — Upload Filled Sheet" />
            <CardBody className="p-5">
              <p className="mb-3 text-sm text-ink-soft">Upload the filled .xlsx or .csv file.</p>
              <input
                ref={fileRef}
                type="file"
                accept=".xlsx,.csv"
                onChange={handleFileChange}
                className="block w-full text-sm text-ink-soft file:mr-3 file:rounded file:border-0 file:bg-brand file:px-3 file:py-1.5 file:text-xs file:font-semibold file:text-white hover:file:bg-brand-deep"
              />
              {parseError && <p className="mt-2 text-sm text-critical">{parseError}</p>}
            </CardBody>
          </Card>

          {preview.length > 0 && (
            <Card>
              <CardHeader title={`Step 3 — Preview (${preview.filter((r) => r.valid).length} valid / ${preview.length} rows)`} />
              <CardBody className="p-0">
                <div className="max-h-80 overflow-y-auto">
                  <table className="w-full text-sm">
                    <thead className="sticky top-0 bg-paper-raised">
                      <tr>
                        <th className="px-4 py-2 text-left font-semibold text-ink-soft">Worker</th>
                        <th className="px-4 py-2 text-left font-semibold text-ink-soft">Status</th>
                        <th className="px-4 py-2 text-center font-semibold text-ink-soft">Valid</th>
                      </tr>
                    </thead>
                    <tbody>
                      {preview.map((row, i) => (
                        <tr key={i} className={`border-t border-line ${!row.valid ? "opacity-50" : ""}`}>
                          <td className="px-4 py-2 text-ink">{row.name}</td>
                          <td className="px-4 py-2">
                            <span className={`rounded px-2 py-0.5 text-xs font-semibold ${
                              row.status === "Present" ? "bg-success/15 text-success" :
                              row.status === "Overtime" ? "bg-brand/15 text-brand" :
                              row.status === "Leave" ? "bg-warning/15 text-warning" :
                              row.status === "Absent" ? "bg-critical/15 text-critical" :
                              "bg-line text-ink-soft"
                            }`}>{row.status || "—"}</span>
                          </td>
                          <td className="px-4 py-2 text-center">
                            {row.valid ? "✓" : <span className="text-critical text-xs">Unmatched</span>}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </CardBody>
              <div className="border-t border-line p-4">
                {preview.some((r) => !r.valid) && (
                  <p className="mb-3 text-xs text-warning">
                    Unmatched rows will be skipped. Check that worker names match exactly or keep column C (user_id) intact.
                  </p>
                )}
                <Button
                  variant="primary"
                  onClick={handleExcelSubmit}
                  disabled={submitting || !preview.some((r) => r.valid)}
                >
                  {submitting ? "Saving…" : `Submit ${preview.filter((r) => r.valid).length} Records`}
                </Button>
              </div>
            </Card>
          )}
        </div>
      )}
    </div>
  );
}
