"use client";

import { useEffect, useState } from "react";
import apiFetch from "@/lib/api";

export default function HoldsDashboard() {
  const [holds, setHolds] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchHolds = () => {
    setLoading(true);
    apiFetch(`${process.env.NEXT_PUBLIC_API_URL || "http://localhost:4500"}/api/v1/projects/holds`)
      .then(res => res.json())
      .then(data => {
        setHolds(data.data || []);
        setLoading(false);
      })
      .catch(err => {
        console.error(err);
        setLoading(false);
      });
  };

  useEffect(() => {
    fetchHolds();
  }, []);

  const resumeProject = async (projectId: number) => {
    try {
      const res = await apiFetch(`${process.env.NEXT_PUBLIC_API_URL || "http://localhost:4500"}/api/v1/projects/${projectId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'Active' })
      });
      if (res.ok) {
        fetchHolds();
      }
    } catch (e) {
      console.error(e);
    }
  };

  return (
    <div className="p-8 max-w-7xl mx-auto space-y-8">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-black text-slate-900 tracking-tight">Hold Resolution Center</h1>
          <p className="text-slate-500 mt-1">Track and unblock projects that are currently on hold.</p>
        </div>
      </div>

      <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
        <div className="p-6 border-b border-slate-200">
          <h2 className="text-lg font-bold text-slate-800">Active Holds ({holds.length})</h2>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="bg-slate-50 border-b border-slate-200">
              <tr>
                <th className="px-6 py-4 text-left text-xs font-bold text-slate-500 uppercase tracking-wider">Project</th>
                <th className="px-6 py-4 text-left text-xs font-bold text-slate-500 uppercase tracking-wider">Reason</th>
                <th className="px-6 py-4 text-left text-xs font-bold text-slate-500 uppercase tracking-wider">Duration</th>
                <th className="px-6 py-4 text-left text-xs font-bold text-slate-500 uppercase tracking-wider">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {loading ? (
                <tr>
                  <td colSpan={4} className="px-6 py-8 text-center text-slate-500">Loading holds...</td>
                </tr>
              ) : holds.length === 0 ? (
                <tr>
                  <td colSpan={4} className="px-6 py-8 text-center text-slate-500">
                    <div className="text-4xl mb-4">🎉</div>
                    <div className="font-bold text-slate-700">No active holds!</div>
                    <div className="text-sm">All projects are progressing normally.</div>
                  </td>
                </tr>
              ) : (
                holds.map(h => (
                  <tr key={h.id} className="hover:bg-slate-50">
                    <td className="px-6 py-4">
                      <div className="font-bold text-slate-900">{h.quotation_no}</div>
                      <div className="text-xs text-slate-500">{h.project_name}</div>
                    </td>
                    <td className="px-6 py-4">
                      <div className="font-semibold text-slate-800">{h.hold_type}</div>
                      <div className="text-xs text-slate-500 mt-1 max-w-xs truncate">{h.comments || "No comments"}</div>
                    </td>
                    <td className="px-6 py-4">
                      <span className={`px-3 py-1 rounded-full text-xs font-bold ${
                        h.days_on_hold > 7 ? 'bg-red-100 text-red-700' : 'bg-orange-100 text-orange-700'
                      }`}>
                        {h.days_on_hold} {h.days_on_hold === 1 ? 'Day' : 'Days'}
                      </span>
                    </td>
                    <td className="px-6 py-4">
                      <button 
                        onClick={() => resumeProject(h.project_id)}
                        className="px-4 py-2 bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 font-semibold text-sm transition-colors"
                      >
                        Resume Production
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
