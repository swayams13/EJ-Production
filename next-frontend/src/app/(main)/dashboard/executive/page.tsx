"use client";

import { useEffect, useState } from "react";

export default function ExecutiveDashboard() {
  const [projects, setProjects] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("http://localhost:4500/api/projects")
      .then((res) => res.json())
      .then((json) => {
        setProjects(json);
        setLoading(false);
      });
  }, []);

  if (loading) return <div className="text-slate-500">Loading executive overview...</div>;

  const activeProjects = projects.filter(p => p.status !== 'Completed');
  const completedProjects = projects.filter(p => p.status === 'Completed');
  
  const overdueProjects = activeProjects.filter(p => {
    if (!p.target_date) return false;
    return new Date(p.target_date) < new Date();
  });

  return (
    <div>
      <h1 className="text-3xl font-bold text-slate-900 mb-2">Executive Capacity Dashboard</h1>
      <p className="text-slate-500 mb-8">High-level overview of timeline adherence and completion status.</p>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
        <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6 flex flex-col border-l-4 border-l-indigo-500">
          <span className="text-sm font-medium text-slate-500 mb-2 uppercase">Active Projects</span>
          <span className="text-3xl font-bold text-slate-900">{activeProjects.length}</span>
        </div>
        <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6 flex flex-col border-l-4 border-l-emerald-500">
          <span className="text-sm font-medium text-slate-500 mb-2 uppercase">Completed Projects</span>
          <span className="text-3xl font-bold text-slate-900">{completedProjects.length}</span>
        </div>
        <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6 flex flex-col border-l-4 border-l-red-500">
          <span className="text-sm font-medium text-slate-500 mb-2 uppercase">Overdue Projects</span>
          <span className="text-3xl font-bold text-slate-900">{overdueProjects.length}</span>
        </div>
      </div>

      <h2 className="text-xl font-semibold text-slate-800 mb-4">Project Status Breakdown</h2>
      <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
        <table className="min-w-full divide-y divide-slate-200">
          <thead className="bg-slate-50">
            <tr>
              <th className="px-6 py-3 text-left text-xs font-medium text-slate-500 uppercase tracking-wider">Project Code</th>
              <th className="px-6 py-3 text-left text-xs font-medium text-slate-500 uppercase tracking-wider">Status</th>
              <th className="px-6 py-3 text-left text-xs font-medium text-slate-500 uppercase tracking-wider">Target Date</th>
            </tr>
          </thead>
          <tbody className="bg-white divide-y divide-slate-200">
            {projects.map((p: any) => {
              const isOverdue = p.status !== 'Completed' && p.target_date && new Date(p.target_date) < new Date();
              return (
                <tr key={p.id} className="hover:bg-slate-50 transition-colors">
                  <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-slate-900">{p.quotation_no}</td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    {p.status === 'Completed' ? (
                      <span className="px-2 inline-flex text-xs leading-5 font-semibold rounded-full bg-green-100 text-green-800">Completed</span>
                    ) : isOverdue ? (
                      <span className="px-2 inline-flex text-xs leading-5 font-semibold rounded-full bg-red-100 text-red-800">Overdue</span>
                    ) : (
                      <span className="px-2 inline-flex text-xs leading-5 font-semibold rounded-full bg-blue-100 text-blue-800">Active</span>
                    )}
                  </td>
                  <td className={`px-6 py-4 whitespace-nowrap text-sm font-medium ${isOverdue ? 'text-red-600' : 'text-slate-500'}`}>
                    {p.target_date ? new Date(p.target_date).toLocaleDateString() : 'N/A'}
                  </td>
                </tr>
              );
            })}
            {projects.length === 0 && (
              <tr>
                <td colSpan={3} className="px-6 py-8 text-center text-sm text-slate-500">
                  No projects available.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
