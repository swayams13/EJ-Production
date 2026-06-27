"use client";
import { apiFetch } from "@/lib/api";

import { useEffect, useState } from "react";
import Link from "next/link";

export default function PlanningDashboard() {
  const [projects, setProjects] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [metrics, setMetrics] = useState({ 
    weekly_target: 0, 
    current_load: 0, 
    on_time_delivery: 100, 
    weekly_forecast: [], 
    monthly_forecast: [], 
    unscheduled_demand: 0,
    factory_weekly_capacity: 0 
  });

  useEffect(() => {
    const fetchPlanning = () => {
      Promise.all([
        apiFetch(`${process.env.NEXT_PUBLIC_API_URL || "http://localhost:4500"}/api/v1/projects`).then(res => res.json()),
        apiFetch(`${process.env.NEXT_PUBLIC_API_URL || "http://localhost:4500"}/api/v1/dashboard/planning`).then(res => res.json())
      ])
      .then(([projectsRes, metricsData]) => {
        setProjects(projectsRes.data || []);
        setMetrics(metricsData.data);
        setLoading(false);
      })
      .catch(err => {
        console.error(err);
        setLoading(false);
      });
    };

    fetchPlanning();
    const interval = setInterval(fetchPlanning, 3000);
    return () => clearInterval(interval);
  }, []);

  return (
    <div>
      <div className="bg-slate-900 p-8 text-white rounded-b-3xl shadow-lg mb-8 mx-[-2rem] mt-[-2rem]">
        <h1 className="text-3xl font-extrabold tracking-tight text-white mb-2">Production Planning</h1>
        <p className="text-slate-300 text-lg font-medium">Master schedule and active project prioritization.</p>
      </div>

      <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-8 mb-8">
        <div className="flex justify-between items-center mb-6">
          <h2 className="text-xl font-bold text-slate-800">Capacity Overview</h2>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <div className="p-4 border border-blue-100 bg-blue-50 rounded-xl">
            <h3 className="text-sm font-bold text-blue-700 uppercase tracking-wider mb-1">Weekly Target</h3>
            <p className="text-3xl font-black text-blue-900">{metrics.weekly_target} <span className="text-lg font-medium text-blue-600">Units</span></p>
          </div>
          <div className="p-4 border border-amber-100 bg-amber-50 rounded-xl">
            <h3 className="text-sm font-bold text-amber-700 uppercase tracking-wider mb-1">Current Load</h3>
            <p className="text-3xl font-black text-amber-900">{metrics.current_load} <span className="text-lg font-medium text-amber-600">%</span></p>
          </div>
          <div className="p-4 border border-emerald-100 bg-emerald-50 rounded-xl">
            <h3 className="text-sm font-bold text-emerald-700 uppercase tracking-wider mb-1">On-Time Delivery</h3>
            <p className="text-3xl font-black text-emerald-900">{metrics.on_time_delivery} <span className="text-lg font-medium text-emerald-600">%</span></p>
          </div>
        </div>
      </div>

      
      <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-8 mb-8">
        <h2 className="text-xl font-bold text-slate-800 mb-6">4-Week Capacity Forecast</h2>
        <div className="space-y-6">
          {metrics.weekly_forecast && metrics.weekly_forecast.map((week: any) => {
            const loadPct = week.capacity > 0 ? (week.demand / week.capacity) * 100 : 0;
            const isOverCapacity = loadPct > 100;
            return (
              <div key={week.id} className="relative">
                <div className="flex justify-between items-end mb-2">
                  <span className="font-bold text-slate-700">{week.name}</span>
                  <div className="text-sm font-medium">
                    <span className={isOverCapacity ? "text-red-600" : "text-slate-600"}>{week.demand} ft Demand</span>
                    <span className="text-slate-400 mx-2">/</span>
                    <span className="text-slate-500">{week.capacity} ft Capacity</span>
                  </div>
                </div>
                <div className="w-full bg-slate-100 rounded-full h-3">
                  <div 
                    className={`h-3 rounded-full ${isOverCapacity ? 'bg-red-500' : 'bg-emerald-500'}`} 
                    style={{ width: `${Math.min(loadPct, 100)}%` }}
                  ></div>
                </div>
                {isOverCapacity && (
                  <div className="mt-1 text-xs font-semibold text-red-500 text-right">
                    Over capacity by {Math.round(week.demand - week.capacity)} ft (Requires Overtime or Shift Extension)
                  </div>
                )}
              </div>
            );
          })}
        </div>
        
        {metrics.unscheduled_demand > 0 && (
          <div className="mt-6 p-4 bg-orange-50 border border-orange-100 rounded-xl">
             <h3 className="text-sm font-bold text-orange-800 mb-1">Unscheduled Backlog</h3>
             <p className="text-sm text-orange-700">There is currently <strong>{metrics.unscheduled_demand} ft</strong> of required work from projects that do not have a Target Date set. Assign deadlines to them to factor them into the capacity forecast.</p>
          </div>
        )}
      </div>
<div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
        <div className="p-6 border-b border-slate-100 flex justify-between items-center bg-slate-50">
          <h2 className="text-lg font-bold text-slate-800">Master Schedule</h2>
          <Link href="/projects/add" className="text-sm font-bold text-blue-600 hover:text-blue-800 uppercase tracking-wider">
            + Schedule New Project
          </Link>
        </div>
        
        {loading ? (
          <div className="flex justify-center py-10">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
          </div>
        ) : (
          <table className="min-w-full divide-y divide-slate-200">
            <thead className="bg-white">
              <tr>
                <th className="px-6 py-4 text-left text-xs font-bold text-slate-500 uppercase tracking-wider">Project</th>
                <th className="px-6 py-4 text-left text-xs font-bold text-slate-500 uppercase tracking-wider">Customer</th>
                <th className="px-6 py-4 text-left text-xs font-bold text-slate-500 uppercase tracking-wider">Deadline</th>
                <th className="px-6 py-4 text-left text-xs font-bold text-slate-500 uppercase tracking-wider">Priority</th>
                <th className="px-6 py-4 text-left text-xs font-bold text-slate-500 uppercase tracking-wider">Status</th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-slate-100">
              {projects.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-6 py-8 text-center text-slate-500">No scheduled projects.</td>
                </tr>
              ) : (
                projects.map((p) => (
                  <tr key={p.id} className="hover:bg-slate-50 transition-colors">
                    <td className="px-6 py-4 whitespace-nowrap font-semibold text-slate-900">{p.project_number}</td>
                    <td className="px-6 py-4 whitespace-nowrap text-slate-600">{p.customer_name || "Internal"}</td>
                    <td className="px-6 py-4 whitespace-nowrap text-slate-800 font-medium">{p.target_date ? new Date(p.target_date).toLocaleDateString() : <span className="text-orange-500 text-xs">Unscheduled</span>}</td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <span className={`px-2 py-1 rounded text-xs font-bold ${
                        p.priority === 'P1' ? 'bg-red-100 text-red-700' : p.priority === 'P2' ? 'bg-orange-100 text-orange-700' : 'bg-emerald-100 text-emerald-700'
                      }`}>
                        {p.priority}
                      </span>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-slate-600 font-medium">{p.status}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
