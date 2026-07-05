"use client";
import { apiFetch } from "@/lib/api";

import { useState, useEffect } from "react";
import { Card, Select, Label, Badge, EmptyState, Spinner, ProgressBar } from "@/components/ui";

interface ProjectOption {
  id: number;
  quotation_no: string;
  project_name?: string;
}

interface RequirementOption {
  id: number;
  type: string;
  size: string;
  total_qty: number;
}

interface ProcessRow {
  id: string;
  process_name: string;
  completed_qty: number;
}

interface PartRow {
  id: string;
  name: string;
  weight_percentage: number;
  processes: ProcessRow[];
}

interface ProgressData {
  total_qty: number;
  parts: PartRow[];
}

export default function VisualTracking() {
  const [projects, setProjects] = useState<ProjectOption[]>([]);
  const [projectId, setProjectId] = useState("");

  const [requirements, setRequirements] = useState<RequirementOption[]>([]);
  const [requirementId, setRequirementId] = useState("");

  const [progressData, setProgressData] = useState<ProgressData | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    apiFetch(`${process.env.NEXT_PUBLIC_API_URL || "http://localhost:8003"}/api/v1/projects`)
      .then((res) => res.json())
      .then((resData) => setProjects(resData.data || []));
  }, []);

  useEffect(() => {
    if (!projectId) {
      setRequirements([]);
      setRequirementId("");
      return;
    }
    apiFetch(`${process.env.NEXT_PUBLIC_API_URL || "http://localhost:8003"}/api/v1/production/requirements/${projectId}`)
      .then((res) => res.json())
      .then((resData) => setRequirements(resData.data || []));
  }, [projectId]);

  useEffect(() => {
    if (!requirementId) {
      setProgressData(null);
      return;
    }
    setLoading(true);

    const fetchProgress = () => {
      apiFetch(`${process.env.NEXT_PUBLIC_API_URL || "http://localhost:8003"}/api/v1/production/parts/${requirementId}`)
        .then((res) => res.json())
        .then((resData) => {
          if (resData.success && resData.data) {
            setProgressData(resData.data);
          } else {
            setProgressData(null);
          }
          setLoading(false);
        });
    };

    fetchProgress();
    const interval = setInterval(fetchProgress, 3000);

    return () => clearInterval(interval);
  }, [requirementId]);

  const currentReqType = requirements.find((r) => r.id.toString() === requirementId)?.type;

  return (
    <div className="mx-auto mb-20 max-w-7xl">
      <div>
        <h1 className="font-display text-3xl font-extrabold uppercase tracking-wide text-ink">Visual Tracking</h1>
        <p className="text-ink-soft">Live stage-by-stage progression for requirements.</p>
      </div>

      <Card className="mt-6 flex flex-col gap-4 p-5 md:flex-row">
        <div className="flex-1">
          <Label>Select Project</Label>
          <Select value={projectId} onChange={(e) => setProjectId(e.target.value)}>
            <option value="">-- Choose Project --</option>
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.project_name || p.quotation_no}
              </option>
            ))}
          </Select>
        </div>

        <div className="flex-1">
          <Label>Select Requirement</Label>
          <Select value={requirementId} onChange={(e) => setRequirementId(e.target.value)} disabled={!projectId}>
            <option value="">-- Choose Requirement --</option>
            {requirements.map((r) => (
              <option key={r.id} value={r.id}>
                {r.type} - {r.size} (Qty: {r.total_qty})
              </option>
            ))}
          </Select>
        </div>
      </Card>

      {!requirementId && (
        <Card className="mt-6 p-16">
          <EmptyState
            title="No Requirement Selected"
            description="Select a project and requirement above to view its live progress board."
          />
        </Card>
      )}

      {loading && requirementId && (
        <div className="mt-6">
          <Spinner label="Loading progress…" />
        </div>
      )}

      {progressData && !loading && (
        <Card className="mt-6 p-8">
          <div className="mb-8 flex items-center justify-between border-b border-line pb-6">
            <div>
              <Badge tone="brand">Requirement Breakdown</Badge>
              <h2 className="mt-3 text-2xl font-extrabold text-ink">
                {currentReqType === "DJ" ? "Dismantling Joint" : "Expansion Joint"}
              </h2>
            </div>
            <div className="rounded-lg border border-line bg-paper p-4 text-right">
              <p className="text-xs font-bold uppercase tracking-wide text-ink-soft">Target Qty</p>
              <p className="font-data tabular-nums text-3xl font-bold text-brand-deep">{progressData.total_qty}</p>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-8 lg:grid-cols-2">
            {progressData.parts.map((part) => (
              <div key={part.id} className="rounded-lg border border-line bg-paper p-6">
                <div className="mb-6 flex items-center justify-between">
                  <h3 className="text-lg font-bold text-ink">{part.name}</h3>
                  <Badge tone="neutral">Weight: {part.weight_percentage}%</Badge>
                </div>

                <div className="flex flex-col gap-5">
                  {part.processes.map((proc) => {
                    const pct = Math.min(100, Math.round((proc.completed_qty / progressData.total_qty) * 100)) || 0;

                    return (
                      <div key={proc.id}>
                        <div className="mb-1 flex items-end justify-between">
                          <span className="text-xs font-bold uppercase tracking-wide text-ink">{proc.process_name}</span>
                          <span className="font-data tabular-nums text-xs text-ink-soft">
                            {proc.completed_qty} / {progressData.total_qty} done
                          </span>
                        </div>
                        <ProgressBar
                          label={proc.process_name}
                          showLabel={false}
                          percent={pct}
                          tone={pct === 100 ? "success" : "brand"}
                        />
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        </Card>
      )}
    </div>
  );
}
