"use client";
import { apiFetch } from "@/lib/api";
import { useState, useEffect } from "react";
import { Card, Button, Badge, Spinner, Alert, Table, THead, TBody, Tr, Th, Td } from "@/components/ui";

export default function AuditLogsPage() {
  const [logs, setLogs] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState("");

  useEffect(() => {
    apiFetch(`${process.env.NEXT_PUBLIC_API_URL || "http://localhost:8003"}/api/v1/audit`)
      .then(async (res) => {
        if (!res.ok) {
          const data = await res.json();
          throw new Error(data.detail || "Failed to fetch logs. You might not have the correct permissions.");
        }
        return res.json();
      })
      .then((resData) => {
        setLogs(resData.data || []);
      })
      .catch((err) => setErrorMsg(err.message))
      .finally(() => setLoading(false));
  }, []);

  const handleDownloadExcel = () => {
    window.location.href = `${process.env.NEXT_PUBLIC_API_URL || "http://localhost:8003"}/api/v1/audit/excel`;
  };

  if (loading) {
    return (
      <div className="p-10">
        <Spinner label="Loading audit logs…" />
      </div>
    );
  }

  return (
    <div>
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-display text-3xl font-extrabold uppercase tracking-wide text-ink">System Audit Logs</h1>
          <p className="text-ink-soft">Tracking logins, data entry, and sensitive system changes.</p>
        </div>
        <Button onClick={handleDownloadExcel}>Download Logs (CSV/Excel)</Button>
      </div>

      {errorMsg ? (
        <div className="mt-6">
          <Alert tone="critical" title="Unable to load logs">
            {errorMsg}
          </Alert>
        </div>
      ) : (
        <Card className="mt-6">
          <Table>
            <THead>
              <Tr>
                <Th>Timestamp</Th>
                <Th>Account / User</Th>
                <Th>Action</Th>
                <Th>Details</Th>
              </Tr>
            </THead>
            <TBody>
              {logs.map((log: any) => (
                <Tr key={log.id}>
                  <Td className="text-ink-soft">{log.timestamp ? new Date(log.timestamp).toLocaleString() : "N/A"}</Td>
                  <Td>
                    <Badge tone="brand">{log.user}</Badge>
                  </Td>
                  <Td className="font-bold uppercase tracking-wide text-ink-soft">{log.action}</Td>
                  <Td className="text-ink">
                    {log.details}
                    {log.table_name && (
                      <span className="mt-1 block text-xs text-ink-soft">
                        Table: {log.table_name} (ID: {log.record_id || "N/A"})
                      </span>
                    )}
                  </Td>
                </Tr>
              ))}
              {logs.length === 0 && (
                <Tr>
                  <Td colSpan={4} className="text-center text-ink-soft">
                    No audit logs found in the system.
                  </Td>
                </Tr>
              )}
            </TBody>
          </Table>
        </Card>
      )}
    </div>
  );
}
