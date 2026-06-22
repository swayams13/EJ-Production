"use client";

import { useEffect, useState } from "react";

export default function Dashboard() {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch(`${process.env.NEXT_PUBLIC_API_URL || "https://ej-production-production.up.railway.app"}/api/dashboard/status`)
      .then((res) => res.json())
      .then((json) => {
        setData(json);
        setLoading(false);
      });
  }, []);

  const handleDownloadExcel = () => {
    window.location.href = `${process.env.NEXT_PUBLIC_API_URL || "https://ej-production-production.up.railway.app"}/api/dashboard/export`;
  };

  if (loading) return <div className="text-slate-500">Loading dashboard...</div>;

  return (
    <div>
      <div className="flex justify-between items-center mb-8">
        <div>
          <h1 className="text-3xl font-bold text-slate-900 mb-2">Progress Dashboard</h1>
          <p className="text-slate-500">Live view of active capacity, manpower requirements, and shortages.</p>
        </div>
        <button
          onClick={handleDownloadExcel}
          className="bg-emerald-600 hover:bg-emerald-700 text-white px-4 py-2 rounded-lg font-medium shadow-sm transition-colors flex items-center gap-2"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"></path>
          </svg>
          Download Master Production Register (Excel)
        </button>
      </div>
      
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 mb-8">
        <MetricCard title="Active Projects" value={data.active_projects} />
        <MetricCard title="Pending TIG (ft)" value={Math.round(data.pending_tig * 10) / 10} />
        <MetricCard title="Pending MIG (ft)" value={Math.round(data.pending_mig * 10) / 10} />
        <MetricCard title="Pending Grinding (ft)" value={Math.round(data.pending_grind * 10) / 10} />
      </div>

      <h2 className="text-xl font-semibold text-slate-800 mb-4">Company Manpower Requirements</h2>
      <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
        <table className="min-w-full divide-y divide-slate-200">
          <thead className="bg-slate-50">
            <tr>
              <th className="px-6 py-3 text-left text-xs font-medium text-slate-500 uppercase tracking-wider">Metric</th>
              <th className="px-6 py-3 text-left text-xs font-medium text-slate-500 uppercase tracking-wider">TIG Welders</th>
              <th className="px-6 py-3 text-left text-xs font-medium text-slate-500 uppercase tracking-wider">MIG Welders</th>
              <th className="px-6 py-3 text-left text-xs font-medium text-slate-500 uppercase tracking-wider">Grinders</th>
            </tr>
          </thead>
          <tbody className="bg-white divide-y divide-slate-200">
            <tr>
              <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-slate-900">Current Workforce</td>
              <td className="px-6 py-4 whitespace-nowrap text-sm text-slate-500">{data.pool?.tig || 0}</td>
              <td className="px-6 py-4 whitespace-nowrap text-sm text-slate-500">{data.pool?.mig || 0}</td>
              <td className="px-6 py-4 whitespace-nowrap text-sm text-slate-500">{data.pool?.grinders || 0}</td>
            </tr>
            <tr>
              <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-slate-900">Required (Active Projects)</td>
              <td className="px-6 py-4 whitespace-nowrap text-sm text-slate-500">{data.required?.tig || 0}</td>
              <td className="px-6 py-4 whitespace-nowrap text-sm text-slate-500">{data.required?.mig || 0}</td>
              <td className="px-6 py-4 whitespace-nowrap text-sm text-slate-500">{data.required?.grinders || 0}</td>
            </tr>
            <tr className="bg-slate-50">
              <td className="px-6 py-4 whitespace-nowrap text-sm font-bold text-slate-900">Deficit / Surplus</td>
              <td className={`px-6 py-4 whitespace-nowrap text-sm font-bold ${((data.pool?.tig || 0) - (data.required?.tig || 0)) < 0 ? 'text-red-600' : 'text-emerald-600'}`}>
                {((data.pool?.tig || 0) - (data.required?.tig || 0)) > 0 ? '+' : ''}{(data.pool?.tig || 0) - (data.required?.tig || 0)}
              </td>
              <td className={`px-6 py-4 whitespace-nowrap text-sm font-bold ${((data.pool?.mig || 0) - (data.required?.mig || 0)) < 0 ? 'text-red-600' : 'text-emerald-600'}`}>
                {((data.pool?.mig || 0) - (data.required?.mig || 0)) > 0 ? '+' : ''}{(data.pool?.mig || 0) - (data.required?.mig || 0)}
              </td>
              <td className={`px-6 py-4 whitespace-nowrap text-sm font-bold ${((data.pool?.grinders || 0) - (data.required?.grinders || 0)) < 0 ? 'text-red-600' : 'text-emerald-600'}`}>
                {((data.pool?.grinders || 0) - (data.required?.grinders || 0)) > 0 ? '+' : ''}{(data.pool?.grinders || 0) - (data.required?.grinders || 0)}
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}

function MetricCard({ title, value }: { title: string; value: number | string }) {
  return (
    <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6 flex flex-col hover:shadow-md transition-shadow">
      <span className="text-sm font-medium text-slate-500 mb-2 uppercase tracking-wide">{title}</span>
      <span className="text-3xl font-bold text-slate-900">{value}</span>
    </div>
  );
}
