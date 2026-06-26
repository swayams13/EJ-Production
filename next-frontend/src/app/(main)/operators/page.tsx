"use client";

import { useState, useEffect } from "react";

export default function OperatorsPage() {
  const [operators, setOperators] = useState<any[]>([]);
  
  // New Operator Form
  const [username, setUsername] = useState("");
  const [fullName, setFullName] = useState("");
  const [password, setPassword] = useState("");
  
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  const fetchOperators = () => {
    fetch(`${process.env.NEXT_PUBLIC_API_URL || "http://localhost:4500"}/api/users`)
      .then(res => res.json())
      .then(data => setOperators(data.filter((u: any) => u.role === "Operator")))
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
      const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL || "http://localhost:4500"}/api/users`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          username,
          full_name: fullName,
          password,
          role: "Operator"
        })
      });

      if (!res.ok) {
        const errData = await res.json();
        throw new Error(errData.detail || "Failed to create operator");
      }

      setSuccess("Operator profile created successfully!");
      setUsername("");
      setFullName("");
      setPassword("");
      
      // Refresh the list
      fetchOperators();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSubmitting(false);
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
            <div className="bg-slate-50 px-6 py-4 border-b border-slate-100">
              <h2 className="text-xl font-bold text-slate-800">Add Operator</h2>
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
                <div>
                  <label className="block text-sm font-bold text-slate-700 mb-1 uppercase tracking-wide">Username *</label>
                  <input type="text" required value={username} onChange={e => setUsername(e.target.value)}
                    className="w-full border border-slate-300 rounded-lg px-3 py-2 text-black focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-all shadow-sm" placeholder="e.g. jdoe_weld" />
                </div>
                <div>
                  <label className="block text-sm font-bold text-slate-700 mb-1 uppercase tracking-wide">Password *</label>
                  <input type="password" required value={password} onChange={e => setPassword(e.target.value)}
                    className="w-full border border-slate-300 rounded-lg px-3 py-2 text-black focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-all shadow-sm" placeholder="Set a password" />
                </div>
                
                <div className="pt-2">
                  <button type="submit" disabled={submitting} 
                    className="w-full bg-blue-600 hover:bg-blue-700 text-white py-3 rounded-xl font-bold shadow-md transition-all disabled:opacity-50 uppercase tracking-wide">
                    {submitting ? "Saving..." : "Create Profile"}
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
                      <p className="text-slate-500 text-sm font-medium">Username: @{op.username}</p>
                    </div>
                  </div>
                  <span className="bg-slate-100 text-slate-600 border border-slate-200 px-3 py-1 rounded-lg text-xs font-bold uppercase tracking-wider">
                    {op.role}
                  </span>
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
