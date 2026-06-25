"use client";
import { fetchWithAuth } from "@/lib/api";

import { useState, useEffect } from "react";

export default function VisualTracking() {
  const [projects, setProjects] = useState<any[]>([]);
  const [projectId, setProjectId] = useState("");
  
  const [requirements, setRequirements] = useState<any[]>([]);
  const [requirementId, setRequirementId] = useState("");
  
  const [progressData, setProgressData] = useState<any>(null);
  const [loading, setLoading] = useState(false);

  // Initial load
  useEffect(() => {
    fetchWithAuth(`${process.env.NEXT_PUBLIC_API_URL || "http://localhost:8003"}/api/projects`)
      .then(res => res.json())
      .then(data => setProjects(data));
  }, []);

  // When project changes, fetch requirements
  useEffect(() => {
    if (!projectId) {
      setRequirements([]);
      setRequirementId("");
      return;
    }
    fetchWithAuth(`${process.env.NEXT_PUBLIC_API_URL || "http://localhost:8003"}/api/projects/${projectId}/requirements`)
      .then(res => res.json())
      .then(data => setRequirements(data));
  }, [projectId]);

  // When requirement changes, fetch progress
  useEffect(() => {
    if (!requirementId) {
      setProgressData(null);
      return;
    }
    setLoading(true);
    fetchWithAuth(`${process.env.NEXT_PUBLIC_API_URL || "http://localhost:8003"}/api/requirements/${requirementId}/parts`)
      .then(res => res.json())
      .then(data => {
        setProgressData(data);
        setLoading(false);
      });
  }, [requirementId]);

  return (
    <div className="max-w-7xl mx-auto mb-20 px-4">
      <div className="bg-slate-900 p-8 text-white rounded-b-3xl shadow-lg mb-8 mx-[-2rem] mt-[-2rem]">
        <h1 className="text-4xl font-extrabold text-white mb-2 tracking-tight">Visual Tracking</h1>
        <p className="text-slate-300 text-lg font-medium">Live Stage-by-Stage Progression for Requirements</p>
      </div>

      <div className="flex flex-col md:flex-row gap-4 mb-8 bg-white p-6 rounded-2xl shadow-sm border border-slate-200">
        <div className="flex-1">
          <label className="block text-xs font-bold text-slate-500 uppercase tracking-wide mb-1">Select Project</label>
          <select 
            className="w-full bg-slate-50 border border-slate-300 rounded-lg px-4 py-3 text-slate-800 font-bold shadow-sm focus:ring-2 focus:ring-blue-500"
            value={projectId} onChange={(e) => setProjectId(e.target.value)}
          >
            <option value="">-- Choose Project --</option>
            {projects.map(p => <option key={p.id} value={p.id}>{p.project_code} ({p.customer_name})</option>)}
          </select>
        </div>
        
        <div className="flex-1">
          <label className="block text-xs font-bold text-slate-500 uppercase tracking-wide mb-1">Select Requirement</label>
          <select 
            className="w-full bg-slate-50 border border-slate-300 rounded-lg px-4 py-3 text-slate-800 font-bold shadow-sm disabled:bg-slate-100 disabled:opacity-50 focus:ring-2 focus:ring-blue-500"
            value={requirementId} onChange={(e) => setRequirementId(e.target.value)}
            disabled={!projectId}
          >
            <option value="">-- Choose Requirement --</option>
            {requirements.map(r => <option key={r.id} value={r.id}>{r.type} - {r.size} (Qty: {r.total_qty})</option>)}
          </select>
        </div>
      </div>

      {!requirementId && (
        <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-16 text-center text-slate-500">
          <svg xmlns="http://www.w3.org/2000/svg" className="h-12 w-12 mx-auto mb-4 text-slate-300" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
          </svg>
          <p className="text-xl font-bold text-slate-600 mb-2">No Requirement Selected</p>
          <p>Select a project and requirement above to view its live progress board.</p>
        </div>
      )}

      {loading && requirementId && (
        <div className="flex justify-center py-20">
          <div className="animate-spin rounded-full h-12 w-12 border-b-4 border-blue-600"></div>
        </div>
      )}

      {progressData && !loading && (
        <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-8">
          <div className="flex items-center justify-between mb-8 pb-6 border-b border-slate-100">
            <div>
              <span className="bg-blue-100 text-blue-700 text-xs font-bold px-3 py-1 rounded-full uppercase tracking-wider mb-3 inline-block">Requirement Breakdown</span>
              <h2 className="text-3xl font-black text-slate-800">
                {progressData.parts.length > 0 && progressData.parts[0].name.includes("PIPE") ? "Dismantling Joint" : "Expansion Joint"}
              </h2>
            </div>
            <div className="text-right bg-slate-50 p-4 rounded-xl border border-slate-100">
              <p className="text-sm font-bold text-slate-500 uppercase tracking-wide">Target Qty</p>
              <p className="text-4xl font-black text-blue-600">{progressData.total_qty}</p>
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
            {progressData.parts.map((part: any) => (
              <div key={part.id} className="bg-slate-50 rounded-xl border border-slate-200 p-6">
                <div className="flex justify-between items-center mb-6">
                  <h3 className="text-xl font-bold text-slate-800">{part.name}</h3>
                  <span className="text-xs font-bold bg-slate-200 text-slate-600 px-2 py-1 rounded">Weight: {part.weight_percentage}%</span>
                </div>
                
                <div className="space-y-5">
                  {part.processes.map((proc: any) => {
                    const pct = Math.min(100, Math.round((proc.completed_qty / progressData.total_qty) * 100)) || 0;
                    
                    return (
                      <div key={proc.id} className="flex flex-col group">
                        <div className="flex justify-between items-end mb-1">
                          <span className="text-sm font-bold text-slate-700 uppercase tracking-wide">
                            {proc.process_name}
                          </span>
                          <div className="text-right">
                            <span className="text-xs font-bold text-slate-400 uppercase mr-3">{proc.completed_qty} / {progressData.total_qty} done</span>
                            <span className={`text-lg font-black ${pct === 100 ? 'text-emerald-500' : 'text-slate-700'}`}>
                              {pct}%
                            </span>
                          </div>
                        </div>
                        
                        <div className="w-full bg-slate-200 rounded-full h-3 relative overflow-hidden">
                          <div 
                            className={`h-full rounded-full transition-all duration-1000 ease-out ${
                              pct === 100 ? 'bg-emerald-500' : 
                              pct > 0 ? 'bg-blue-500' : 
                              'bg-transparent'
                            }`}
                            style={{ width: `${pct}%` }}
                          ></div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
