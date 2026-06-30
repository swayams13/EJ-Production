"use client";
import { apiFetch } from "@/lib/api";

import { useEffect, useState } from "react";

export default function Dashboard() {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchDashboard = () => {
      apiFetch(`${process.env.NEXT_PUBLIC_API_URL || "http://localhost:8003"}/api/v1/dashboard/status`)
        .then((res) => res.json())
        .then((resData) => {
          setData(resData.data);
          setLoading(false);
        });
    };
    
    fetchDashboard();
    const interval = setInterval(fetchDashboard, 3000); // Live refresh every 3s
    
    return () => clearInterval(interval);
  }, []);

  const handleDownloadExcel = () => {
    window.location.href = `${process.env.NEXT_PUBLIC_API_URL || "http://localhost:8003"}/api/v1/dashboard/export`;
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
      
      <div className="mb-6 grid grid-cols-1 md:grid-cols-3 gap-6">
        <MetricCard title="Active Projects" value={data.active_projects} />
        <MetricCard title="Projects on Hold" value={data.hold_projects || 0} />
        <MetricCard title="Completed Projects" value={data.completed_projects || 0} />
      </div>

      <div className="mb-8">
        <h2 className="text-xl font-semibold text-slate-800 mb-4">Pending Workload (Active Projects)</h2>
        <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
          <MetricCard title="Pending TIG (ft)" value={Math.round(data.pending_tig * 10) / 10} />
          <MetricCard title="Pending DJ (ft)" value={Math.round((data.pending_dj || 0) * 10) / 10} />
          <MetricCard title="Pending MIG (ft)" value={Math.round(data.pending_mig * 10) / 10} />
          <MetricCard title="Pending Grinding (sq ft)" value={Math.round(data.pending_grind * 10) / 10} />
        </div>
      </div>

      {(data.hold_tig > 0 || data.hold_mig > 0 || data.hold_grind > 0 || data.hold_dj > 0) && (
        <div className="mb-8">
          <div className="bg-rose-50 border border-rose-200 rounded-xl p-6 shadow-sm">
            <h3 className="text-sm font-semibold text-rose-600 mb-3 uppercase tracking-wide">On Hold Work (Excluded from Pending)</h3>
            <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
              <MetricCard title="Hold TIG (ft)" value={Math.round(data.hold_tig * 10) / 10} />
              <MetricCard title="Hold DJ (ft)" value={Math.round((data.hold_dj || 0) * 10) / 10} />
              <MetricCard title="Hold MIG (ft)" value={Math.round(data.hold_mig * 10) / 10} />
              <MetricCard title="Hold Grinding (sq ft)" value={Math.round(data.hold_grind * 10) / 10} />
            </div>
          </div>
        </div>
      )}

      {((data.plan_tig && data.plan_tig > 0) || (data.plan_mig && data.plan_mig > 0) || (data.plan_grind && data.plan_grind > 0) || (data.plan_dj && data.plan_dj > 0)) && (
        <div className="mb-8">
          <div className="bg-sky-50 border border-sky-200 rounded-xl p-6 shadow-sm">
            <h3 className="text-sm font-semibold text-sky-600 mb-3 uppercase tracking-wide">Planning Pending Feet (Excluded from Pending)</h3>
            <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
              <MetricCard title="Planning TIG (ft)" value={Math.round((data.plan_tig || 0) * 10) / 10} />
              <MetricCard title="Planning DJ (ft)" value={Math.round((data.plan_dj || 0) * 10) / 10} />
              <MetricCard title="Planning MIG (ft)" value={Math.round((data.plan_mig || 0) * 10) / 10} />
              <MetricCard title="Planning Grinding (sq ft)" value={Math.round((data.plan_grind || 0) * 10) / 10} />
            </div>
          </div>
        </div>
      )}

      {data.overtime && (
        <div className="mb-12">
          <div className="bg-amber-50 border border-amber-200 rounded-xl p-6 shadow-sm">
            <h3 className="text-sm font-semibold text-amber-600 mb-3 uppercase tracking-wide">Overtime Predictions (Required Hours)</h3>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              <div className="bg-white p-4 rounded-lg shadow-sm border border-slate-100 flex justify-between items-center">
                <div>
                  <h4 className="text-slate-500 text-sm font-medium">TIG Overtime</h4>
                  <div className="text-2xl font-bold text-amber-600">{Math.round(data.overtime.total_ot_tig * 10) / 10} hrs</div>
                </div>
                <div className="text-right">
                  <h4 className="text-slate-400 text-xs font-medium uppercase">Per Welder</h4>
                  <div className="text-lg font-semibold text-slate-700">{Math.round(data.overtime.ot_per_tig * 10) / 10} hrs</div>
                </div>
              </div>
              <div className="bg-white p-4 rounded-lg shadow-sm border border-slate-100 flex justify-between items-center">
                <div>
                  <h4 className="text-slate-500 text-sm font-medium">MIG Overtime</h4>
                  <div className="text-2xl font-bold text-amber-600">{Math.round(data.overtime.total_ot_mig * 10) / 10} hrs</div>
                </div>
                <div className="text-right">
                  <h4 className="text-slate-400 text-xs font-medium uppercase">Per Welder</h4>
                  <div className="text-lg font-semibold text-slate-700">{Math.round(data.overtime.ot_per_mig * 10) / 10} hrs</div>
                </div>
              </div>
              <div className="bg-white p-4 rounded-lg shadow-sm border border-slate-100 flex justify-between items-center">
                <div>
                  <h4 className="text-slate-500 text-sm font-medium">Grinding Overtime</h4>
                  <div className="text-2xl font-bold text-amber-600">{Math.round(data.overtime.total_ot_grind * 10) / 10} hrs</div>
                </div>
                <div className="text-right">
                  <h4 className="text-slate-400 text-xs font-medium uppercase">Per Grinder</h4>
                  <div className="text-lg font-semibold text-slate-700">{Math.round(data.overtime.ot_per_grind * 10) / 10} hrs</div>
                </div>
              </div>
            </div>
            <p className="text-xs text-amber-600 mt-3">* Predictions assume a standard 8-hour shift based on your master productivity targets.</p>
          </div>
        </div>
      )}

      <h2 className="text-xl font-semibold text-slate-800 mb-4">Company Manpower Requirements</h2>
      <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
        <table className="min-w-full divide-y divide-slate-200">
          <thead className="bg-slate-50">
            <tr>
              <th className="px-6 py-3 text-left text-xs font-medium text-slate-500 uppercase tracking-wider">Metric</th>
              <th className="px-6 py-3 text-left text-xs font-medium text-slate-500 uppercase tracking-wider">TIG Welders</th>
              <th className="px-6 py-3 text-left text-xs font-medium text-slate-500 uppercase tracking-wider">MIG & DJ Welders</th>
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

      <h2 className="text-xl font-semibold text-slate-800 mt-12 mb-4">Month-wise Pending Work & Requirements</h2>
      <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden mb-8">
        <table className="min-w-full divide-y divide-slate-200">
          <thead className="bg-slate-50">
            <tr>
              <th className="px-6 py-3 text-left text-xs font-medium text-slate-500 uppercase tracking-wider">Month</th>
              <th className="px-4 py-3 text-left text-xs font-medium text-slate-500 uppercase">TIG (ft)</th>
              <th className="px-4 py-3 text-left text-xs font-medium text-slate-500 uppercase">DJ (ft)</th>
              <th className="px-4 py-3 text-left text-xs font-medium text-slate-500 uppercase">MIG (ft)</th>
              <th className="px-6 py-3 text-left text-xs font-medium text-slate-500 uppercase tracking-wider">Grind (ft)</th>
              <th className="px-6 py-3 text-left text-xs font-medium text-slate-500 uppercase tracking-wider">Req. TIG</th>
              <th className="px-6 py-3 text-left text-xs font-medium text-slate-500 uppercase tracking-wider">Req. MIG/DJ</th>
              <th className="px-6 py-3 text-left text-xs font-medium text-slate-500 uppercase tracking-wider">Req. Grind</th>
            </tr>
          </thead>
          <tbody className="bg-white divide-y divide-slate-200">
            {data.months_breakdown && Object.entries(data.months_breakdown).map(([month, details]: [string, any]) => (
              <tr key={month} className="hover:bg-slate-50 transition-colors">
                <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-slate-900">{month}</td>
                <td className="px-4 py-3 text-sm text-slate-900">{Math.round(details.tig_feet * 10) / 10}</td>
                <td className="px-4 py-3 text-sm text-slate-900">{Math.round((details.dj_feet || 0) * 10) / 10}</td>
                <td className="px-4 py-3 text-sm text-slate-900">{Math.round(details.mig_feet * 10) / 10}</td>
                <td className="px-6 py-4 whitespace-nowrap text-sm text-slate-500">{Math.round(details.grind_feet * 10) / 10}</td>
                <td className="px-6 py-4 whitespace-nowrap text-sm text-slate-500">{details.req_tig}</td>
                <td className="px-6 py-4 whitespace-nowrap text-sm text-slate-500">{details.req_mig}</td>
                <td className="px-6 py-4 whitespace-nowrap text-sm text-slate-500">{details.req_grind}</td>
              </tr>
            ))}
            {(!data.months_breakdown || Object.keys(data.months_breakdown).length === 0) && (
              <tr>
                <td colSpan={7} className="px-6 py-4 text-center text-sm text-slate-500">No data available</td>
              </tr>
            )}
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
