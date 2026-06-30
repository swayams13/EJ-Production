"use client";
import { apiFetch } from "@/lib/api";

import { useState, useEffect } from "react";

export default function OperatorsPage() {
  const [operators, setOperators] = useState<any[]>([]);
  
  // New Operator Form
  const [fullName, setFullName] = useState("");
  const [department, setDepartment] = useState("Welding");
  const [skill, setSkill] = useState("TIG Welder");
  const [experience, setExperience] = useState("");
  const [baseProductivity, setBaseProductivity] = useState("");
  
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [editingId, setEditingId] = useState<number | null>(null);

  const fetchOperators = () => {
    apiFetch(`${process.env.NEXT_PUBLIC_API_URL || "http://localhost:8003"}/api/v1/users`)
      .then(res => res.json())
      .then(resData => setOperators(resData.data.filter((u: any) => u.role === "Operator")))
      .catch(err => console.error("Failed to fetch operators:", err));
  };

  useEffect(() => {
    fetchOperators();
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setError("");
    setSuccess("");

    try {
      const url = editingId 
        ? `${process.env.NEXT_PUBLIC_API_URL || "http://localhost:8003"}/api/v1/users/${editingId}`
        : `${process.env.NEXT_PUBLIC_API_URL || "http://localhost:8003"}/api/v1/users`;
      
      const res = await apiFetch(url, {
        method: editingId ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          full_name: fullName,
          role: "Operator",
          department,
          skill,
          experience,
          base_productivity: baseProductivity ? parseFloat(baseProductivity) : null
        })
      });

      if (!res.ok) {
        const errData = await res.json();
        let errMsg = errData.detail;
        if (Array.isArray(errMsg)) {
          errMsg = errMsg.map((e: any) => `${e.loc.join('.')}: ${e.msg}`).join(' | ');
        }
        throw new Error(errMsg || "Failed to save operator");
      }

      setSuccess(editingId ? "Operator updated successfully!" : "Operator profile created successfully!");
      setFullName("");
      setExperience("");
      setBaseProductivity("");
      setEditingId(null);
      
      fetchOperators();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  };

  const handleEdit = (op: any) => {
    setEditingId(op.id);
    setFullName(op.name || "");
    setDepartment(op.department || "Welding");
    setSkill(op.skill || "TIG Welder");
    setExperience(op.experience || "");
    setBaseProductivity(op.base_productivity ? op.base_productivity.toString() : "");
  };

  const handleDelete = async (id: number) => {
    if (!confirm("Are you sure you want to delete this operator?")) return;
    try {
      await apiFetch(`${process.env.NEXT_PUBLIC_API_URL || "http://localhost:8003"}/api/v1/users/${id}`, {
        method: "DELETE"
      });
      fetchOperators();
    } catch (err) {
      console.error(err);
    }
  };

  return (
    <div className="max-w-5xl mx-auto mb-20 px-4">
      <div className="bg-slate-900 p-8 text-white rounded-b-3xl shadow-lg mb-8 mx-[-2rem] mt-[-2rem]">
        <h1 className="text-4xl font-extrabold text-white tracking-tight">Operator Profiles</h1>
        <p className="text-slate-300 mt-2 text-lg font-medium">Manage shop floor operators who will log production.</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
        {/* Add Operator Form */}
        <div className="md:col-span-1">
          <div className="bg-white rounded-2xl shadow-xl shadow-slate-200/50 border border-slate-100 overflow-hidden">
            <div className="bg-slate-50 px-6 py-4 border-b border-slate-100 flex justify-between items-center">
              <h2 className="text-xl font-bold text-slate-800">{editingId ? "Edit Operator" : "Add Operator"}</h2>
              {editingId && (
                <button onClick={() => { setEditingId(null); setFullName(""); setBaseProductivity(""); setExperience(""); }} className="text-sm text-slate-500 hover:text-slate-800 font-medium">Cancel Edit</button>
              )}
            </div>
            <div className="p-6">
              {error && (
                <div className="bg-rose-50 border-l-4 border-rose-500 text-rose-700 p-3 mb-4 rounded text-sm font-medium">
                  {error}
                </div>
              )}
              {success && (
                <div className="bg-emerald-50 border-l-4 border-emerald-500 text-emerald-700 p-3 mb-4 rounded text-sm font-medium">
                  {success}
                </div>
              )}
              
              <form onSubmit={handleSubmit} className="space-y-4">
                <div>
                  <label className="block text-sm font-bold text-slate-700 mb-1 uppercase tracking-wide">Full Name *</label>
                  <input type="text" required value={fullName} onChange={e => setFullName(e.target.value)}
                    className="w-full border border-slate-300 rounded-lg px-3 py-2 text-black focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-all shadow-sm" placeholder="e.g. John Doe" />
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-bold text-slate-700 mb-1 uppercase tracking-wide">Dept *</label>
                    <select value={department} onChange={e => setDepartment(e.target.value)} className="w-full border border-slate-300 rounded-lg px-3 py-2 text-black shadow-sm">
                      <option value="Welding">Welding</option>
                      <option value="Grinding">Grinding</option>
                      <option value="Assembly">Assembly</option>
                      <option value="Painting">Painting</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-sm font-bold text-slate-700 mb-1 uppercase tracking-wide">Skill *</label>
                    <select value={skill} onChange={e => setSkill(e.target.value)} className="w-full border border-slate-300 rounded-lg px-3 py-2 text-black shadow-sm">
                      <option value="TIG Welder">TIG Welder</option>
                      <option value="MIG Welder">MIG Welder</option>
                      <option value="Grinder">Grinder</option>
                      <option value="Fitter">Fitter</option>
                    </select>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-bold text-slate-700 mb-1 uppercase tracking-wide">Experience</label>
                    <input type="text" value={experience} onChange={e => setExperience(e.target.value)}
                      className="w-full border border-slate-300 rounded-lg px-3 py-2 text-black shadow-sm" placeholder="e.g. 5 Yrs" />
                  </div>
                  <div>
                    <label className="block text-sm font-bold text-slate-700 mb-1 uppercase tracking-wide">Target/Day</label>
                    <input type="number" step="0.1" value={baseProductivity} onChange={e => setBaseProductivity(e.target.value)}
                      className="w-full border border-slate-300 rounded-lg px-3 py-2 text-black shadow-sm" placeholder="e.g. 150 ft" />
                  </div>
                </div>
                
                <div className="pt-2">
                  <button type="submit" disabled={submitting} 
                    className="w-full bg-blue-600 hover:bg-blue-700 text-white py-3 rounded-xl font-bold shadow-md transition-all disabled:opacity-50 uppercase tracking-wide">
                    {submitting ? "Saving..." : (editingId ? "Update Profile" : "Create Profile")}
                  </button>
                </div>
              </form>
            </div>
          </div>
        </div>

        {/* List of Operators */}
        <div className="md:col-span-2">
          <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
            <div className="bg-slate-800 px-6 py-4 flex justify-between items-center">
              <h2 className="text-xl font-bold text-white">Active Operators</h2>
              <span className="bg-slate-700 text-white px-3 py-1 rounded-full text-sm font-bold">{operators.length} Total</span>
            </div>
            
            <div className="divide-y divide-slate-100">
              {operators.map(op => (
                <div key={op.id} className="p-6 flex items-center justify-between hover:bg-slate-50 transition-colors">
                  <div className="flex items-center gap-4">
                    <div className="w-12 h-12 rounded-full bg-blue-100 text-blue-600 flex items-center justify-center font-black text-xl border border-blue-200">
                      {op.name.charAt(0).toUpperCase()}
                    </div>
                    <div>
                      <h3 className="font-bold text-slate-900 text-lg">{op.name}</h3>
                      <p className="text-slate-500 text-sm font-medium">@{op.username} • {op.department || 'No Dept'} • {op.skill || 'No Skill'}</p>
                    </div>
                  </div>
                  <div className="text-right flex flex-col items-end gap-2">
                    <div className="flex gap-2">
                      <button onClick={() => handleEdit(op)} className="text-blue-500 hover:text-blue-700 text-sm font-bold bg-blue-50 hover:bg-blue-100 px-3 py-1 rounded">Edit</button>
                      <button onClick={() => handleDelete(op.id)} className="text-rose-500 hover:text-rose-700 text-sm font-bold bg-rose-50 hover:bg-rose-100 px-3 py-1 rounded">Delete</button>
                    </div>
                    {op.base_productivity && (
                      <span className="text-xs font-bold text-emerald-600 mt-1">
                        Target: {op.base_productivity}/day
                      </span>
                    )}
                  </div>
                </div>
              ))}
              
              {operators.length === 0 && (
                <div className="p-8 text-center text-slate-500">
                  No operators found. Create one to get started.
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
