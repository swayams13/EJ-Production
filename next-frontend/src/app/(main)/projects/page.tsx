"use client";

import React, { useEffect, useState } from "react";

export default function ProjectsList() {
  const [projects, setProjects] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedId, setExpandedId] = useState<number | null>(null);

  useEffect(() => {
    fetch(`${process.env.NEXT_PUBLIC_API_URL || "https://ej-production-production.up.railway.app"}/api/projects`)
      .then((res) => res.json())
      .then((json) => {
        setProjects(json);
        setLoading(false);
      });
  }, []);

  if (loading) return <div className="text-slate-500">Loading projects...</div>;

  return (
    <div>
      <div className="flex justify-between items-center mb-8">
        <div>
          <h1 className="text-3xl font-bold text-slate-900 mb-2">Projects</h1>
          <p className="text-slate-500">Manage all active and completed projects.</p>
        </div>
      </div>

      <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
        <table className="min-w-full divide-y divide-slate-200">
          <thead className="bg-slate-50">
            <tr>
              <th className="px-6 py-3 text-left text-xs font-medium text-slate-500 uppercase tracking-wider">Project Code</th>
              <th className="px-6 py-3 text-left text-xs font-medium text-slate-500 uppercase tracking-wider">Target Date</th>
              <th className="px-6 py-3 text-left text-xs font-medium text-slate-500 uppercase tracking-wider">Assigned Resources</th>
              <th className="px-6 py-3 text-left text-xs font-medium text-slate-500 uppercase tracking-wider">Est. Days</th>
              <th className="px-6 py-3 text-left text-xs font-medium text-slate-500 uppercase tracking-wider">Status</th>
            </tr>
          </thead>
          <tbody className="bg-white divide-y divide-slate-200">
            {projects.map((p: any) => (
              <React.Fragment key={p.id}>
                <tr 
                  className="hover:bg-slate-50 transition-colors cursor-pointer"
                  onClick={() => setExpandedId(expandedId === p.id ? null : p.id)}
                >
                  <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-indigo-600">
                    <div className="flex items-center gap-2">
                      <svg className={`w-4 h-4 transition-transform ${expandedId === p.id ? 'rotate-90' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 5l7 7-7 7"></path></svg>
                      {p.quotation_no}
                    </div>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-slate-500">
                    {p.target_date ? new Date(p.target_date).toLocaleDateString() : 'N/A'}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-slate-500">
                    <div className="flex gap-2 text-xs font-medium">
                      <span className="bg-slate-100 px-2 py-1 rounded">TIG: {p.assigned_tig}</span>
                      <span className="bg-slate-100 px-2 py-1 rounded">MIG: {p.assigned_mig}</span>
                      <span className="bg-slate-100 px-2 py-1 rounded">Grind: {p.assigned_grinders}</span>
                    </div>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-slate-500">
                    {p.estimated_duration_days > 0 ? (
                      <span className="text-indigo-600 font-semibold">{p.estimated_duration_days} days</span>
                    ) : (
                      <span className="text-slate-400 italic">N/A</span>
                    )}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <span className={`px-2 inline-flex text-xs leading-5 font-semibold rounded-full ${
                      p.status === 'Completed' ? 'bg-green-100 text-green-800' : 'bg-blue-100 text-blue-800'
                    }`}>
                      {p.status || 'Active'}
                    </span>
                  </td>
                </tr>
                {expandedId === p.id && (
                  <tr className="bg-slate-50">
                    <td colSpan={5} className="px-12 py-4">
                      {p.bellows && p.bellows.length > 0 ? (
                        <table className="min-w-full divide-y divide-slate-200 bg-white border border-slate-200 rounded-lg overflow-hidden">
                          <thead className="bg-slate-100">
                            <tr>
                              <th className="px-4 py-2 text-left text-xs font-semibold text-slate-600">Size (NB)</th>
                              <th className="px-4 py-2 text-left text-xs font-semibold text-slate-600">Quantity</th>
                              <th className="px-4 py-2 text-left text-xs font-semibold text-slate-600">Total TIG (ft)</th>
                              <th className="px-4 py-2 text-left text-xs font-semibold text-slate-600">Total MIG (ft)</th>
                              <th className="px-4 py-2 text-left text-xs font-semibold text-slate-600">Grinding (ft)</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-slate-100">
                            {p.bellows.map((b: any, idx: number) => (
                              <tr key={idx}>
                                <td className="px-4 py-2 text-sm text-slate-900">{b.size}</td>
                                <td className="px-4 py-2 text-sm text-slate-600">{b.quantity}</td>
                                <td className="px-4 py-2 text-sm text-slate-600">{b.tig_feet}</td>
                                <td className="px-4 py-2 text-sm text-slate-600">{b.mig_feet}</td>
                                <td className="px-4 py-2 text-sm text-slate-600">{b.grinding_feet}</td>
                              </tr>
                            ))}
                            <tr className="bg-slate-50 font-semibold">
                              <td className="px-4 py-2 text-sm text-slate-900">Total</td>
                              <td className="px-4 py-2 text-sm text-slate-900">{p.bellows.reduce((sum: number, b: any) => sum + b.quantity, 0)}</td>
                              <td className="px-4 py-2 text-sm text-indigo-600">{p.bellows.reduce((sum: number, b: any) => sum + b.tig_feet, 0).toFixed(2)}</td>
                              <td className="px-4 py-2 text-sm text-indigo-600">{p.bellows.reduce((sum: number, b: any) => sum + b.mig_feet, 0).toFixed(2)}</td>
                              <td className="px-4 py-2 text-sm text-indigo-600">{p.bellows.reduce((sum: number, b: any) => sum + b.grinding_feet, 0).toFixed(2)}</td>
                            </tr>
                          </tbody>
                        </table>
                      ) : (
                        <p className="text-sm text-slate-500 italic">No expansion joints assigned to this project.</p>
                      )}
                    </td>
                  </tr>
                )}
              </React.Fragment>
            ))}
            {projects.length === 0 && (
              <tr>
                <td colSpan={5} className="px-6 py-8 text-center text-sm text-slate-500">
                  No projects found.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
