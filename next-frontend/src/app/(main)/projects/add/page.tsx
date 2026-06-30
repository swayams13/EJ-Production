"use client";
import { apiFetch } from "@/lib/api";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

export default function AddProjects() {
  const router = useRouter();
  const [masterData, setMasterData] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  const [quotationNo, setQuotationNo] = useState("");
  const [payroll, setPayroll] = useState("Company");
  const [startDate, setStartDate] = useState(new Date(Date.now() + 86400000).toISOString().split('T')[0]);
  const [targetDate, setTargetDate] = useState("");
  const [bellows, setBellows] = useState<any[]>([{ size: "", qty: 1, type: "EJ", pn_rating: "" }]);
  
  const [assignedTig, setAssignedTig] = useState<number>(0);
  const [assignedMig, setAssignedMig] = useState<number>(0);
  const [assignedGrinders, setAssignedGrinders] = useState<number>(0);

  const [simulation, setSimulation] = useState<any>(null);
  const [duration, setDuration] = useState<number | null>(null);

  useEffect(() => {
    apiFetch(`${process.env.NEXT_PUBLIC_API_URL || "http://localhost:8003"}/api/v1/master/welding`)
      .then((res) => res.json())
      .then((resData) => {
        const data = resData.data || [];
        setMasterData(data);
        setLoading(false);
      });
  }, []);

  useEffect(() => {
    const validBellows = bellows.filter(b => b.size && b.qty > 0).map(b => ({
      size: Number(b.size),
      qty: Number(b.qty),
      type: b.type,
      pn_rating: b.pn_rating
    }));
    
    if (validBellows.length > 0 && targetDate && startDate) {
      const start = new Date(startDate);
      const target = new Date(targetDate);
      const days = Math.ceil((target.getTime() - start.getTime()) / (1000 * 3600 * 24));
      
      if (days > 0) {
        apiFetch(`${process.env.NEXT_PUBLIC_API_URL || "http://localhost:8003"}/api/v1/projects/simulate`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            target_days: days,
            bellows: validBellows
          })
        })
        .then(res => res.json())
        .then(resData => setSimulation({...resData.data, days}))
        .catch(err => console.error(err));
      } else {
        setSimulation({ invalidDate: true });
      }
    } else {
      setSimulation(null);
    }
    
    // Duration simulation
    if (validBellows.length > 0 && (assignedTig > 0 || assignedMig > 0 || assignedGrinders > 0)) {
      apiFetch(`${process.env.NEXT_PUBLIC_API_URL || "http://localhost:8003"}/api/v1/projects/simulate_duration`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          bellows: validBellows,
          assigned_tig: assignedTig,
          assigned_mig: assignedMig,
          assigned_grinders: assignedGrinders
        })
      })
      .then(res => res.json())
      .then(resData => setDuration(resData.data ? resData.data.estimated_duration_days : 0))
      .catch(err => console.error(err));
    } else {
      setDuration(null);
    }
  }, [bellows, targetDate, startDate, assignedTig, assignedMig, assignedGrinders]);

  // Dynamic Resource Calculation
  useEffect(() => {
    const validBellows = bellows.filter(b => b.size && b.qty > 0).map(b => ({
      size: Number(b.size),
      qty: Number(b.qty),
      type: b.type,
      pn_rating: b.pn_rating
    }));

    if (validBellows.length > 0) {
      apiFetch(`${process.env.NEXT_PUBLIC_API_URL || "http://localhost:8003"}/api/v1/projects/simulate_resources`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          bellows: validBellows,
          target_date: targetDate || null
        })
      })
      .then(res => res.json())
      .then(resData => {
        if (resData.data) {
          setAssignedTig(resData.data.assigned_tig);
          setAssignedMig(resData.data.assigned_mig);
          setAssignedGrinders(resData.data.assigned_grinders);
        }
      })
      .catch(err => console.error(err));
    }
  }, [bellows, targetDate]);

  const handleAddBellow = () => {
    setBellows([...bellows, { size: "", qty: 1, type: "EJ", pn_rating: "" }]);
  };

  const handleRemoveBellow = (index: number) => {
    setBellows(bellows.filter((_, i) => i !== index));
  };

  const handleBellowChange = (index: number, field: "size" | "qty" | "type" | "pn_rating", value: string | number) => {
    const newBellows = [...bellows];
    newBellows[index] = { ...newBellows[index], [field]: value };
    setBellows(newBellows);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setError("");

    // Filter out incomplete bellows
    const validBellows = bellows.filter(b => b.size && b.qty > 0).map(b => ({
      size: Number(b.size),
      qty: Number(b.qty),
      type: b.type,
      pn_rating: b.pn_rating
    }));

    try {
      const res = await apiFetch(`${process.env.NEXT_PUBLIC_API_URL || "http://localhost:8003"}/api/v1/projects`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          quotation_no: quotationNo,
          target_date: targetDate || null,
          payroll: payroll,
          bellows: validBellows,
          assigned_tig: assignedTig,
          assigned_mig: assignedMig,
          assigned_grinders: assignedGrinders
        })
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || "Failed to create project");

      router.push("/dashboard");
    } catch (err: any) {
      setError(err.message);
      setSubmitting(false);
    }
  };

  if (loading) return <div className="text-slate-500">Loading form...</div>;

  return (
    <div className="max-w-4xl mx-auto">
      <h1 className="text-3xl font-bold text-slate-900 mb-2">Create New Project</h1>
      <p className="text-slate-500 mb-8">Add a new project and assign its expansion joints.</p>

      <form onSubmit={handleSubmit} className="space-y-8">
        <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6">
          <h2 className="text-xl font-semibold text-slate-800 mb-4">Project Details</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Project Code *</label>
              <input
                type="text"
                required
                className="w-full px-4 py-2 rounded-lg border border-slate-300 focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 text-black bg-white"
                placeholder="e.g. PROJ-001"
                value={quotationNo}
                onChange={(e) => setQuotationNo(e.target.value)}
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Payroll Option</label>
              <select
                className="w-full px-4 py-2 rounded-lg border border-slate-300 focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 text-black bg-white"
                value={payroll}
                onChange={(e) => setPayroll(e.target.value)}
              >
                <option value="Company">Company</option>
                <option value="Contractor">Contractor</option>
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Start Date</label>
              <input
                type="date"
                required
                className="w-full px-4 py-2 rounded-lg border border-slate-300 focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 text-black bg-white"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Target Deadline</label>
              <input
                type="date"
                required
                className="w-full px-4 py-2 rounded-lg border border-slate-300 focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 text-black bg-white"
                value={targetDate}
                onChange={(e) => setTargetDate(e.target.value)}
              />
            </div>
          </div>
        </div>

        <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6">
          <div className="flex justify-between items-center mb-4">
            <h2 className="text-xl font-semibold text-slate-800">Joints & Bellows</h2>
            <button
              type="button"
              onClick={handleAddBellow}
              className="text-sm font-medium text-indigo-600 hover:text-indigo-700 bg-indigo-50 hover:bg-indigo-100 px-3 py-1.5 rounded-md transition-colors"
            >
              + Add Row
            </button>
          </div>

          <div className="space-y-4">
            {bellows.map((bellow, index) => (
              <div key={index} className="flex gap-4 items-end">
                <div className="w-12 text-center">
                  <label className="block text-sm font-medium text-slate-700 mb-1">Sr. No.</label>
                  <div className="py-2">
                    <span className="text-sm font-semibold text-slate-700">{index + 1}</span>
                  </div>
                </div>
                <div className="w-48">
                  <label className="block text-sm font-medium text-slate-700 mb-1">Type</label>
                  <select
                    className="w-full px-4 py-2 rounded-lg border border-slate-300 focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 bg-white text-black"
                    value={bellow.type}
                    onChange={(e) => handleBellowChange(index, "type", e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter') e.preventDefault(); }}
                    required
                  >
                    <option value="EJ">Expansion Joint</option>
                    <option value="DJ">Dismantling Joint</option>
                  </select>
                </div>
                <div className="w-32">
                  <label className="block text-sm font-medium text-slate-700 mb-1">PN Rating</label>
                  <select
                    className="w-full px-4 py-2 rounded-lg border border-slate-300 focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 bg-white text-black"
                    value={bellow.pn_rating || ""}
                    onChange={(e) => handleBellowChange(index, "pn_rating", e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter') e.preventDefault(); }}
                  >
                    <option value="">None</option>
                    <option value="PN 6">PN 6</option>
                    <option value="PN 10">PN 10</option>
                    <option value="PN 16">PN 16</option>
                    <option value="PN 20">PN 20</option>
                    <option value="PN 25">PN 25</option>
                  </select>
                </div>
                <div className="flex-1">
                  <label className="block text-sm font-medium text-slate-700 mb-1">Size (NB)</label>
                  <select
                    className="w-full px-4 py-2 rounded-lg border border-slate-300 focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 bg-white text-black"
                    value={bellow.size}
                    onChange={(e) => handleBellowChange(index, "size", e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter') e.preventDefault(); }}
                    required
                  >
                    <option value="">Select Size</option>
                    {masterData.filter(m => m.type === bellow.type).map((m) => (
                      <option key={m.size} value={m.size}>{m.size} NB</option>
                    ))}
                  </select>
                </div>
                <div className="w-32">
                  <label className="block text-sm font-medium text-slate-700 mb-1">Quantity</label>
                  <input
                    type="number"
                    min="1"
                    required
                    className="w-full px-4 py-2 rounded-lg border border-slate-300 focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 text-black bg-white"
                    value={bellow.qty}
                    onChange={(e) => handleBellowChange(index, "qty", parseInt(e.target.value) || 0)}
                    onKeyDown={(e) => { if (e.key === 'Enter') e.preventDefault(); }}
                  />
                </div>
                {bellows.length > 1 && (
                  <button
                    type="button"
                    onClick={() => handleRemoveBellow(index)}
                    className="px-3 py-2 text-red-500 hover:text-red-700 hover:bg-red-50 rounded-lg transition-colors border border-transparent hover:border-red-200"
                  >
                    Remove
                  </button>
                )}
              </div>
            ))}
          </div>
        </div>

        <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6">
          <h2 className="text-xl font-semibold text-slate-800 mb-4">Manual Resource Assignment (Optional)</h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">TIG Welders</label>
              <input
                type="number"
                min="0"
                className="w-full px-4 py-2 rounded-lg border border-slate-300 focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 text-black bg-white"
                value={assignedTig}
                onChange={(e) => setAssignedTig(parseInt(e.target.value) || 0)}
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">MIG Welders</label>
              <input
                type="number"
                min="0"
                className="w-full px-4 py-2 rounded-lg border border-slate-300 focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 text-black bg-white"
                value={assignedMig}
                onChange={(e) => setAssignedMig(parseInt(e.target.value) || 0)}
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Grinders</label>
              <input
                type="number"
                min="0"
                className="w-full px-4 py-2 rounded-lg border border-slate-300 focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 text-black bg-white"
                value={assignedGrinders}
                onChange={(e) => setAssignedGrinders(parseInt(e.target.value) || 0)}
              />
            </div>
          </div>
          
          {duration !== null && (
            <div className="mt-6 bg-indigo-50 border border-indigo-200 rounded-lg p-4 flex items-center gap-3">
              <span className="text-2xl">⏱️</span>
              <div>
                <h4 className="text-sm font-semibold text-indigo-900">Estimated Time Required</h4>
                <p className="text-indigo-800 text-sm">Based on these assigned resources, it will take <strong className="text-indigo-700">{duration} working days</strong> to complete.</p>
              </div>
            </div>
          )}
        </div>

        {simulation && (
          <div className={`p-6 rounded-xl border ${simulation.invalidDate ? 'bg-amber-50 border-amber-200' : 'bg-indigo-50 border-indigo-200 shadow-sm'}`}>
            {simulation.invalidDate ? (
              <div className="text-amber-800 font-medium flex items-center gap-2">
                ⚠️ The target deadline is today or in the past.
              </div>
            ) : (
              <div>
                <h3 className="text-indigo-800 font-bold mb-2 flex items-center gap-2">
                  💡 Algorithmic Suggestion
                </h3>
                <p className="text-indigo-900 text-sm">
                  To complete this work by the deadline (which is <span className="font-bold">{simulation.days} working days</span> away), you will need approximately:
                </p>
                <div className="mt-4 grid grid-cols-3 gap-4">
                  <div className="bg-white p-3 rounded-lg border border-indigo-100 text-center">
                    <div className="text-2xl font-bold text-indigo-600">{simulation.req_tig}</div>
                    <div className="text-xs font-semibold text-slate-500 uppercase mt-1">TIG Welders</div>
                  </div>
                  <div className="bg-white p-3 rounded-lg border border-indigo-100 text-center">
                    <div className="text-2xl font-bold text-indigo-600">{simulation.req_mig}</div>
                    <div className="text-xs font-semibold text-slate-500 uppercase mt-1">MIG Welders</div>
                  </div>
                  <div className="bg-white p-3 rounded-lg border border-indigo-100 text-center">
                    <div className="text-2xl font-bold text-indigo-600">{simulation.req_grind}</div>
                    <div className="text-xs font-semibold text-slate-500 uppercase mt-1">Grinders</div>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        {error && (
          <div className="p-4 rounded-lg bg-red-50 text-red-700 border border-red-200 flex items-center gap-3 shadow-sm">
            <svg className="w-5 h-5 text-red-500" fill="currentColor" viewBox="0 0 20 20">
              <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7 4a1 1 0 11-2 0 1 1 0 012 0zm-1-9a1 1 0 00-1 1v4a1 1 0 102 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
            </svg>
            <span className="font-medium">{error}</span>
          </div>
        )}

        <div className="flex justify-end pt-4">
          <button
            type="submit"
            disabled={submitting}
            className="px-8 py-3 bg-indigo-600 hover:bg-indigo-700 text-white font-semibold rounded-lg shadow-md transition-colors disabled:opacity-50"
          >
            {submitting ? "Creating Project..." : "Save Project & Calculate Resources"}
          </button>
        </div>
      </form>
    </div>
  );
}
