"use client";
import { apiFetch } from "@/lib/api";

import { useEffect, useState } from "react";
export default function MasterData() {
  const [userRole, setUserRole] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState("welding");
  const [data, setData] = useState<any[]>([]);
  const [workforce, setWorkforce] = useState<any[]>([]);
  const [pool, setPool] = useState<any>({ total_tig_welders: 0, total_mig_welders: 0, total_grinders: 0 });
  const [loading, setLoading] = useState(true);
  const [syncingEJ, setSyncingEJ] = useState(false);
  const [syncingDJ, setSyncingDJ] = useState(false);
  const [syncingAll, setSyncingAll] = useState(false);
  const [message, setMessage] = useState("");

  const fetchData = () => {
    setLoading(true);
    Promise.all([
      apiFetch(`${process.env.NEXT_PUBLIC_API_URL || "http://localhost:8003"}/api/v1/master/welding`).then(r => r.json()),
      apiFetch(`${process.env.NEXT_PUBLIC_API_URL || "http://localhost:8003"}/api/v1/master/workforce`).then(r => r.json()),
      apiFetch(`${process.env.NEXT_PUBLIC_API_URL || "http://localhost:8003"}/api/v1/master/pool`).then(r => r.json())
    ]).then(([weldingRes, workforceRes, poolRes]) => {
      setData(weldingRes.data || []);
      setWorkforce(workforceRes.data || []);
      setPool(poolRes.data || { total_tig_welders: 0, total_mig_welders: 0, total_grinders: 0 });
      setLoading(false);
    });
  };

  useEffect(() => {
    setUserRole(localStorage.getItem("user_role"));
    fetchData();
  }, []);

  const handleSyncEJ = async () => {
    setSyncingEJ(true);
    setMessage("");
    try {
      const res = await apiFetch(`${process.env.NEXT_PUBLIC_API_URL || "http://localhost:8003"}/api/v1/master/sync/ej`, { method: "POST" });
      const json = await res.json();
      if (!res.ok) throw new Error(json.detail);
      setMessage("EJ " + json.message);
      fetchData();
    } catch (err: any) {
      setMessage("Error syncing EJ: " + err.message);
    } finally {
      setSyncingEJ(false);
    }
  };

  const handleSyncDJ = async () => {
    setSyncingDJ(true);
    setMessage("");
    try {
      const res = await apiFetch(`${process.env.NEXT_PUBLIC_API_URL || "http://localhost:8003"}/api/v1/master/sync/dj`, { method: "POST" });
      const json = await res.json();
      if (!res.ok) throw new Error(json.detail);
      setMessage("DJ " + json.message);
      fetchData();
    } catch (err: any) {
      setMessage("Error syncing DJ: " + err.message);
    } finally {
      setSyncingDJ(false);
    }
  };

  const handleSyncAll = async () => {
    setSyncingAll(true);
    setMessage("");
    try {
      const res = await apiFetch(`${process.env.NEXT_PUBLIC_API_URL || "http://localhost:8003"}/api/v1/master/sync/all`, { method: "POST" });
      const json = await res.json();
      if (!res.ok) throw new Error(json.detail);
      setMessage(json.message);
      fetchData();
    } catch (err: any) {
      setMessage("Error syncing all data: " + err.message);
    } finally {
      setSyncingAll(false);
    }
  };

  const updateWorkforce = async (id: number, productivity: number) => {
    await apiFetch(`${process.env.NEXT_PUBLIC_API_URL || "http://localhost:8003"}/api/v1/master/workforce/${id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ productivity })
    });
    alert("Workforce productivity updated");
    fetchData();
  };

  const updatePool = async (e: React.FormEvent) => {
    e.preventDefault();
    await apiFetch(`${process.env.NEXT_PUBLIC_API_URL || "http://localhost:8003"}/api/v1/master/pool`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(pool)
    });
    alert("Company resource pool updated");
    fetchData();
  };

  if (loading) return <div className="text-slate-500">Loading master data...</div>;

  return (
    <div className="max-w-6xl mx-auto">
      <h1 className="text-3xl font-bold text-slate-900 mb-2">Production & Capacity Master</h1>
      <p className="text-slate-500 mb-8">Manage the algorithm's base constants, master data, and total company resources.</p>

      <div className="flex space-x-4 mb-6 border-b border-slate-200">
        <button onClick={() => setActiveTab('welding')} className={`pb-2 px-1 font-medium ${activeTab === 'welding' ? 'text-indigo-600 border-b-2 border-indigo-600' : 'text-slate-500 hover:text-slate-700'}`}>Welding Workload Engine</button>
        <button onClick={() => setActiveTab('workforce')} className={`pb-2 px-1 font-medium ${activeTab === 'workforce' ? 'text-indigo-600 border-b-2 border-indigo-600' : 'text-slate-500 hover:text-slate-700'}`}>Workforce Master</button>
        <button onClick={() => setActiveTab('pool')} className={`pb-2 px-1 font-medium ${activeTab === 'pool' ? 'text-indigo-600 border-b-2 border-indigo-600' : 'text-slate-500 hover:text-slate-700'}`}>Company Resource Pool</button>
      </div>

      {activeTab === 'welding' && (
        <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6">
          <div className="flex justify-between items-center mb-6">
            <div>
              <h2 className="text-lg font-semibold text-slate-800">Welding Master Data</h2>
              <p className="text-sm text-slate-500">Base configuration for expansion joint sizes.</p>
            </div>
            {(userRole === "Developer" || userRole === "GM") && (
              <div className="flex gap-2">
                <button
                  onClick={handleSyncAll}
                  disabled={syncingEJ || syncingDJ || syncingAll}
                  className="bg-purple-600 hover:bg-purple-700 text-white px-4 py-2 rounded-lg font-medium shadow-sm transition-colors disabled:opacity-50"
                >
                  {syncingAll ? "Syncing Both..." : "Sync All Data"}
                </button>
                <button
                  onClick={handleSyncEJ}
                  disabled={syncingEJ || syncingDJ || syncingAll}
                  className="bg-indigo-600 hover:bg-indigo-700 text-white px-4 py-2 rounded-lg font-medium shadow-sm transition-colors disabled:opacity-50"
                >
                  {syncingEJ ? "Syncing EJ..." : "Sync EJ Data"}
                </button>
                <button
                  onClick={handleSyncDJ}
                  disabled={syncingEJ || syncingDJ || syncingAll}
                  className="bg-teal-600 hover:bg-teal-700 text-white px-4 py-2 rounded-lg font-medium shadow-sm transition-colors disabled:opacity-50"
                >
                  {syncingDJ ? "Syncing DJ..." : "Sync DJ Data"}
                </button>
              </div>
            )}
          </div>
          
          {message && (
            <div className={`mb-6 p-4 rounded-lg border ${message.startsWith('Error') ? 'bg-red-50 text-red-700 border-red-200' : 'bg-green-50 text-green-700 border-green-200'}`}>
              {message}
            </div>
          )}

          {(userRole === "Developer" || userRole === "GM") ? (
            <div className="space-y-8">
              
              {/* Expansion Joints Table */}
              <div>
                <h3 className="text-md font-bold text-slate-800 mb-3 border-l-4 border-indigo-600 pl-2">Expansion Joints</h3>
                <div className="overflow-x-auto">
                  <table className="min-w-full divide-y divide-slate-200 border border-slate-200">
                    <thead className="bg-slate-50">
                      <tr>
                        <th className="px-4 py-3 text-left text-xs font-medium text-slate-500 uppercase">Size (NB)</th>
                        <th className="px-4 py-3 text-left text-xs font-medium text-slate-500 uppercase">TIG (ft)</th>
                        <th className="px-4 py-3 text-left text-xs font-medium text-slate-500 uppercase">MIG (ft)</th>
                        <th className="px-4 py-3 text-left text-xs font-medium text-slate-500 uppercase">Grinding (sq ft)</th>
                      </tr>
                    </thead>
                    <tbody className="bg-white divide-y divide-slate-200">
                      {data.filter(r => r.type === 'EJ').map((row) => (
                        <tr key={`EJ-${row.size}`} className="hover:bg-slate-50">
                          <td className="px-4 py-3 text-sm font-medium text-slate-900">{row.size}</td>
                          <td className="px-4 py-3 text-sm text-slate-600">{row.tig_feet}</td>
                          <td className="px-4 py-3 text-sm text-slate-600">{row.mig_feet}</td>
                          <td className="px-4 py-3 text-sm text-slate-600">{row.grinding_feet}</td>
                        </tr>
                      ))}
                      {data.filter(r => r.type === 'EJ').length === 0 && (
                        <tr>
                          <td colSpan={4} className="px-4 py-8 text-center text-slate-500 text-sm">
                            No Expansion Joint records found. Please sync data.
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Dismantling Joints Table */}
              <div>
                <h3 className="text-md font-bold text-slate-800 mb-3 border-l-4 border-teal-600 pl-2">Dismantling Joints</h3>
                <div className="overflow-x-auto">
                  <table className="min-w-full divide-y divide-slate-200 border border-slate-200">
                    <thead className="bg-slate-50">
                      <tr>
                        <th className="px-4 py-3 text-left text-xs font-medium text-slate-500 uppercase">Size (NB)</th>
                        <th className="px-4 py-3 text-left text-xs font-medium text-slate-500 uppercase">Welding Feet</th>
                      </tr>
                    </thead>
                    <tbody className="bg-white divide-y divide-slate-200">
                      {data.filter(r => r.type === 'DJ').map((row) => (
                        <tr key={`DJ-${row.size}`} className="hover:bg-slate-50">
                          <td className="px-4 py-3 text-sm font-medium text-slate-900">{row.size}</td>
                          <td className="px-4 py-3 text-sm text-slate-600">{row.tig_feet}</td>
                        </tr>
                      ))}
                      {data.filter(r => r.type === 'DJ').length === 0 && (
                        <tr>
                          <td colSpan={2} className="px-4 py-8 text-center text-slate-500 text-sm">
                            No Dismantling Joint records found. Please sync data.
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>

            </div>
          ) : (
            <div className="p-8 text-center bg-slate-50 rounded-lg border border-slate-200">
              <svg className="mx-auto h-12 w-12 text-slate-400 mb-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
              </svg>
              <h3 className="text-lg font-medium text-slate-900">Access Restricted</h3>
              <p className="mt-2 text-sm text-slate-500">You do not have permission to view the raw welding master data. Sync operations are permitted if authorized.</p>
            </div>
          )}
        </div>
      )}

      {activeTab === 'workforce' && (
        <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6">
          <h2 className="text-lg font-semibold text-slate-800 mb-6">Base Productivity (ft/hour)</h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {workforce.map(w => (
              <div key={w.id} className="border border-slate-200 p-4 rounded-lg">
                <label className="block text-sm font-medium text-slate-700 mb-2">{w.resource_type}</label>
                <div className="flex gap-2">
                  <input
                    type="number"
                    className="w-full px-3 py-2 border border-slate-300 rounded-md text-black bg-white"
                    value={w.productivity}
                    onChange={(e) => {
                      const newWf = [...workforce];
                      const idx = newWf.findIndex(x => x.id === w.id);
                      newWf[idx].productivity = parseFloat(e.target.value) || 0;
                      setWorkforce(newWf);
                    }}
                  />
                  <button onClick={() => updateWorkforce(w.id, w.productivity)} className="bg-indigo-600 text-white px-4 py-2 rounded-md font-medium text-sm">Save</button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {activeTab === 'pool' && (
        <form onSubmit={updatePool} className="bg-white rounded-xl shadow-sm border border-slate-200 p-6">
          <h2 className="text-lg font-semibold text-slate-800 mb-6">Company Resource Pool</h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-6">
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-2">Total TIG Welders</label>
              <input
                type="number"
                min="0"
                required
                className="w-full px-4 py-2 border border-slate-300 rounded-lg text-black bg-white"
                value={pool.total_tig_welders}
                onChange={(e) => setPool({...pool, total_tig_welders: parseInt(e.target.value) || 0})}
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-2">Total MIG Welders</label>
              <input
                type="number"
                min="0"
                required
                className="w-full px-4 py-2 border border-slate-300 rounded-lg text-black bg-white"
                value={pool.total_mig_welders}
                onChange={(e) => setPool({...pool, total_mig_welders: parseInt(e.target.value) || 0})}
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-2">Total Grinders</label>
              <input
                type="number"
                min="0"
                required
                className="w-full px-4 py-2 border border-slate-300 rounded-lg text-black bg-white"
                value={pool.total_grinders}
                onChange={(e) => setPool({...pool, total_grinders: parseInt(e.target.value) || 0})}
              />
            </div>
          </div>
          <button type="submit" className="bg-indigo-600 text-white px-6 py-2 rounded-lg font-medium">Save Pool Settings</button>
        </form>
      )}
    </div>
  );
}
