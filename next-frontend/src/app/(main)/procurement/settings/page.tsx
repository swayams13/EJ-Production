"use client";
import { useEffect, useState } from "react";
import { apiFetch } from "@/lib/api";
import { isManagementRole } from "@/lib/auth";
import {
  Card, CardHeader,
  Table, THead, TBody, Tr, Th, Td,
  Input, Button, Spinner, Alert,
  useToast,
} from "@/components/ui";

const API = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8003";

interface LeadTime {
  id: number;
  material_name: string;
  lead_time_days: number;
}

export default function SettingsPage() {
  const { showToast, toasts } = useToast();
  const [leadTimes, setLeadTimes] = useState<LeadTime[]>([]);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState("");
  const [editing, setEditing] = useState<Record<string, number>>({});
  const [saving, setSaving] = useState<string | null>(null);
  // ponytail: localStorage role check — matches vendors page pattern
  const isManagement = typeof window !== "undefined" && isManagementRole(localStorage.getItem("user_role"));

  const load = async () => {
    setLoading(true);
    setFetchError("");
    try {
      const res = await apiFetch(`${API}/api/v1/procurement/lead-times`);
      if (res.ok) {
        setLeadTimes(await res.json());
      } else {
        const body = await res.json().catch(() => ({})) as { detail?: string };
        setFetchError(body.detail || "Failed to load lead times.");
      }
    } catch (e) {
      setFetchError(e instanceof Error ? e.message : "Network error.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const save = async (material_name: string) => {
    const days = editing[material_name];
    if (days === undefined) return;
    setSaving(material_name);
    try {
      const res = await apiFetch(
        `${API}/api/v1/procurement/lead-times/${encodeURIComponent(material_name)}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ lead_time_days: days }),
        }
      );
      if (res.ok) {
        showToast(`Lead time for "${material_name}" updated.`);
        setEditing(prev => { const next = { ...prev }; delete next[material_name]; return next; });
        load();
      } else {
        const body = await res.json().catch(() => ({})) as { detail?: string };
        showToast(body.detail || "Save failed.", "critical");
      }
    } catch (e) {
      showToast(e instanceof Error ? e.message : "Network error.", "critical");
    } finally {
      setSaving(null);
    }
  };

  if (loading) return <div className="flex items-center justify-center p-16"><Spinner label="Loading lead times…" /></div>;

  return (
    <div className="flex flex-col gap-6">
      {toasts}

      <div>
        <h1 className="font-display text-3xl font-extrabold uppercase tracking-wide text-ink">Procurement Settings</h1>
        <p className="text-ink-soft">Configure lead time days per material type. These drive the morning list order-by dates.</p>
      </div>

      {fetchError && <Alert tone="critical" title="Error loading lead times">{fetchError}</Alert>}

      <Card>
        <CardHeader title="Material Lead Times" />
        <Table>
          <THead>
            <Tr>
              <Th>Material</Th>
              <Th numeric>Lead Time (days)</Th>
              {isManagement && <Th numeric>Action</Th>}
            </Tr>
          </THead>
          <TBody>
            {leadTimes.map((lt) => {
              const isDirty = editing[lt.material_name] !== undefined && editing[lt.material_name] !== lt.lead_time_days;
              return (
                <Tr key={lt.id}>
                  <Td className="font-semibold text-ink">{lt.material_name}</Td>
                  <Td numeric>
                    {isManagement ? (
                      <Input
                        type="number"
                        className="w-24 text-right font-data"
                        value={editing[lt.material_name] ?? lt.lead_time_days}
                        onChange={e => setEditing({ ...editing, [lt.material_name]: +e.target.value })}
                        min={0}
                      />
                    ) : (
                      <span className="font-data">{lt.lead_time_days}</span>
                    )}
                  </Td>
                  {isManagement && (
                    <Td numeric>
                      {isDirty ? (
                        <Button
                          variant="primary"
                          onClick={() => save(lt.material_name)}
                          disabled={saving === lt.material_name}
                        >
                          {saving === lt.material_name ? "Saving…" : "Save"}
                        </Button>
                      ) : (
                        <span className="text-sm text-ink-soft">—</span>
                      )}
                    </Td>
                  )}
                </Tr>
              );
            })}
            {leadTimes.length === 0 && (
              <Tr>
                <Td colSpan={isManagement ? 3 : 2} className="py-10 text-center text-ink-soft">
                  No lead times configured yet.
                </Td>
              </Tr>
            )}
          </TBody>
        </Table>
      </Card>
    </div>
  );
}
