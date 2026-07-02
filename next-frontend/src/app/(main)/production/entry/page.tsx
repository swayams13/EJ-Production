"use client";
import { apiFetch } from "@/lib/api";

import { useState, useEffect } from "react";

export default function OperatorEntry() {
  const [projects, setProjects] = useState<any[]>([]);
  const [projectId, setProjectId] = useState("");
  
  const [requirements, setRequirements] = useState<any[]>([]);
  const [requirementId, setRequirementId] = useState("");
  
  const [parts, setParts] = useState<any[]>([]);
  const [totalQty, setTotalQty] = useState(0);
  const [partId, setPartId] = useState("");
  const [weldingSummary, setWeldingSummary] = useState<any>(null);

  const [qtyInputs, setQtyInputs] = useState<{[key: string]: string}>({});
  const [feetInputs, setFeetInputs] = useState<{[key: string]: string}>({});
  const [submitting, setSubmitting] = useState(false);
  const [successMsg, setSuccessMsg] = useState("");
  const [errorMsg, setErrorMsg] = useState("");
  
  const [activeTab, setActiveTab] = useState("Fabrication");

  const isWeldingProcess = (name: string) => /weld|grind|tig|mig/i.test(name);

  // Initial load
  useEffect(() => {
    apiFetch(`${process.env.NEXT_PUBLIC_API_URL || "http://localhost:8003"}/api/v1/projects`)
      .then(res => res.json())
      .then(resData => setProjects((resData.data || []).filter((p: any) => p.status !== "Completed")));
  }, []);

  // When project changes, fetch requirements
  useEffect(() => {
    if (!projectId) {
      setRequirements([]);
      setRequirementId("");
      return;
    }
    apiFetch(`${process.env.NEXT_PUBLIC_API_URL || "http://localhost:8003"}/api/v1/production/requirements/${projectId}`)
      .then(res => res.json())
      .then(resData => setRequirements(resData.data || []));
  }, [projectId]);

  // When requirement changes, fetch parts & processes
  useEffect(() => {
    if (!requirementId) {
      setParts([]);
      setPartId("");
      setTotalQty(0);
      return;
    }
    apiFetch(`${process.env.NEXT_PUBLIC_API_URL || "http://localhost:8003"}/api/v1/production/parts/${requirementId}?t=${Date.now()}`)
      .then(res => res.json())
      .then(resData => {
        if(resData.success && resData.data) {
           setTotalQty(resData.data.total_qty);
           setParts(resData.data.parts);
        }
      });
      
    apiFetch(`${process.env.NEXT_PUBLIC_API_URL || "http://localhost:8003"}/api/v1/production/requirements/${requirementId}/welding_summary?t=${Date.now()}`)
      .then(res => res.json())
      .then(resData => {
        if(resData.success) {
           setWeldingSummary(resData.data);
        }
      });
  }, [requirementId]);

  const handleQtyChange = (processId: string, val: string) => {
    setQtyInputs({ ...qtyInputs, [processId]: val });
  };
  
  const handleFeetChange = (processId: string, val: string) => {
    setFeetInputs({ ...feetInputs, [processId]: val });
  };

  const handleSubmitProcess = async (processId: string, processName: string) => {
    const qty = parseInt(qtyInputs[processId] || "0");
    if (qty <= 0) {
      setErrorMsg("Quantity must be greater than 0");
      return;
    }
    
    const feet = parseFloat(feetInputs[processId] || "0");

    setSubmitting(true);
    setSuccessMsg("");
    setErrorMsg("");

    try {
      const res = await apiFetch(`${process.env.NEXT_PUBLIC_API_URL || "http://localhost:8003"}/api/v1/production/processes/${processId}/transactions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          quantity_completed: qty,
          feet_completed: feet > 0 ? feet : null
        })
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.detail || "Submission failed");
      }

      setSuccessMsg(`Successfully recorded ${qty} for ${processName}!`);
      setQtyInputs({ ...qtyInputs, [processId]: "" });
      setFeetInputs({ ...feetInputs, [processId]: "" });
      
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

  const handleGlobalWeldingSubmit = async (processType: string) => {
    const feet = parseFloat(feetInputs[processType] || "0");
    if (feet <= 0) {
      setErrorMsg("Feet done must be greater than 0");
      return;
    }

    setSubmitting(true);
    setSuccessMsg("");
    setErrorMsg("");

    try {
      const res = await apiFetch(`${process.env.NEXT_PUBLIC_API_URL || "http://localhost:8003"}/api/v1/production/requirements/${requirementId}/welding_logs`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          process_type: processType,
          feet_done: feet
        })
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.detail || "Submission failed");
      }

      setSuccessMsg(`Successfully recorded ${feet} feet for ${processType}!`);
      setFeetInputs({ ...feetInputs, [processType]: "" });
      
      // Refresh welding summary
      apiFetch(`${process.env.NEXT_PUBLIC_API_URL || "http://localhost:8003"}/api/v1/production/requirements/${requirementId}/welding_summary?t=${Date.now()}`)
        .then(res => res.json())
        .then(resData => {
          if(resData.success) setWeldingSummary(resData.data);
        });

      setTimeout(() => setSuccessMsg(""), 3000);
    } catch (err: any) {
      setErrorMsg(err.message);
    } finally {
      setSubmitting(false);
    }
  };

  const isFeetRequired = (processName: string) => {
     const name = processName.toLowerCase();
     return name.includes("weld") || name.includes("grind") || name.includes("tig") || name.includes("mig");
  };

  return (
    <div className="max-w-7xl mx-auto mb-20">
      <div className="bg-slate-900 p-8 text-white rounded-b-3xl shadow-lg mb-8 mx-[-2rem] mt-[-2rem]">
        <h1 className="text-3xl font-extrabold text-white tracking-tight mb-2">Daily Progress Tracker</h1>
        <p className="text-slate-300 text-lg font-medium">Record quantities and feet completed for each process today.</p>
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
        <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-200 grid grid-cols-1 md:grid-cols-3 gap-4">

          <div className="space-y-1">
            <label className="block text-xs font-bold text-slate-500 uppercase tracking-wide">Project</label>
            <select 
              className="w-full bg-slate-50 border border-slate-300 rounded-lg px-3 py-2 font-semibold text-black focus:ring-2 focus:ring-blue-500"
              value={projectId} onChange={(e) => setProjectId(e.target.value)}
            >
              <option value="">-- Choose Project --</option>
              {projects.map(p => <option key={p.id} value={p.id}>{p.project_name || p.quotation_no}</option>)}
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
            <div className="border-b border-slate-300 pb-4">
              <h2 className="text-2xl font-bold text-slate-800 mb-4">Track Production</h2>
              <div className="flex bg-slate-100 p-1 rounded-xl w-full max-w-md">
                <button
                  onClick={() => setActiveTab("Fabrication")}
                  className={`flex-1 py-2 px-4 rounded-lg text-sm font-bold transition-all ${activeTab === "Fabrication" ? "bg-white text-indigo-700 shadow-sm" : "text-slate-500 hover:text-slate-700"}`}
                >
                  Fabrication & Assembly
                </button>
                <button
                  onClick={() => setActiveTab("Welding")}
                  className={`flex-1 py-2 px-4 rounded-lg text-sm font-bold transition-all ${activeTab === "Welding" ? "bg-white text-indigo-700 shadow-sm" : "text-slate-500 hover:text-slate-700"}`}
                >
                  {requirements.find(r => r.id.toString() === requirementId)?.type === "DJ" ? "Welding" : "Welding & Grinding"}
                </button>
              </div>
            </div>
            
            {activeTab === "Fabrication" ? (
              <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-6">
                {parts
                  .filter(p => !partId || p.id.toString() === partId)
                  .map((part) => (
                <div key={part.id} className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden hover:shadow-md transition-shadow">
                  <div className="bg-slate-800 px-4 py-3 text-white flex justify-between items-center">
                    <h3 className="font-bold text-lg truncate pr-2" title={part.name}>{part.name}</h3>
                    <span className="bg-slate-700 text-xs px-2 py-1 rounded-full font-medium whitespace-nowrap">Target: {totalQty}</span>
                  </div>
                  
                  <div className="divide-y divide-slate-100">
                    {part.processes
                      .filter((proc: any) => !isWeldingProcess(proc.process_name))
                      .map((proc: any) => {
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
                            <div className="flex flex-col gap-2 mt-2">
                              <div className="flex gap-2">
                                <input
                                  type="number"
                                  min="1"
                                  max={pending}
                                  placeholder="Today's Qty"
                                  className="flex-1 border-2 border-slate-200 rounded-lg px-3 py-2 font-bold text-black focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                                  value={qtyInputs[proc.id] || ""}
                                  onChange={(e) => handleQtyChange(proc.id, e.target.value)}
                                />
                              </div>
                              <button
                                onClick={() => handleSubmitProcess(proc.id, proc.process_name)}
                                disabled={submitting || !qtyInputs[proc.id]}
                                className="w-full bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg font-bold shadow-sm disabled:opacity-50 transition-colors whitespace-nowrap"
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
                    {part.processes.filter((proc: any) => !isWeldingProcess(proc.process_name)).length === 0 && (
                      <div className="p-4 text-center text-sm text-slate-500 italic">
                        No fabrication processes for this part.
                      </div>
                    )}
                  </div>
                </div>
              ))}
              
              {parts.filter(p => !partId || p.id.toString() === partId).length === 0 && (
                <div className="col-span-full py-12 text-center bg-slate-50 rounded-2xl border border-slate-200 border-dashed">
                  <h3 className="text-lg font-bold text-slate-700 mb-2">No Parts Found</h3>
                  <p className="text-slate-500">There are no parts for this requirement.</p>
                </div>
              )}
            </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                {(requirements.find(r => r.id.toString() === requirementId)?.type === "DJ" ? ["MIG", "Grinding"] : ["TIG", "MIG", "Grinding"]).map(type => {
                  const isDJ = requirements.find(r => r.id.toString() === requirementId)?.type === "DJ";
                  const displayType = (isDJ && type === "MIG") ? "Welding" : type;
                  const target = weldingSummary?.targets?.[type] || 0;
                  const completed = weldingSummary?.completed?.[type] || 0;
                  const pending = Math.max(0, target - completed);
                  const isComplete = pending <= 0 && target > 0;
                  
                  return (
                    <div key={type} className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden hover:shadow-md transition-shadow">
                      <div className={`px-4 py-3 text-white flex justify-between items-center ${isComplete ? 'bg-emerald-600' : 'bg-indigo-600'}`}>
                        <h3 className="font-bold text-lg">{displayType}</h3>
                        <span className="bg-white/20 text-xs px-2 py-1 rounded-full font-medium whitespace-nowrap">Target: {target.toFixed(1)} ft</span>
                      </div>
                      
                      <div className="p-5 flex flex-col gap-4">
                        <div className="flex justify-between items-center bg-slate-50 p-3 rounded-lg border border-slate-100">
                          <div className="text-center">
                            <div className="text-xs font-bold text-slate-500 uppercase tracking-wide">Done</div>
                            <div className="text-lg font-black text-indigo-700">{completed.toFixed(1)} <span className="text-sm font-normal text-slate-500">ft</span></div>
                          </div>
                          <div className="h-8 w-px bg-slate-200"></div>
                          <div className="text-center">
                            <div className="text-xs font-bold text-slate-500 uppercase tracking-wide">Pending</div>
                            <div className="text-lg font-black text-rose-600">{pending.toFixed(1)} <span className="text-sm font-normal text-slate-500">ft</span></div>
                          </div>
                        </div>
                        
                        {!isComplete && target > 0 ? (
                          <div className="flex flex-col gap-2 mt-2">
                            <input
                              type="number"
                              min="0.1"
                              step="0.1"
                              placeholder="Today's Feet Done"
                              className="w-full border-2 border-slate-200 rounded-lg px-3 py-3 font-bold text-black focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
                              value={feetInputs[type] || ""}
                              onChange={(e) => handleFeetChange(type, e.target.value)}
                            />
                            <button
                              onClick={() => handleGlobalWeldingSubmit(type)}
                              disabled={submitting || !feetInputs[type]}
                              className="w-full bg-indigo-600 hover:bg-indigo-700 text-white px-4 py-3 rounded-lg font-bold shadow-sm disabled:opacity-50 transition-colors"
                            >
                              Log {displayType} Progress
                            </button>
                          </div>
                        ) : target === 0 ? (
                          <div className="text-center text-slate-500 italic py-4">No {displayType} required for this size.</div>
                        ) : (
                          <div className="text-center text-emerald-600 font-bold py-4">Target Reached! 🎉</div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
