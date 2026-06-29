"use client";
import { apiFetch } from "@/lib/api";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

export default function EditProjects() {
  const router = useRouter();
  const [projects, setProjects] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  
  const [selectedProjectId, setSelectedProjectId] = useState<string>("");
  const [status, setStatus] = useState("Active");
  const [payroll, setPayroll] = useState("Company");
  const [targetDate, setTargetDate] = useState<string>("");
  const [assignedTig, setAssignedTig] = useState<number>(0);
  const [assignedMig, setAssignedMig] = useState<number>(0);
  const [assignedGrinders, setAssignedGrinders] = useState<number>(0);
  
  const [statusNote, setStatusNote] = useState<string>("");
  const [holdType, setHoldType] = useState<string>("");
  const [holdUntilDate, setHoldUntilDate] = useState<string>("");
  
  const [bellows, setBellows] = useState<any[]>([]);
  const [masterData, setMasterData] = useState<any[]>([]);
  const [duration, setDuration] = useState<number | null>(null);
  
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState({ type: "", text: "" });

  useEffect(() => {
    fetchProjects();
    apiFetch(`${process.env.NEXT_PUBLIC_API_URL || "http://localhost:4500"}/api/v1/master/welding`)
      .then((res) => res.json())
      .then((json) => {
        setMasterData(json.data || []);
      });
  }, []);

  const fetchProjects = () => {
    setLoading(true);
    apiFetch(`${process.env.NEXT_PUBLIC_API_URL || "http://localhost:4500"}/api/v1/projects`)
      .then((res) => res.json())
      .then((resData) => {
        setProjects(resData.data || []);
        setLoading(false);
      });
  };

  const handleProjectSelect = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const id = e.target.value;
    setSelectedProjectId(id);
    if (id) {
      const p = projects.find((proj) => proj.id.toString() === id);
      if (p) {
        setStatus(p.status || "Active");
        setStatusNote(p.status_note || "");
        setHoldType(p.hold_type || "");
        setHoldUntilDate(p.hold_until_date || "");
        setTargetDate(p.target_date ? p.target_date.split('T')[0] : "");
        setPayroll(p.payroll || "Company");
        setAssignedTig(p.assigned_tig || 0);
        setAssignedMig(p.assigned_mig || 0);
        setAssignedGrinders(p.assigned_grinders || 0);
        setBellows(p.bellows?.map((b: any) => ({ size: b.size, qty: b.quantity, type: b.type || "EJ" })) || []);
        fetchDuration(id, p.assigned_tig || 0, p.assigned_mig || 0, p.assigned_grinders || 0);
      }
    } else {
      setBellows([]);
      setDuration(null);
      setTargetDate("");
      setStatusNote("");
      setHoldUntilDate("");
    }
  };

  const fetchDuration = (id: string, tig: number, mig: number, grind: number) => {
    apiFetch(`${process.env.NEXT_PUBLIC_API_URL || "http://localhost:4500"}/api/v1/projects/duration`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        project_id: parseInt(id),
        assigned_tig: tig,
        assigned_mig: mig,
        assigned_grinders: grind
      })
    })
    .then(res => res.json())
    .then(resData => setDuration(resData.data ? resData.data.estimated_duration_days : 0))
    .catch(() => {});
  };

  useEffect(() => {
    if (selectedProjectId) {
      fetchDuration(selectedProjectId, assignedTig, assignedMig, assignedGrinders);
    }
  }, [assignedTig, assignedMig, assignedGrinders, selectedProjectId]);

  // Dynamic Resource Calculation
  useEffect(() => {
    const validBellows = bellows.filter(b => b.size && b.qty > 0).map(b => ({
      size: Number(b.size),
      qty: Number(b.qty),
      type: b.type
    }));

    // Find the project's target date if available to pass to the resource simulator
    let tDate = targetDate;
    if (!tDate && selectedProjectId) {
      const p = projects.find(proj => proj.id.toString() === selectedProjectId);
      if (p && p.target_date) tDate = p.target_date;
    }

    if (validBellows.length > 0) {
      apiFetch(`${process.env.NEXT_PUBLIC_API_URL || "http://localhost:4500"}/api/v1/projects/simulate_resources`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          bellows: validBellows,
          target_date: tDate
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
  }, [bellows, selectedProjectId, projects, targetDate]);

  const handleAddBellow = () => {
    setBellows([...bellows, { size: "", qty: 1, type: "EJ" }]);
  };

  const handleRemoveBellow = (index: number) => {
    setBellows(bellows.filter((_, i) => i !== index));
  };

  const handleBellowChange = (index: number, field: "size" | "qty" | "type", value: string | number) => {
    const newBellows = [...bellows];
    newBellows[index] = { ...newBellows[index], [field]: value };
    setBellows(newBellows);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedProjectId) return;
    
    setSubmitting(true);
    setMessage({ type: "", text: "" });

    try {
      const res = await apiFetch(`${process.env.NEXT_PUBLIC_API_URL || "http://localhost:4500"}/api/v1/projects/${selectedProjectId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          status,
          status_note: (status === "Hold" || status === "Cancelled") ? statusNote : null,
          hold_until_date: status === "Hold" && holdUntilDate ? holdUntilDate : null,
          hold_type: status === "Hold" ? holdType : null,
          target_date: targetDate || null,
          payroll: payroll,
          assigned_tig: assignedTig,
          assigned_mig: assignedMig,
          assigned_grinders: assignedGrinders
        })
      });

      const validBellows = bellows.filter(b => b.size && b.qty > 0).map(b => ({
        size: Number(b.size),
        qty: Number(b.qty),
        type: b.type
      }));

      await apiFetch(`${process.env.NEXT_PUBLIC_API_URL || "http://localhost:4500"}/api/v1/projects/${selectedProjectId}/bellows`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(validBellows)
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || "Failed to update project");

      setMessage({ type: "success", text: "Project updated successfully!" });
      
      // If completed, redirect to dashboard or projects list after a short delay
      if (status === "Completed") {
        setTimeout(() => {
          router.push("/projects");
        }, 1500);
      }
    } catch (err: any) {
      setMessage({ type: "error", text: err.message });
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = async () => {
    const confirmPass = window.prompt("⚠️ WARNING: Deleting this project will permanently remove all of its data. Type 'DELETE' to confirm:");
    if (confirmPass !== "DELETE") {
      alert("Deletion cancelled.");
      return;
    }
    
    setSubmitting(true);
    try {
      const res = await apiFetch(`${process.env.NEXT_PUBLIC_API_URL || "http://localhost:4500"}/api/v1/projects/${selectedProjectId}`, {
        method: "DELETE",
      });
      if (!res.ok) throw new Error("Failed to delete project");
      
      setMessage({ type: "success", text: "Project deleted successfully!" });
      setSelectedProjectId("");
      fetchProjects();
    } catch (err: any) {
      setMessage({ type: "error", text: err.message });
    } finally {
      setSubmitting(false);
    }
  };

  if (loading && projects.length === 0) return <div className="text-slate-500">Loading active projects...</div>;

  return (
    <div className="max-w-4xl mx-auto">
      <h1 className="text-3xl font-bold text-slate-900 mb-2">Edit Projects</h1>
      <p className="text-slate-500 mb-8">Assign workforce to projects or mark them as completed.</p>

      <form onSubmit={handleSubmit} className="space-y-8">
        <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6">
          <label className="block text-sm font-medium text-slate-700 mb-1">Select Active Project *</label>
          <select
            className="w-full px-4 py-2 rounded-lg border border-slate-300 focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 bg-white text-black mb-6"
            value={selectedProjectId}
            onChange={handleProjectSelect}
            required
          >
            <option value="">-- Choose a project --</option>
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.quotation_no} {p.status === "Completed" ? "(Completed)" : ""}
              </option>
            ))}
          </select>

          {selectedProjectId && (
            <div className="space-y-6">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6 pt-4 border-t border-slate-100">
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Project Status</label>
                  <select
                    className="w-full px-4 py-2 rounded-lg border border-slate-300 focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 bg-white text-black"
                    value={status}
                    onChange={(e) => setStatus(e.target.value)}
                  >
                    <option value="Active">Active</option>
                    <option value="Hold">Hold</option>
                    <option value="Cancelled">Cancelled</option>
                    <option value="Completed">Completed</option>
                  </select>
                  <p className="text-xs text-slate-500 mt-1">Status changes affect capacity metrics on dashboards.</p>
                </div>
                
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Target Date</label>
                  <input
                    type="date"
                    className="w-full px-4 py-2 rounded-lg border border-slate-300 focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 bg-white text-black"
                    value={targetDate}
                    onChange={(e) => setTargetDate(e.target.value)}
                  />
                  <p className="text-xs text-slate-500 mt-1">Overrides the deadline in the Master Schedule.</p>
                </div>
                
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Payroll Option</label>
                  <select
                    className="w-full px-4 py-2 rounded-lg border border-slate-300 focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 bg-white text-black"
                    value={payroll}
                    onChange={(e) => setPayroll(e.target.value)}
                  >
                    <option value="Company">Company</option>
                    <option value="Contractor">Contractor</option>
                  </select>
                </div>
                
                              {status === 'Hold' && (
                <div>
                  <label className="block text-sm font-semibold text-slate-700 mb-1">Hold Type</label>
                  <select 
                    className="w-full p-2.5 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-all"
                    value={holdType}
                    onChange={(e) => setHoldType(e.target.value)}
                  >
                    <option value="">Select Hold Reason</option>
                    <option value="Client Hold">Client Hold</option>
                    <option value="Material Hold">Material Hold</option>
                    <option value="Engineering Hold">Engineering Hold</option>
                    <option value="Inspection Hold">Inspection Hold</option>
                    <option value="Financial Hold">Financial Hold</option>
                    <option value="Vendor Hold">Vendor Hold</option>
                    <option value="General Hold">General Hold</option>
                  </select>
                </div>
              )}

              {(status === "Hold" || status === "Cancelled") && (
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1">
                      Reason for {status}
                    </label>
                    <textarea
                      className="w-full px-4 py-2 rounded-lg border border-slate-300 focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 bg-white text-black"
                      rows={2}
                      value={statusNote}
                      onChange={(e) => setStatusNote(e.target.value)}
                      placeholder={`Explain why project is ${status.toLowerCase()}...`}
                      required
                    />
                  </div>
                )}
                
                {status === "Hold" && (
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1">Hold Until Date (Optional)</label>
                    <input
                      type="date"
                      className="w-full px-4 py-2 rounded-lg border border-slate-300 focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 bg-white text-black"
                      value={holdUntilDate}
                      onChange={(e) => setHoldUntilDate(e.target.value)}
                    />
                  </div>
                )}
              </div>

              <div className="pt-4 border-t border-slate-100">
                <h3 className="text-lg font-medium text-slate-800 mb-4">Resource Allocation Override</h3>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1">Assigned TIG Welders</label>
                    <input
                      type="number"
                      min="0"
                      className="w-full px-4 py-2 rounded-lg border border-slate-300 focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 bg-white text-black"
                      value={assignedTig}
                      onChange={(e) => setAssignedTig(parseInt(e.target.value) || 0)}
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1">Assigned MIG Welders</label>
                    <input
                      type="number"
                      min="0"
                      className="w-full px-4 py-2 rounded-lg border border-slate-300 focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 bg-white text-black"
                      value={assignedMig}
                      onChange={(e) => setAssignedMig(parseInt(e.target.value) || 0)}
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1">Assigned Grinders</label>
                    <input
                      type="number"
                      min="0"
                      className="w-full px-4 py-2 rounded-lg border border-slate-300 focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 bg-white text-black"
                      value={assignedGrinders}
                      onChange={(e) => setAssignedGrinders(parseInt(e.target.value) || 0)}
                    />
                  </div>
                </div>
              </div>

              {duration !== null && (
                <div className="bg-indigo-50 border border-indigo-200 rounded-lg p-4 flex items-center gap-3">
                  <span className="text-2xl">⏱️</span>
                  <div>
                    <h4 className="text-sm font-semibold text-indigo-900">Estimated Time Required</h4>
                    <p className="text-indigo-800 text-sm">Based on these assignments, it will take <strong className="text-indigo-700">{duration} working days</strong> to complete.</p>
                  </div>
                </div>
              )}

              <div className="pt-4 border-t border-slate-100">
                <div className="flex justify-between items-center mb-4">
                  <h3 className="text-lg font-medium text-slate-800">Edit Joints & Bellows</h3>
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
                      <div className="w-48">
                        <label className="block text-sm font-medium text-slate-700 mb-1">Type</label>
                        <select
                          className="w-full px-4 py-2 rounded-lg border border-slate-300 focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 bg-white text-black"
                          value={bellow.type}
                          onChange={(e) => handleBellowChange(index, "type", e.target.value)}
                          required
                        >
                          <option value="EJ">Expansion Joint</option>
                          <option value="DJ">Dismantling Joint</option>
                        </select>
                      </div>
                      <div className="flex-1">
                        <label className="block text-sm font-medium text-slate-700 mb-1">Size (NB)</label>
                        <select
                          className="w-full px-4 py-2 rounded-lg border border-slate-300 focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 bg-white text-black"
                          value={bellow.size}
                          onChange={(e) => handleBellowChange(index, "size", e.target.value)}
                          required
                        >
                          <option value="">Select Size</option>
                          {masterData.filter(m => m.type === (bellow.type || 'EJ')).map((m) => (
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
                          className="w-full px-4 py-2 rounded-lg border border-slate-300 focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 bg-white text-black"
                          value={bellow.qty}
                          onChange={(e) => handleBellowChange(index, "qty", parseInt(e.target.value) || 0)}
                        />
                      </div>
                      <button
                        type="button"
                        onClick={() => handleRemoveBellow(index)}
                        className="px-3 py-2 text-red-500 hover:text-red-700 hover:bg-red-50 rounded-lg transition-colors border border-transparent hover:border-red-200"
                      >
                        Remove
                      </button>
                    </div>
                  ))}
                  {bellows.length === 0 && (
                    <p className="text-sm text-slate-500 italic">No expansion joints added to this project yet.</p>
                  )}
                </div>
              </div>

            </div>
          )}
        </div>

        {message.text && (
          <div className={`p-4 rounded-lg border ${message.type === 'error' ? 'bg-red-50 text-red-700 border-red-200' : 'bg-green-50 text-green-700 border-green-200'}`}>
            {message.text}
          </div>
        )}

        <div className="flex justify-between items-center pt-2">
          {selectedProjectId ? (
            <button
              type="button"
              onClick={handleDelete}
              className="px-4 py-2 text-red-600 hover:text-red-700 hover:bg-red-50 font-medium rounded-lg transition-colors border border-transparent hover:border-red-200"
            >
              Delete Project
            </button>
          ) : <div></div>}
          
          <button
            type="submit"
            disabled={submitting || !selectedProjectId}
            className="px-8 py-3 bg-indigo-600 hover:bg-indigo-700 text-white font-semibold rounded-lg shadow-md transition-colors disabled:opacity-50"
          >
            {submitting ? "Updating..." : "Save Changes"}
          </button>
        </div>
      </form>
    </div>
  );
}
