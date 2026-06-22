"use client";

import { useEffect, useState } from "react";
export default function MasterData() {
  const [userRole, setUserRole] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState("welding");
  const [data, setData] = useState<any[]>([]);
  const [workforce, setWorkforce] = useState<any[]>([]);
  const [pool, setPool] = useState<any>({ total_tig_welders: 0, total_mig_welders: 0, total_grinders: 0 });
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [message, setMessage] = useState("");

  const fetchData = () => {
    setLoading(true);
    Promise.all([
      fetch(`${process.env.NEXT_PUBLIC_API_URL || "https://ej-production-production.up.railway.app"}/api/master/welding`).then(r => r.json()),
      fetch(`${process.env.NEXT_PUBLIC_API_URL || "https://ej-production-production.up.railway.app"}/api/master/workforce`).then(r => r.json()),
      fetch(`${process.env.NEXT_PUBLIC_API_URL || "https://ej-production-production.up.railway.app"}/api/master/pool`).then(r => r.json())
    ]).then(([weldingData, wfData, poolData]) => {
      setData(weldingData);
      setWorkforce(wfData);
      setPool(poolData);
      setLoading(false);
    });
  };

  useEffect(() => {
    setUserRole(localStorage.getItem("user_role"));
    fetchData();
  }, []);

  const handleSync = async () => {
    setSyncing(true);
    setMessage("");
    try {
      const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL || "https://ej-production-production.up.railway.app"}/api/master/sync`, { method: "POST" });
      const json = await res.json();
      if (!res.ok) throw new Error(json.detail);
      setMessage(json.message);
      fetchData();
    } catch (err: any) {
      setMessage("Error: " + err.message);
    } finally {
      setSyncing(false);
    }
  };

  const updateWorkforce = async (id: number, productivity: number) => {
    await fetch(`${process.env.NEXT_PUBLIC_API_URL || "https://ej-production-production.up.railway.app"}/api/master/workforce/${id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ productivity })
    });
    alert("Workforce productivity updated");
    fetchData();
  };

  const updatePool = async (e: React.FormEvent) => {
    e.preventDefault();
    await fetch(`${process.env.NEXT_PUBLIC_API_URL || "https://ej-production-production.up.railway.app"}/api/master/pool`, {
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
              <button
                onClick={handleSync}
                disabled={syncing}
                className="bg-indigo-600 hover:bg-indigo-700 text-white px-4 py-2 rounded-lg font-medium shadow-sm transition-colors disabled:opacity-50"
              >
                {syncing ? "Syncing..." : "Sync Latest from Server"}
              </button>
            )}
          </div>
          
          {message && (
            <div className={`mb-6 p-4 rounded-lg border ${message.startsWith('Error') ? 'bg-red-50 text-red-700 border-red-200' : 'bg-green-50 text-green-700 border-green-200'}`}>
              {message}
            </div>
          )}

          {(userRole === "Developer" || userRole === "GM") ? (
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-slate-200 border border-slate-200">
                <thead className="bg-slate-50">
                  <tr>
                    <th className="px-4 py-3 text-left text-xs font-medium text-slate-500 uppercase">Size (NB)</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-slate-500 uppercase">TIG (ft)</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-slate-500 uppercase">MIG (ft)</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-slate-500 uppercase">Grinding (ft)</th>
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-slate-200">
                  {data.map((row) => (
                    <tr key={row.size} className="hover:bg-slate-50">
                      <td className="px-4 py-3 text-sm font-medium text-slate-900">{row.size}</td>
                      <td className="px-4 py-3 text-sm text-slate-600">{row.tig_feet}</td>
                      <td className="px-4 py-3 text-sm text-slate-600">{row.mig_feet}</td>
                      <td className="px-4 py-3 text-sm text-slate-600">{row.grinding_feet}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
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
          <h2 className="text-lg font-semibold text-slate-800 mb-6">Base Productivity (ft/day)</h2>
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
