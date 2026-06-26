"use client";
import { apiFetch } from "@/lib/api";

import { useState, useEffect } from "react";

export default function MDDashboard() {
  const [kpis, setKpis] = useState<any[]>([]);
  const [departments, setDepartments] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchExecutive = () => {
      apiFetch(`${process.env.NEXT_PUBLIC_API_URL || "http://localhost:8003"}/api/v1/dashboard/executive`)
        .then(res => res.json())
        .then(resData => {
          const data = resData.data;
          setKpis(data.kpis);
          setDepartments(data.departments || []);
          setLoading(false);
        })
        .catch(err => console.error(err));
    };
    
    fetchExecutive();
    const interval = setInterval(fetchExecutive, 3000);
    return () => clearInterval(interval);
  }, []);

  return (
    <div>
      <div className="bg-slate-900 p-8 text-white rounded-b-3xl shadow-lg mb-8 mx-[-2rem] mt-[-2rem]">
        <h1 className="text-3xl font-extrabold tracking-tight text-white mb-2">Executive Dashboard</h1>
        <p className="text-slate-300 text-lg font-medium">High-level KPIs and business metrics across all operations.</p>
      </div>

      {/* KPI Cards */}
      {loading ? (
        <div className="flex justify-center py-10">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
          {kpis.map((kpi) => (
            <div key={kpi.label} className="bg-white rounded-2xl p-6 shadow-sm border border-slate-200 hover:shadow-md transition-shadow relative overflow-hidden group">
              <div className={`absolute right-0 top-0 w-24 h-24 bg-${kpi.color}-500 opacity-5 rounded-bl-full -mr-4 -mt-4 transition-transform group-hover:scale-110`}></div>
              <p className="text-sm font-bold text-slate-500 uppercase tracking-wider mb-2">{kpi.label}</p>
              <h3 className={`text-4xl font-black text-${kpi.color}-600 mb-2`}>{kpi.value}</h3>
              <p className="text-xs font-semibold text-slate-400">{kpi.trend}</p>
            </div>
          ))}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        {/* Production Load */}
        <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-6">
          <div className="flex justify-between items-center mb-6">
            <h2 className="text-lg font-bold text-slate-800 uppercase tracking-wide">Department Load</h2>
            <button className="text-xs font-bold text-blue-600 uppercase tracking-wider hover:underline">View All</button>
          </div>
          <div className="space-y-5">
            {departments.map((dept) => (
              <div key={dept.name}>
                <div className="flex justify-between text-sm font-semibold mb-1">
                  <span className="text-slate-700">{dept.name}</span>
                  <span className={`text-${dept.color}-600`}>{dept.load}%</span>
                </div>
                <div className="w-full bg-slate-100 rounded-full h-2">
                  <div className={`bg-${dept.color}-500 h-2 rounded-full transition-all duration-1000`} style={{ width: `${dept.load}%` }}></div>
                </div>
              </div>
            ))}
            {departments.length === 0 && (
              <div className="text-sm text-slate-500">No active production data.</div>
            )}
          </div>
        </div>

        {/* Critical Alerts */}
        <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-6">
          <div className="flex justify-between items-center mb-6">
            <h2 className="text-lg font-bold text-slate-800 uppercase tracking-wide">Critical Alerts</h2>
            <span className="bg-rose-100 text-rose-700 text-xs font-bold px-2 py-1 rounded-md">1 Active</span>
          </div>
          <div className="space-y-4">
            <div className="flex items-start gap-4 p-4 rounded-xl border border-rose-100 bg-rose-50/50">
              <div className="w-2 h-2 mt-2 rounded-full bg-rose-500 shrink-0"></div>
              <div>
                <h4 className="text-sm font-bold text-slate-800">System Live</h4>
                <p className="text-xs text-slate-500 mt-1">The MES is now receiving live data. Alerts will populate based on live inspection failures or material shortages.</p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
