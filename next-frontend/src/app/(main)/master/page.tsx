"use client";
import { apiFetch } from "@/lib/api";

import { useEffect, useRef, useState } from "react";
import {
  Button,
  Card,
  CardHeader,
  CardBody,
  Badge,
  Table,
  THead,
  TBody,
  Tr,
  Th,
  Td,
  Alert,
  EmptyState,
  Spinner,
  Input,
  Label,
  useToast,
} from "@/components/ui";

type Tab = "welding" | "workforce" | "pool";

const TABS: { key: Tab; label: string }[] = [
  { key: "welding", label: "Welding Workload Engine" },
  { key: "workforce", label: "Workforce Master" },
  { key: "pool", label: "Company Resource Pool" },
];

export default function MasterData() {
  const { showToast, toasts } = useToast();
  const [userRole, setUserRole] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<Tab>("welding");
  const [data, setData] = useState<any[]>([]);
  const [workforce, setWorkforce] = useState<any[]>([]);
  const [pool, setPool] = useState<any>({ total_tig_welders: 0, total_mig_welders: 0, total_grinders: 0 });
  const [loading, setLoading] = useState(true);
  const [syncingEJ, setSyncingEJ] = useState(false);
  const [syncingDJ, setSyncingDJ] = useState(false);
  const [syncingAll, setSyncingAll] = useState(false);
  const [uploadingEJ, setUploadingEJ] = useState(false);
  const [uploadingDJ, setUploadingDJ] = useState(false);
  const [message, setMessage] = useState<{ tone: "success" | "critical"; text: string } | null>(null);
  const ejFileInputRef = useRef<HTMLInputElement>(null);
  const djFileInputRef = useRef<HTMLInputElement>(null);

  const fetchData = () => {
    setLoading(true);
    Promise.all([
      apiFetch(`${process.env.NEXT_PUBLIC_API_URL || "http://localhost:8003"}/api/v1/master/welding`).then((r) => r.json()),
      apiFetch(`${process.env.NEXT_PUBLIC_API_URL || "http://localhost:8003"}/api/v1/master/workforce`).then((r) => r.json()),
      apiFetch(`${process.env.NEXT_PUBLIC_API_URL || "http://localhost:8003"}/api/v1/master/pool`).then((r) => r.json()),
    ]).then(([weldingRes, workforceRes, poolRes]) => {
      setData(weldingRes.data || []);
      setWorkforce(workforceRes.data || []);
      setPool(poolRes.data || { total_tig_welders: 0, total_mig_welders: 0, total_grinders: 0 });
      setLoading(false);
    });
  };

  useEffect(() => {
    setUserRole(localStorage.getItem("user_role"));
    fetchData();
  }, []);

  const handleSyncEJ = async () => {
    setSyncingEJ(true);
    setMessage(null);
    try {
      const res = await apiFetch(`${process.env.NEXT_PUBLIC_API_URL || "http://localhost:8003"}/api/v1/master/sync/ej`, { method: "POST" });
      const json = await res.json();
      if (!res.ok) throw new Error(json.detail);
      setMessage({ tone: "success", text: "EJ " + json.message });
      fetchData();
    } catch (err: any) {
      setMessage({ tone: "critical", text: "Error syncing EJ: " + err.message });
    } finally {
      setSyncingEJ(false);
    }
  };

  const handleSyncDJ = async () => {
    setSyncingDJ(true);
    setMessage(null);
    try {
      const res = await apiFetch(`${process.env.NEXT_PUBLIC_API_URL || "http://localhost:8003"}/api/v1/master/sync/dj`, { method: "POST" });
      const json = await res.json();
      if (!res.ok) throw new Error(json.detail);
      setMessage({ tone: "success", text: "DJ " + json.message });
      fetchData();
    } catch (err: any) {
      setMessage({ tone: "critical", text: "Error syncing DJ: " + err.message });
    } finally {
      setSyncingDJ(false);
    }
  };

  const handleSyncAll = async () => {
    setSyncingAll(true);
    setMessage(null);
    try {
      const res = await apiFetch(`${process.env.NEXT_PUBLIC_API_URL || "http://localhost:8003"}/api/v1/master/sync/all`, { method: "POST" });
      const json = await res.json();
      if (!res.ok) throw new Error(json.detail);
      setMessage({ tone: "success", text: json.message });
      fetchData();
    } catch (err: any) {
      setMessage({ tone: "critical", text: "Error syncing all data: " + err.message });
    } finally {
      setSyncingAll(false);
    }
  };

  const uploadMasterFile = async (
    file: File,
    endpoint: string,
    label: string,
    setUploading: (v: boolean) => void
  ) => {
    setUploading(true);
    setMessage(null);
    try {
      const formData = new FormData();
      formData.append("file", file);
      const res = await apiFetch(
        `${process.env.NEXT_PUBLIC_API_URL || "http://localhost:8003"}/api/v1/master/${endpoint}`,
        { method: "POST", body: formData }
      );
      const json = await res.json();
      if (!res.ok) throw new Error(json.detail || "Upload failed");
      setMessage({ tone: "success", text: `${label} ` + json.message });
      fetchData();
    } catch (err: any) {
      setMessage({ tone: "critical", text: `Error uploading ${label} file: ` + err.message });
    } finally {
      setUploading(false);
    }
  };

  const handleEJFileSelected = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = ""; // allow re-selecting the same file next time
    if (file) uploadMasterFile(file, "welding-import", "EJ", setUploadingEJ);
  };

  const handleDJFileSelected = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (file) uploadMasterFile(file, "dj-import", "DJ", setUploadingDJ);
  };

  const updateWorkforce = async (id: number, productivity: number) => {
    await apiFetch(`${process.env.NEXT_PUBLIC_API_URL || "http://localhost:8003"}/api/v1/master/workforce/${id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ productivity }),
    });
    showToast("Workforce productivity updated", "success");
    fetchData();
  };

  const updatePool = async (e: React.FormEvent) => {
    e.preventDefault();
    await apiFetch(`${process.env.NEXT_PUBLIC_API_URL || "http://localhost:8003"}/api/v1/master/pool`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(pool),
    });
    showToast("Company resource pool updated", "success");
    fetchData();
  };

  const canViewMaster = userRole === "Developer" || userRole === "GM";

  if (loading) {
    return (
      <div className="p-10">
        <Spinner label="Loading master data…" />
      </div>
    );
  }

  return (
    <div>
      <div>
        <h1 className="font-display text-3xl font-extrabold uppercase tracking-wide text-ink">
          Production &amp; Capacity Master
        </h1>
        <p className="text-ink-soft">Manage the algorithm&apos;s base constants, master data, and total company resources.</p>
      </div>

      <div className="mt-6 flex gap-2 border-b border-line">
        {TABS.map((tab) => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            className={`-mb-px border-b-2 px-1 pb-2.5 text-sm font-semibold transition-colors ${
              activeTab === tab.key
                ? "border-brand text-brand-deep"
                : "border-transparent text-ink-soft hover:text-ink"
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {activeTab === "welding" && (
        <Card className="mt-6">
          <CardHeader
            title="Welding Master Data"
            action={
              canViewMaster && (
                <div className="flex flex-wrap justify-end gap-2">
                  <Button variant="secondary" onClick={handleSyncAll} disabled={syncingEJ || syncingDJ || syncingAll}>
                    {syncingAll ? "Syncing Both…" : "Sync All Data"}
                  </Button>
                  <Button variant="secondary" onClick={handleSyncEJ} disabled={syncingEJ || syncingDJ || syncingAll}>
                    {syncingEJ ? "Syncing EJ…" : "Sync EJ Data"}
                  </Button>
                  <Button variant="secondary" onClick={handleSyncDJ} disabled={syncingEJ || syncingDJ || syncingAll}>
                    {syncingDJ ? "Syncing DJ…" : "Sync DJ Data"}
                  </Button>

                  <input ref={ejFileInputRef} type="file" accept=".xlsx,.xls" className="hidden" onChange={handleEJFileSelected} />
                  <Button variant="ghost" onClick={() => ejFileInputRef.current?.click()} disabled={uploadingEJ || uploadingDJ}>
                    {uploadingEJ ? "Uploading EJ…" : "Upload EJ Excel"}
                  </Button>

                  <input ref={djFileInputRef} type="file" accept=".xlsx,.xls" className="hidden" onChange={handleDJFileSelected} />
                  <Button variant="ghost" onClick={() => djFileInputRef.current?.click()} disabled={uploadingEJ || uploadingDJ}>
                    {uploadingDJ ? "Uploading DJ…" : "Upload DJ Excel"}
                  </Button>
                </div>
              )
            }
          />
          <CardBody className="p-5">
            <p className="-mt-1 text-[13px] text-ink-soft">
              &quot;Sync&quot; re-reads the file already on the server. &quot;Upload&quot; replaces it with a new Excel file you pick now.
            </p>

            {message && <Alert tone={message.tone} title={message.tone === "success" ? "Success" : "Error"}>{message.text}</Alert>}

            {canViewMaster ? (
              <div className="flex flex-col gap-8">
                <div>
                  <h3 className="mb-3 border-l-4 border-brand pl-2 font-display text-sm font-bold uppercase tracking-wide text-ink">
                    Expansion Joints
                  </h3>
                  <Table>
                    <THead>
                      <Tr>
                        <Th>Size (NB)</Th>
                        <Th numeric>TIG (ft)</Th>
                        <Th numeric>MIG (ft)</Th>
                        <Th numeric>Grinding (sq ft)</Th>
                      </Tr>
                    </THead>
                    <TBody>
                      {data
                        .filter((r) => r.type === "EJ")
                        .map((row) => (
                          <Tr key={`EJ-${row.size}`}>
                            <Td className="font-bold text-ink">{row.size}</Td>
                            <Td numeric>{row.tig_feet}</Td>
                            <Td numeric>{row.mig_feet}</Td>
                            <Td numeric>{row.grinding_feet}</Td>
                          </Tr>
                        ))}
                      {data.filter((r) => r.type === "EJ").length === 0 && (
                        <Tr>
                          <Td colSpan={4} className="text-center text-ink-soft">
                            No Expansion Joint records found. Please sync data.
                          </Td>
                        </Tr>
                      )}
                    </TBody>
                  </Table>
                </div>

                <div>
                  <h3 className="mb-3 border-l-4 border-brand-deep pl-2 font-display text-sm font-bold uppercase tracking-wide text-ink">
                    Dismantling Joints
                  </h3>
                  <Table>
                    <THead>
                      <Tr>
                        <Th>Size (NB)</Th>
                        <Th numeric>Welding Feet</Th>
                        <Th numeric>Grinding (sq ft)</Th>
                      </Tr>
                    </THead>
                    <TBody>
                      {data
                        .filter((r) => r.type === "DJ")
                        .map((row) => (
                          <Tr key={`DJ-${row.size}`}>
                            <Td className="font-bold text-ink">{row.size}</Td>
                            <Td numeric>{row.mig_feet || row.tig_feet}</Td>
                            <Td numeric>{row.grinding_feet}</Td>
                          </Tr>
                        ))}
                      {data.filter((r) => r.type === "DJ").length === 0 && (
                        <Tr>
                          <Td colSpan={3} className="text-center text-ink-soft">
                            No Dismantling Joint records found. Please sync data.
                          </Td>
                        </Tr>
                      )}
                    </TBody>
                  </Table>
                </div>
              </div>
            ) : (
              <EmptyState
                title="Access Restricted"
                description="You do not have permission to view the raw welding master data. Sync operations are permitted if authorized."
              />
            )}
          </CardBody>
        </Card>
      )}

      {activeTab === "workforce" && (
        <Card className="mt-6">
          <CardHeader title="Base Productivity (ft/hour)" />
          <CardBody className="p-5">
            <div className="grid grid-cols-1 gap-6 md:grid-cols-3">
              {workforce.map((w) => (
                <div key={w.id} className="rounded-md border border-line p-4">
                  <Label>{w.resource_type}</Label>
                  <div className="flex gap-2">
                    <Input
                      type="number"
                      value={w.productivity}
                      onChange={(e) => {
                        const newWf = [...workforce];
                        const idx = newWf.findIndex((x) => x.id === w.id);
                        newWf[idx].productivity = parseFloat(e.target.value) || 0;
                        setWorkforce(newWf);
                      }}
                    />
                    <Button onClick={() => updateWorkforce(w.id, w.productivity)}>Save</Button>
                  </div>
                </div>
              ))}
            </div>
          </CardBody>
        </Card>
      )}

      {activeTab === "pool" && (
        <Card className="mt-6">
          <CardHeader title="Company Resource Pool" />
          <form onSubmit={updatePool}>
            <CardBody className="p-5">
              {pool.required && (
                <div className="rounded-md border border-line bg-paper p-4">
                  <h3 className="mb-3 text-[12.5px] font-semibold text-ink-soft">Live Requirements (Active Projects)</h3>
                  <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
                    <div className="flex items-center justify-between rounded border border-line bg-paper-raised p-2">
                      <span className="text-sm text-ink-soft">
                        TIG Required: <strong className="text-ink">{pool.required.tig}</strong>
                      </span>
                      <Badge tone={pool.total_tig_welders - pool.required.tig < 0 ? "critical" : "success"}>
                        Deficit: {pool.total_tig_welders - pool.required.tig}
                      </Badge>
                    </div>
                    <div className="flex items-center justify-between rounded border border-line bg-paper-raised p-2">
                      <span className="text-sm text-ink-soft">
                        MIG Required: <strong className="text-ink">{pool.required.mig}</strong>
                      </span>
                      <Badge tone={pool.total_mig_welders - pool.required.mig < 0 ? "critical" : "success"}>
                        Deficit: {pool.total_mig_welders - pool.required.mig}
                      </Badge>
                    </div>
                    <div className="flex items-center justify-between rounded border border-line bg-paper-raised p-2">
                      <span className="text-sm text-ink-soft">
                        Grinders Required: <strong className="text-ink">{pool.required.grinders}</strong>
                      </span>
                      <Badge tone={pool.total_grinders - pool.required.grinders < 0 ? "critical" : "success"}>
                        Deficit: {pool.total_grinders - pool.required.grinders}
                      </Badge>
                    </div>
                  </div>
                </div>
              )}

              <div className="grid grid-cols-1 gap-6 md:grid-cols-3">
                <div>
                  <Label>Total TIG Welders</Label>
                  <Input
                    type="number"
                    min="0"
                    required
                    value={pool.total_tig_welders}
                    onChange={(e) => setPool({ ...pool, total_tig_welders: parseInt(e.target.value) || 0 })}
                  />
                </div>
                <div>
                  <Label>Total MIG Welders</Label>
                  <Input
                    type="number"
                    min="0"
                    required
                    value={pool.total_mig_welders}
                    onChange={(e) => setPool({ ...pool, total_mig_welders: parseInt(e.target.value) || 0 })}
                  />
                </div>
                <div>
                  <Label>Total Grinders</Label>
                  <Input
                    type="number"
                    min="0"
                    required
                    value={pool.total_grinders}
                    onChange={(e) => setPool({ ...pool, total_grinders: parseInt(e.target.value) || 0 })}
                  />
                </div>
              </div>
              <Button type="submit" className="w-fit justify-center">
                Save Pool Settings
              </Button>
            </CardBody>
          </form>
        </Card>
      )}

      {toasts}
    </div>
  );
}
