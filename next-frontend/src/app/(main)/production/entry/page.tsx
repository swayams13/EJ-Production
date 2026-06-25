"use client";
import { fetchWithAuth } from "@/lib/api";

import { useState, useEffect } from "react";

export default function OperatorEntry() {
  const [projects, setProjects] = useState<any[]>([]);
  const [projectId, setProjectId] = useState("");
  
  const [requirements, setRequirements] = useState<any[]>([]);
  const [requirementId, setRequirementId] = useState("");
  
  const [parts, setParts] = useState<any[]>([]);
  const [totalQty, setTotalQty] = useState(0);
  const [partId, setPartId] = useState("");
  
  const [operators, setOperators] = useState<any[]>([]);
  const [operatorId, setOperatorId] = useState("");

  const [qtyInputs, setQtyInputs] = useState<{[key: string]: string}>({});
  const [submitting, setSubmitting] = useState(false);
  const [successMsg, setSuccessMsg] = useState("");
  const [errorMsg, setErrorMsg] = useState("");

  // Initial load
  useEffect(() => {
    fetchWithAuth(`${process.env.NEXT_PUBLIC_API_URL || "http://localhost:8003"}/api/projects`)
      .then(res => res.json())
      .then(data => setProjects(data.filter((p: any) => p.status !== "Completed")));
      
    fetchWithAuth(`${process.env.NEXT_PUBLIC_API_URL || "http://localhost:8003"}/api/users`)
      .then(res => res.json())
      .then(data => setOperators(data.filter((u: any) => u.role === "Operator")));
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

  // When requirement changes, fetch parts & processes
  useEffect(() => {
    if (!requirementId) {
      setParts([]);
      setPartId("");
      setTotalQty(0);
      return;
    }
    fetchWithAuth(`${process.env.NEXT_PUBLIC_API_URL || "http://localhost:8003"}/api/requirements/${requirementId}/parts`)
      .then(res => res.json())
      .then(data => {
        setTotalQty(data.total_qty);
        setParts(data.parts);
      });
  }, [requirementId]);

  const handleQtyChange = (processId: string, val: string) => {
    setQtyInputs({ ...qtyInputs, [processId]: val });
  };

  const handleSubmitProcess = async (processId: string, processName: string) => {
    if (!operatorId) {
      setErrorMsg("Please select your operator profile first.");
      return;
    }
    const qty = parseInt(qtyInputs[processId] || "0");
    if (qty <= 0) {
      setErrorMsg("Quantity must be greater than 0");
      return;
    }

    setSubmitting(true);
    setSuccessMsg("");
    setErrorMsg("");

    try {
      const res = await fetchWithAuth(`${process.env.NEXT_PUBLIC_API_URL || "http://localhost:8003"}/api/processes/${processId}/transactions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          operator_id: parseInt(operatorId),
          quantity_completed: qty
        })
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.detail || "Submission failed");
      }

      setSuccessMsg(`Successfully recorded ${qty} for ${processName}!`);
      setQtyInputs({ ...qtyInputs, [processId]: "" });
      
      // Refresh parts to show new totals
      const reqId = requirementId;
      setRequirementId("");
      setTimeout(() => setRequirementId(reqId), 50);

      setTimeout(() => setSuccessMsg(""), 3000);
    } catch (err: any) {
      setErrorMsg(err.message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="max-w-7xl mx-auto mb-20">
      <div className="bg-slate-900 p-8 text-white rounded-b-3xl shadow-lg mb-8 mx-[-2rem] mt-[-2rem]">
        <h1 className="text-3xl font-extrabold text-white tracking-tight mb-2">Daily Progress Tracker</h1>
        <p className="text-slate-300 text-lg font-medium">Record quantities completed for each process today.</p>
      </div>

      <div className="space-y-6">
        {successMsg && (
          <div className="bg-emerald-100 border-l-4 border-emerald-500 text-emerald-800 p-4 rounded-xl shadow-sm text-lg font-bold animate-pulse">
            ✅ {successMsg}
          </div>
        )}
        {errorMsg && (
          <div className="bg-rose-100 border-l-4 border-rose-500 text-rose-800 p-4 rounded-xl shadow-sm text-lg font-bold">
            ❌ {errorMsg}
          </div>
        )}

        {/* Selection Header */}
        <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-200 grid grid-cols-1 md:grid-cols-4 gap-4">
          <div className="space-y-1">
            <label className="block text-xs font-bold text-slate-500 uppercase tracking-wide">Operator</label>
            <select 
              className="w-full bg-slate-50 border border-slate-300 rounded-lg px-3 py-2 font-semibold text-black focus:ring-2 focus:ring-blue-500"
              value={operatorId} onChange={(e) => setOperatorId(e.target.value)}
            >
              <option value="">-- Select Profile --</option>
              {operators.map(o => <option key={o.id} value={o.id}>{o.name}</option>)}
            </select>
          </div>

          <div className="space-y-1">
            <label className="block text-xs font-bold text-slate-500 uppercase tracking-wide">Project</label>
            <select 
              className="w-full bg-slate-50 border border-slate-300 rounded-lg px-3 py-2 font-semibold text-black focus:ring-2 focus:ring-blue-500"
              value={projectId} onChange={(e) => setProjectId(e.target.value)}
            >
              <option value="">-- Choose Project --</option>
              {projects.map(p => <option key={p.id} value={p.id}>{p.project_code} ({p.customer_name})</option>)}
            </select>
          </div>

          <div className="space-y-1">
            <label className="block text-xs font-bold text-slate-500 uppercase tracking-wide">Requirement</label>
            <select 
              className="w-full bg-slate-50 border border-slate-300 rounded-lg px-3 py-2 font-semibold text-black focus:ring-2 focus:ring-blue-500 disabled:opacity-50"
              value={requirementId} onChange={(e) => setRequirementId(e.target.value)} disabled={!projectId}
            >
              <option value="">-- Choose Requirement --</option>
              {requirements.map(r => <option key={r.id} value={r.id}>{r.type} - {r.size} (Qty: {r.total_qty})</option>)}
            </select>
          </div>

          <div className="space-y-1">
            <label className="block text-xs font-bold text-slate-500 uppercase tracking-wide">Specific Part (Optional)</label>
            <select 
              className="w-full bg-slate-50 border border-slate-300 rounded-lg px-3 py-2 font-semibold text-black focus:ring-2 focus:ring-blue-500 disabled:opacity-50"
              value={partId} onChange={(e) => setPartId(e.target.value)} disabled={!requirementId}
            >
              <option value="">All Parts</option>
              {parts.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </div>
        </div>

        {/* Process Tracking Grid */}
        {requirementId && parts.length > 0 && (
          <div className="space-y-6">
            <h2 className="text-2xl font-bold text-slate-800 border-b border-slate-300 pb-2">Track Production</h2>
            
            <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-6">
              {parts.filter(p => !partId || p.id.toString() === partId).map((part) => (
                <div key={part.id} className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden hover:shadow-md transition-shadow">
                  <div className="bg-slate-800 px-4 py-3 text-white flex justify-between items-center">
                    <h3 className="font-bold text-lg truncate pr-2" title={part.name}>{part.name}</h3>
                    <span className="bg-slate-700 text-xs px-2 py-1 rounded-full font-medium whitespace-nowrap">Target: {totalQty}</span>
                  </div>
                  
                  <div className="divide-y divide-slate-100">
                    {part.processes.map((proc: any) => {
                      const pending = totalQty - proc.completed_qty;
                      const isComplete = pending <= 0;
                      
                      return (
                        <div key={proc.id} className={`p-4 flex flex-col gap-3 ${isComplete ? 'bg-emerald-50/50' : ''}`}>
                          <div className="flex justify-between items-center">
                            <span className={`font-bold ${isComplete ? 'text-emerald-700' : 'text-slate-800'}`}>{proc.process_name}</span>
                            <div className="flex gap-2 text-xs font-bold">
                              <span className="bg-emerald-100 text-emerald-800 px-2 py-1 rounded">Done: {proc.completed_qty}</span>
                              <span className="bg-rose-100 text-rose-800 px-2 py-1 rounded">Pend: {Math.max(0, pending)}</span>
                            </div>
                          </div>
                          
                          {!isComplete && (
                            <div className="flex gap-2 mt-2">
                              <input
                                type="number"
                                min="1"
                                max={pending}
                                placeholder="Today's Qty"
                                className="flex-1 border-2 border-slate-200 rounded-lg px-3 py-2 font-bold text-black focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                                value={qtyInputs[proc.id] || ""}
                                onChange={(e) => handleQtyChange(proc.id, e.target.value)}
                              />
                              <button
                                onClick={() => handleSubmitProcess(proc.id, proc.process_name)}
                                disabled={submitting || !qtyInputs[proc.id]}
                                className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg font-bold shadow-sm disabled:opacity-50 transition-colors whitespace-nowrap"
                              >
                                Save
                              </button>
                            </div>
                          )}
                          {isComplete && (
                            <div className="text-sm font-bold text-emerald-600 flex items-center gap-1 mt-1">
                              <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                                <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                              </svg>
                              Fully Completed
                            </div>
                          )}
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
    </div>
  );
}
