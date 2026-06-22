"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

export default function EditProjects() {
  const router = useRouter();
  const [projects, setProjects] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  
  const [selectedProjectId, setSelectedProjectId] = useState<string>("");
  const [status, setStatus] = useState("Active");
  const [assignedTig, setAssignedTig] = useState<number>(0);
  const [assignedMig, setAssignedMig] = useState<number>(0);
  const [assignedGrinders, setAssignedGrinders] = useState<number>(0);
  
  const [bellows, setBellows] = useState<any[]>([]);
  const [sizes, setSizes] = useState<number[]>([]);
  const [duration, setDuration] = useState<number | null>(null);
  
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState({ type: "", text: "" });

  useEffect(() => {
    fetchProjects();
    fetch(`${process.env.NEXT_PUBLIC_API_URL || "https://ej-production-production.up.railway.app"}/api/master/welding`)
      .then((res) => res.json())
      .then((json) => {
        setSizes(json.map((item: any) => item.size));
      });
  }, []);

  const fetchProjects = () => {
    setLoading(true);
    fetch(`${process.env.NEXT_PUBLIC_API_URL || "https://ej-production-production.up.railway.app"}/api/projects`)
      .then((res) => res.json())
      .then((json) => {
        setProjects(json);
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
        setAssignedTig(p.assigned_tig || 0);
        setAssignedMig(p.assigned_mig || 0);
        setAssignedGrinders(p.assigned_grinders || 0);
        setBellows(p.bellows?.map((b: any) => ({ size: b.size, qty: b.quantity })) || []);
        fetchDuration(id, p.assigned_tig || 0, p.assigned_mig || 0, p.assigned_grinders || 0);
      }
    } else {
      setBellows([]);
      setDuration(null);
    }
  };

  const fetchDuration = (id: string, tig: number, mig: number, grind: number) => {
    fetch(`${process.env.NEXT_PUBLIC_API_URL || "https://ej-production-production.up.railway.app"}/api/projects/duration`, {
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
    .then(data => setDuration(data.estimated_duration_days))
    .catch(() => {});
  };

  useEffect(() => {
    if (selectedProjectId) {
      fetchDuration(selectedProjectId, assignedTig, assignedMig, assignedGrinders);
    }
  }, [assignedTig, assignedMig, assignedGrinders, selectedProjectId]);

  const handleAddBellow = () => {
    setBellows([...bellows, { size: "", qty: 1 }]);
  };

  const handleRemoveBellow = (index: number) => {
    setBellows(bellows.filter((_, i) => i !== index));
  };

  const handleBellowChange = (index: number, field: "size" | "qty", value: string | number) => {
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
      const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL || "https://ej-production-production.up.railway.app"}/api/projects/${selectedProjectId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          status,
          assigned_tig: assignedTig,
          assigned_mig: assignedMig,
          assigned_grinders: assignedGrinders
        })
      });

      const validBellows = bellows.filter(b => b.size && b.qty > 0).map(b => ({
        size: Number(b.size),
        qty: Number(b.qty)
      }));

      await fetch(`${process.env.NEXT_PUBLIC_API_URL || "https://ej-production-production.up.railway.app"}/api/projects/${selectedProjectId}/bellows`, {
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
      const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL || "https://ej-production-production.up.railway.app"}/api/projects/${selectedProjectId}`, {
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
                    <option value="Completed">Completed</option>
                  </select>
                  <p className="text-xs text-slate-500 mt-1">Marking as 'Completed' removes it from the capacity pipeline.</p>
                </div>
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
                  <h3 className="text-lg font-medium text-slate-800">Edit Expansion Joints</h3>
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
                      <div className="flex-1">
                        <label className="block text-sm font-medium text-slate-700 mb-1">Size (NB)</label>
                        <select
                          className="w-full px-4 py-2 rounded-lg border border-slate-300 focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 bg-white text-black"
                          value={bellow.size}
                          onChange={(e) => handleBellowChange(index, "size", e.target.value)}
                          required
                        >
                          <option value="">Select Size</option>
                          {sizes.map((s) => (
                            <option key={s} value={s}>{s} NB</option>
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
