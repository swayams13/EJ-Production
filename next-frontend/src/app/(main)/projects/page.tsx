"use client";
import { apiFetch } from "@/lib/api";

import React, { useEffect, useState } from "react";
import Link from "next/link";
import { Card, MetricCard, Badge, Button, ProgressBar, Spinner, Table, THead, TBody, Tr, Th, Td, Modal } from "@/components/ui";
import MailButton from "@/components/MailButton";
import { useToast } from "@/components/ui/useToast";

interface Bellow {
  type: string;
  size: number;
  quantity: number;
  tig_feet: number;
  mig_feet: number;
  grinding_feet: number;
}

interface ProjectRow {
  id: number;
  quotation_no: string;
  project_name?: string;
  progress_percentage?: number;
  target_date?: string;
  assigned_tig: number;
  assigned_mig: number;
  assigned_grinders: number;
  payroll?: string;
  estimated_duration_days: number;
  status?: string;
  bellows: Bellow[];
  completion_request_status?: string | null;
}

interface CompletionPreview {
  project_name: string;
  quotation_no: string;
  production_lines: number;
  part_processes: number;
  assembly_steps: number;
  final_checks: number;
}

const TABLE_COLS = 7;

export default function ProjectsList() {
  const [projects, setProjects] = useState<ProjectRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const { showToast, toasts } = useToast();
  const [completionModal, setCompletionModal] = useState<{ projectId: number; preview: CompletionPreview | null } | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [userRole, setUserRole] = useState<string | null>(null);
  useEffect(() => { setUserRole(localStorage.getItem("user_role")); }, []);

  useEffect(() => {
    apiFetch(`${process.env.NEXT_PUBLIC_API_URL || "http://localhost:8003"}/api/v1/projects`)
      .then((res) => res.json())
      .then((resData) => {
        setProjects(resData.data || []);
        setLoading(false);
      });
  }, []);

  if (loading) return <Spinner label="Loading projects…" />;

  const sumBellows = (key: keyof Bellow) =>
    projects.reduce((sum, p) => sum + p.bellows.reduce((s, b) => s + (Number(b[key]) || 0), 0), 0);

  return (
    <div className="flex flex-col gap-8">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-display text-3xl font-extrabold uppercase tracking-wide text-ink">Projects</h1>
          <p className="text-ink-soft">Manage all active and completed projects.</p>
        </div>
        <Link href="/projects/add">
          <Button variant="primary">+ Schedule New Project</Button>
        </Link>
      </div>

      <div className="grid grid-cols-1 gap-6 md:grid-cols-4">
        <MetricCard label="Total TIG (ft)" value={sumBellows("tig_feet").toFixed(2)} />
        <MetricCard label="Total MIG (ft)" value={sumBellows("mig_feet").toFixed(2)} />
        <MetricCard label="Total Grinding (sq ft)" value={sumBellows("grinding_feet").toFixed(2)} />
        <MetricCard
          label="Total Est. Days"
          value={`${projects.reduce((sum, p) => sum + (p.estimated_duration_days || 0), 0)} days`}
          tone="success"
        />
      </div>

      <Card>
        <Table>
          <THead>
            <Tr>
              <Th>Project Code</Th>
              <Th>Progress</Th>
              <Th>Target Date</Th>
              <Th>Assigned Resources</Th>
              <Th>Payroll</Th>
              <Th>Est. Days</Th>
              <Th>Status</Th>
            </Tr>
          </THead>
          <TBody>
            {projects.map((p) => (
              <React.Fragment key={p.id}>
                <Tr className="cursor-pointer hover:bg-brand-tint/40" >
                  <Td className="font-medium text-brand-deep" onClick={() => setExpandedId(expandedId === p.id ? null : p.id)}>
                    <div className="flex items-center gap-2">
                      <svg
                        className={`h-4 w-4 transition-transform ${expandedId === p.id ? "rotate-90" : ""}`}
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                      >
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 5l7 7-7 7"></path>
                      </svg>
                      {p.quotation_no}
                    </div>
                  </Td>
                  <Td onClick={() => setExpandedId(expandedId === p.id ? null : p.id)}>
                    <div className="flex items-center gap-2">
                      <div className="w-24">
                        <ProgressBar
                          label=""
                          showLabel={false}
                          percent={p.progress_percentage || 0}
                          tone="success"
                        />
                      </div>
                      <span className="font-data tabular-nums text-xs text-ink-soft">
                        {p.progress_percentage || 0}%
                      </span>
                    </div>
                  </Td>
                  <Td className="text-ink-soft" onClick={() => setExpandedId(expandedId === p.id ? null : p.id)}>
                    {p.target_date ? new Date(p.target_date).toLocaleDateString("en-GB") : "N/A"}
                  </Td>
                  <Td onClick={() => setExpandedId(expandedId === p.id ? null : p.id)}>
                    <div className="flex flex-wrap gap-1.5">
                      <Badge tone="neutral">TIG: {p.assigned_tig}</Badge>
                      <Badge tone="neutral">MIG: {p.assigned_mig}</Badge>
                      <Badge tone="neutral">Grind: {p.assigned_grinders}</Badge>
                    </div>
                  </Td>
                  <Td onClick={() => setExpandedId(expandedId === p.id ? null : p.id)}>
                    <Badge tone={p.payroll === "Contractor" ? "warning" : "brand"}>{p.payroll || "Company"}</Badge>
                  </Td>
                  <Td onClick={() => setExpandedId(expandedId === p.id ? null : p.id)}>
                    {p.estimated_duration_days > 0 ? (
                      <span className="font-data tabular-nums font-semibold text-brand-deep">
                        {p.estimated_duration_days} days
                      </span>
                    ) : (
                      <span className="italic text-ink-soft">N/A</span>
                    )}
                  </Td>
                  <Td onClick={() => setExpandedId(expandedId === p.id ? null : p.id)}>
                    <Badge tone={p.status === "Completed" ? "success" : "brand"}>{p.status || "Active"}</Badge>
                  </Td>
                </Tr>
                {expandedId === p.id && (
                  <Tr className="bg-paper">
                    <Td colSpan={TABLE_COLS} className="p-6">
                      {p.bellows && p.bellows.length > 0 ? (
                        <Card>
                          <Table>
                            <THead>
                              <Tr>
                                <Th>Type</Th>
                                <Th>Size (NB)</Th>
                                <Th numeric>Quantity</Th>
                                <Th numeric>TIG / Welding (ft)</Th>
                                <Th numeric>Total MIG (ft)</Th>
                                <Th numeric>Grinding (sq ft)</Th>
                              </Tr>
                            </THead>
                            <TBody>
                              {p.bellows.map((b, idx) => (
                                <Tr key={idx}>
                                  <Td>
                                    <Badge tone={b.type === "DJ" ? "warning" : "brand"}>
                                      {b.type === "DJ" ? "Dismantling Joint" : "Expansion Joint"}
                                    </Badge>
                                  </Td>
                                  <Td className="text-ink">{b.size}</Td>
                                  <Td numeric>{b.quantity}</Td>
                                  <Td numeric>{b.type === "DJ" ? "-" : b.tig_feet}</Td>
                                  <Td numeric>{b.mig_feet}</Td>
                                  <Td numeric>{b.type === "DJ" ? "-" : b.grinding_feet}</Td>
                                </Tr>
                              ))}
                              <Tr className="bg-paper font-semibold">
                                <Td className="text-ink">Total</Td>
                                <Td />
                                <Td numeric>{p.bellows.reduce((sum, b) => sum + b.quantity, 0)}</Td>
                                <Td numeric className="text-brand-deep">
                                  {p.bellows.reduce((sum, b) => sum + b.tig_feet, 0).toFixed(2)}
                                </Td>
                                <Td numeric className="text-brand-deep">
                                  {p.bellows.reduce((sum, b) => sum + b.mig_feet, 0).toFixed(2)}
                                </Td>
                                <Td numeric className="text-brand-deep">
                                  {p.bellows.reduce((sum, b) => sum + b.grinding_feet, 0).toFixed(2)}
                                </Td>
                              </Tr>
                            </TBody>
                          </Table>
                        </Card>
                      ) : (
                        <p className="text-sm italic text-ink-soft">No expansion joints assigned to this project.</p>
                      )}
                      {userRole === "Production Manager" && (
                        <div className="mt-4 pt-4 border-t border-line">
                          {p.status === "Completed" ? (
                            <span className="text-sm text-ink-soft">Project completed.</span>
                          ) : p.completion_request_status === "pending" ? (
                            <span className="inline-flex items-center gap-1.5 rounded border border-amber-300 bg-amber-50 px-3 py-1.5 text-sm text-amber-700">
                              Completion approval pending GM review — entries can still be logged.
                            </span>
                          ) : (
                            <Button variant="secondary" onClick={async () => {
                              const API = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8003";
                              const res = await apiFetch(`${API}/api/v1/projects/${p.id}/completion-preview`);
                              if (res.ok) { const preview = await res.json(); setCompletionModal({ projectId: p.id, preview }); }
                            }}>Mark as Complete</Button>
                          )}
                        </div>
                      )}
                      {(userRole === "GM" || userRole === "Production Manager") && (
                        <div className="mt-2">
                          <MailButton
                            projectContext={{
                              quotation_no: p.quotation_no,
                              project_name: p.project_name || "",
                              status: p.status,
                              target_date: p.target_date,
                            }}
                          />
                        </div>
                      )}
                    </Td>
                  </Tr>
                )}
              </React.Fragment>
            ))}
            {projects.length === 0 && (
              <Tr>
                <Td colSpan={TABLE_COLS} className="text-center text-ink-soft">
                  No projects found.
                </Td>
              </Tr>
            )}
          </TBody>
        </Table>
      </Card>
      {toasts}
      {completionModal && (
        <Modal open onClose={() => setCompletionModal(null)} title="Review Completion Checklist" description={completionModal.preview?.quotation_no + " — " + completionModal.preview?.project_name} size="sm">
          <div className="space-y-3">
            <p className="text-sm text-ink-soft">These records will be marked complete upon GM approval:</p>
            <ul className="text-sm text-ink space-y-1">
              <li>Production lines: <span className="font-semibold">{completionModal.preview?.production_lines}</span></li>
              <li>Part processes: <span className="font-semibold">{completionModal.preview?.part_processes}</span></li>
              <li>Assembly steps: <span className="font-semibold">{completionModal.preview?.assembly_steps}</span></li>
              <li>Final checks: <span className="font-semibold">{completionModal.preview?.final_checks}</span></li>
            </ul>
            <p className="text-xs text-ink-soft border-t border-line pt-3">Cannot be undone after GM approval.</p>
            <div className="flex gap-2 justify-end pt-1">
              <Button variant="secondary" onClick={() => setCompletionModal(null)}>Cancel</Button>
              <Button variant="primary" disabled={submitting} onClick={async () => {
                setSubmitting(true);
                const API = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8003";
                try {
                  const res = await apiFetch(`${API}/api/v1/projects/${completionModal.projectId}/completion-request`, { method: "POST" });
                  if (res.ok) {
                    showToast("Completion request sent to GM for approval.", "success");
                    setCompletionModal(null);
                    const r = await apiFetch(`${API}/api/v1/projects`);
                    if (r.ok) setProjects((await r.json()).data || []);
                  } else {
                    const err = await res.json().catch(() => ({}));
                    showToast((err as { detail?: string }).detail || "Failed to submit.", "critical");
                  }
                } finally { setSubmitting(false); }
              }}>{submitting ? "Submitting…" : "Submit for Approval"}</Button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
