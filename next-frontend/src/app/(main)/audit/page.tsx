"use client";
import { apiFetch } from "@/lib/api";
import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";

export default function AuditLogsPage() {
  const [logs, setLogs] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState("");
  const router = useRouter();

  useEffect(() => {
    // Basic frontend check for role, though backend enforces it.
    const role = localStorage.getItem("user_role") || localStorage.getItem("role");
    
    apiFetch(`${process.env.NEXT_PUBLIC_API_URL || "http://localhost:8003"}/api/v1/audit`)
      .then(async res => {
        if (!res.ok) {
          const data = await res.json();
          throw new Error(data.detail || "Failed to fetch logs. You might not have the correct permissions.");
        }
        return res.json();
      })
      .then(resData => {
        setLogs(resData.data || []);
      })
      .catch(err => setErrorMsg(err.message))
      .finally(() => setLoading(false));
  }, []);

  const handleDownloadExcel = () => {
    window.location.href = `${process.env.NEXT_PUBLIC_API_URL || "http://localhost:8003"}/api/v1/audit/excel`;
  };

  if (loading) return <div className="p-8 text-slate-500">Loading Audit Logs...</div>;
  if (errorMsg) return <div className="p-8 text-rose-500 font-bold text-xl">{errorMsg}</div>;

  return (
    <div className="max-w-7xl mx-auto mb-20">
      <div className="bg-slate-900 p-8 text-white rounded-b-3xl shadow-lg mb-8 mx-[-2rem] mt-[-2rem] flex justify-between items-center">
        <div>
          <h1 className="text-3xl font-extrabold text-white tracking-tight mb-2">System Audit Logs</h1>
          <p className="text-slate-300 text-lg font-medium">Tracking logins, data entry, and sensitive system changes.</p>
        </div>
        <button
          onClick={handleDownloadExcel}
          className="bg-emerald-600 hover:bg-emerald-700 text-white px-4 py-2 rounded-lg font-medium shadow-sm transition-colors flex items-center gap-2"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"></path>
          </svg>
          Download Logs (CSV/Excel)
        </button>
      </div>

      <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
        <table className="min-w-full divide-y divide-slate-200">
          <thead className="bg-slate-50">
            <tr>
              <th className="px-6 py-3 text-left text-xs font-medium text-slate-500 uppercase tracking-wider">Timestamp</th>
              <th className="px-6 py-3 text-left text-xs font-medium text-slate-500 uppercase tracking-wider">Account / User</th>
              <th className="px-6 py-3 text-left text-xs font-medium text-slate-500 uppercase tracking-wider">Action</th>
              <th className="px-6 py-3 text-left text-xs font-medium text-slate-500 uppercase tracking-wider">Details</th>
            </tr>
          </thead>
          <tbody className="bg-white divide-y divide-slate-200">
            {logs.map((log: any) => (
              <tr key={log.id} className="hover:bg-slate-50 transition-colors">
                <td className="px-6 py-4 whitespace-nowrap text-sm text-slate-500">
                  {log.timestamp ? new Date(log.timestamp).toLocaleString() : 'N/A'}
                </td>
                <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-slate-900">
                  <div className="flex items-center gap-2">
                    <span className="bg-blue-100 text-blue-800 text-xs px-2 py-0.5 rounded-full font-bold">{log.user}</span>
                  </div>
                </td>
                <td className="px-6 py-4 whitespace-nowrap text-sm text-slate-500 font-bold uppercase tracking-wide">
                  {log.action}
                </td>
                <td className="px-6 py-4 text-sm text-slate-700">
                  {log.details}
                  {log.table_name && <span className="block text-xs text-slate-400 mt-1">Table: {log.table_name} (ID: {log.record_id || 'N/A'})</span>}
                </td>
              </tr>
            ))}
            {logs.length === 0 && (
              <tr>
                <td colSpan={4} className="px-6 py-12 text-center text-slate-500">
                  No audit logs found in the system.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
