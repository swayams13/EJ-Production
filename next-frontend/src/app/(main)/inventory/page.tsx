"use client";
import { useState, useEffect } from "react";
import { apiFetch } from "@/lib/api";

export default function InventoryPage() {
  const [inventory, setInventory] = useState<any[]>([]);
  const [shortages, setShortages] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState("");

  const [isAdding, setIsAdding] = useState(false);
  const [newMaterial, setNewMaterial] = useState({
    material_name: "Bellows",
    size: 150,
    joint_type: "EJ",
    current_stock: 0,
    minimum_required_stock: 10
  });

  const fetchData = async () => {
    setLoading(true);
    try {
      const invRes = await apiFetch(`${process.env.NEXT_PUBLIC_API_URL || "http://localhost:8003"}/api/v1/inventory`);
      if (invRes.ok) {
        const data = await invRes.json();
        setInventory(data);
      }
      
      const shortRes = await apiFetch(`${process.env.NEXT_PUBLIC_API_URL || "http://localhost:8003"}/api/v1/inventory/shortages`);
      if (shortRes.ok) {
        const data = await shortRes.json();
        setShortages(data);
      }
    } catch (err: any) {
      setErrorMsg("Failed to fetch inventory data.");
    }
    setLoading(false);
  };

  useEffect(() => {
    fetchData();
  }, []);

  const handleAddSubmit = async (e: any) => {
    e.preventDefault();
    try {
      const res = await apiFetch(`${process.env.NEXT_PUBLIC_API_URL || "http://localhost:8003"}/api/v1/inventory`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(newMaterial)
      });
      if (res.ok) {
        setIsAdding(false);
        fetchData();
      } else {
        const err = await res.json();
        setErrorMsg(err.detail || "Failed to add inventory.");
      }
    } catch (err) {
      setErrorMsg("Error saving inventory.");
    }
  };

  const handleDelete = async (id: number) => {
    if (!confirm("Remove this material entry?")) return;
    try {
      await apiFetch(`${process.env.NEXT_PUBLIC_API_URL || "http://localhost:8003"}/api/v1/inventory/${id}`, { method: "DELETE" });
      fetchData();
    } catch (err) {}
  };

  if (loading) return <div className="p-8 text-slate-500 font-medium">Loading Material Intelligence Engine...</div>;

  return (
    <div className="max-w-7xl mx-auto mb-20 space-y-8">
      {/* Header */}
      <div className="bg-slate-900 p-8 text-white rounded-b-3xl shadow-lg mx-[-2rem] mt-[-2rem] flex justify-between items-center">
        <div>
          <h1 className="text-3xl font-extrabold text-white tracking-tight mb-2">Material Intelligence</h1>
          <p className="text-slate-300 text-lg font-medium">Track raw materials and prevent production blockages.</p>
        </div>
        <button
          onClick={() => setIsAdding(!isAdding)}
          className="bg-blue-600 hover:bg-blue-700 text-white px-5 py-2.5 rounded-lg font-bold shadow transition-colors flex items-center gap-2"
        >
          {isAdding ? "Cancel" : "Add/Update Stock"}
        </button>
      </div>

      {errorMsg && <div className="bg-rose-100 text-rose-800 p-4 rounded-xl font-bold">{errorMsg}</div>}

      {/* Add Stock Form */}
      {isAdding && (
        <form onSubmit={handleAddSubmit} className="bg-white p-6 rounded-2xl shadow-sm border border-slate-200 grid grid-cols-1 md:grid-cols-6 gap-4 items-end">
          <div className="space-y-1">
            <label className="text-xs font-bold text-slate-500 uppercase">Material Name</label>
            <select className="w-full bg-slate-50 border border-slate-300 rounded-lg p-2 font-semibold text-black" value={newMaterial.material_name} onChange={e => setNewMaterial({...newMaterial, material_name: e.target.value})}>
              <option value="Bellows">Bellows</option>
              <option value="Collar">Collar</option>
              <option value="Flange">Flange</option>
            </select>
          </div>
          <div className="space-y-1">
            <label className="text-xs font-bold text-slate-500 uppercase">Size (NB)</label>
            <input type="number" className="w-full bg-slate-50 border border-slate-300 rounded-lg p-2 font-semibold text-black" value={newMaterial.size} onChange={e => setNewMaterial({...newMaterial, size: parseInt(e.target.value)})} />
          </div>
          <div className="space-y-1">
            <label className="text-xs font-bold text-slate-500 uppercase">Joint Type</label>
            <select className="w-full bg-slate-50 border border-slate-300 rounded-lg p-2 font-semibold text-black" value={newMaterial.joint_type} onChange={e => setNewMaterial({...newMaterial, joint_type: e.target.value})}>
              <option value="EJ">EJ</option>
              <option value="DJ">DJ</option>
            </select>
          </div>
          <div className="space-y-1">
            <label className="text-xs font-bold text-slate-500 uppercase">Current Stock</label>
            <input type="number" className="w-full bg-slate-50 border border-slate-300 rounded-lg p-2 font-semibold text-black" value={newMaterial.current_stock} onChange={e => setNewMaterial({...newMaterial, current_stock: parseInt(e.target.value)})} />
          </div>
          <div className="space-y-1">
            <label className="text-xs font-bold text-slate-500 uppercase">Minimum Req</label>
            <input type="number" className="w-full bg-slate-50 border border-slate-300 rounded-lg p-2 font-semibold text-black" value={newMaterial.minimum_required_stock} onChange={e => setNewMaterial({...newMaterial, minimum_required_stock: parseInt(e.target.value)})} />
          </div>
          <button type="submit" className="bg-emerald-600 hover:bg-emerald-700 text-white font-bold py-2 px-4 rounded-lg h-[42px]">Save</button>
        </form>
      )}

      {/* Shortage Alerts */}
      {shortages.length > 0 && (
        <div className="bg-rose-50 border-l-4 border-rose-500 p-6 rounded-r-2xl shadow-sm">
          <h2 className="text-xl font-bold text-rose-800 mb-4 flex items-center gap-2">
            ⚠️ Production Blocked: Material Shortages Detected
          </h2>
          <div className="space-y-3">
            {shortages.map((s: any, idx: number) => (
              <div key={idx} className="bg-white p-4 rounded-lg shadow-sm border border-rose-100 flex justify-between items-center">
                <div>
                  <div className="font-bold text-slate-900 text-lg">{s.project_code}</div>
                  <div className="text-slate-500 text-sm">Requires <span className="font-bold text-slate-800">{s.required_qty}x</span> {s.material_name} {s.size} NB ({s.joint_type})</div>
                </div>
                <div className="text-right">
                  <div className="text-rose-600 font-extrabold text-xl">DEFICIT: {s.deficit}</div>
                  <div className="text-xs text-slate-400">Current Stock: {s.current_stock}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Current Stock */}
      <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
        <div className="p-6 border-b border-slate-200 bg-slate-50">
          <h2 className="text-lg font-bold text-slate-800">Master Raw Material Inventory</h2>
        </div>
        <table className="min-w-full divide-y divide-slate-200">
          <thead className="bg-slate-50">
            <tr>
              <th className="px-6 py-3 text-left text-xs font-bold text-slate-500 uppercase tracking-wider">Material</th>
              <th className="px-6 py-3 text-left text-xs font-bold text-slate-500 uppercase tracking-wider">Size & Type</th>
              <th className="px-6 py-3 text-left text-xs font-bold text-slate-500 uppercase tracking-wider">Current Stock</th>
              <th className="px-6 py-3 text-left text-xs font-bold text-slate-500 uppercase tracking-wider">Status</th>
              <th className="px-6 py-3 text-right text-xs font-bold text-slate-500 uppercase tracking-wider">Actions</th>
            </tr>
          </thead>
          <tbody className="bg-white divide-y divide-slate-200">
            {inventory.map((inv: any) => {
              const isLow = inv.current_stock < inv.minimum_required_stock;
              return (
                <tr key={inv.id} className="hover:bg-slate-50">
                  <td className="px-6 py-4 whitespace-nowrap text-sm font-bold text-slate-900">{inv.material_name}</td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-slate-500">{inv.size} NB - {inv.joint_type}</td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <span className="text-lg font-extrabold text-slate-800">{inv.current_stock}</span>
                    <span className="text-xs text-slate-400 ml-2">/ Min {inv.minimum_required_stock}</span>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    {isLow ? (
                      <span className="bg-amber-100 text-amber-800 px-2 py-1 rounded-full text-xs font-bold">Low Stock</span>
                    ) : (
                      <span className="bg-emerald-100 text-emerald-800 px-2 py-1 rounded-full text-xs font-bold">Healthy</span>
                    )}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                    <button onClick={() => handleDelete(inv.id)} className="text-rose-500 hover:text-rose-700 font-bold">Delete</button>
                  </td>
                </tr>
              );
            })}
            {inventory.length === 0 && (
              <tr><td colSpan={5} className="px-6 py-12 text-center text-slate-500">No inventory tracked yet.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
