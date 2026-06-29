"use client";
import { apiFetch } from "@/lib/api";
import { useState, useEffect } from "react";

const AVAILABLE_MODULES = [
  { id: 'progress_dashboard', label: 'Progress Dashboard' },
  { id: 'wip_tracking', label: 'WIP Tracking Center' },
  { id: 'executive_dashboard', label: 'Executive Dashboard' },
  { id: 'planning_dashboard', label: 'Planning Dashboard' },
  { id: 'holds', label: 'Hold Center' },
  { id: 'workforce', label: 'Workforce Intelligence' },
  { id: 'scheduler', label: 'Daily Scheduler' },
  { id: 'projects', label: 'Projects' },
  { id: 'edit_projects', label: 'Edit Projects' },
  { id: 'shop_floor', label: 'Shop Floor Input' },
  { id: 'dispatch', label: 'Dispatch Log' },
  { id: 'qc_inspection', label: 'QC Inspection' },
  { id: 'master', label: 'Production & Capacity Master' },
  { id: 'inventory', label: 'Material Intelligence' },
  { id: 'users', label: 'User Management' },
  { id: 'audit', label: 'System Audit Logs' },
];

export default function OperatorsPage() {
  const [users, setUsers] = useState<any[]>([]);
  
  // New User Form
  const [fullName, setFullName] = useState("");
  const [role, setRole] = useState("Operator");
  const [department, setDepartment] = useState("Welding");
  const [skill, setSkill] = useState("TIG Welder");
  const [experience, setExperience] = useState("");
  const [baseProductivity, setBaseProductivity] = useState("");
  
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  // Permissions Modal
  const [selectedUser, setSelectedUser] = useState<any>(null);
  const [userModules, setUserModules] = useState<string[]>([]);
  const [savingPerms, setSavingPerms] = useState(false);

  const fetchUsers = () => {
    apiFetch(`${process.env.NEXT_PUBLIC_API_URL || "http://localhost:4500"}/api/v1/users`)
      .then(res => res.json())
      .then(resData => setUsers(resData.data))
      .catch(err => console.error("Failed to fetch users:", err));
  };

  useEffect(() => {
    fetchUsers();
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setError("");
    setSuccess("");

    try {
      const res = await apiFetch(`${process.env.NEXT_PUBLIC_API_URL || "http://localhost:4500"}/api/v1/users`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          full_name: fullName,
          role: role,
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
        throw new Error(errMsg || "Failed to create user");
      }

      setSuccess("User profile created successfully!");
      setFullName("");
      setExperience("");
      setBaseProductivity("");
      
      fetchUsers();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  };

  const openPermissionsModal = (user: any) => {
    setSelectedUser(user);
    try {
      setUserModules(JSON.parse(user.access_modules || "[]"));
    } catch {
      setUserModules([]);
    }
  };

  const toggleModule = (moduleId: string) => {
    setUserModules(prev => 
      prev.includes(moduleId) ? prev.filter(m => m !== moduleId) : [...prev, moduleId]
    );
  };

  const savePermissions = async () => {
    setSavingPerms(true);
    try {
      const res = await apiFetch(`${process.env.NEXT_PUBLIC_API_URL || "http://localhost:4500"}/api/v1/users/${selectedUser.id}/permissions`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ access_modules: JSON.stringify(userModules) })
      });
      if (!res.ok) throw new Error("Failed to save permissions");
      
      setSuccess(`Permissions updated for ${selectedUser.name}`);
      setSelectedUser(null);
      fetchUsers();
    } catch (err: any) {
      alert(err.message);
    } finally {
      setSavingPerms(false);
    }
  };

  return (
    <div className="max-w-5xl mx-auto mb-20 px-4">
      <div className="bg-slate-900 p-8 text-white rounded-b-3xl shadow-lg mb-8 mx-[-2rem] mt-[-2rem]">
        <h1 className="text-4xl font-extrabold text-white tracking-tight">User Management</h1>
        <p className="text-slate-300 mt-2 text-lg font-medium">Manage system users, operators, and dynamic access permissions.</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
        {/* Add User Form */}
        <div className="md:col-span-1">
          <div className="bg-white rounded-2xl shadow-xl shadow-slate-200/50 border border-slate-100 overflow-hidden">
            <div className="bg-slate-50 px-6 py-4 border-b border-slate-100">
              <h2 className="text-xl font-bold text-slate-800">Add User</h2>
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
                  <label className="block text-sm font-bold text-slate-700 mb-1 uppercase tracking-wide">Role *</label>
                  <select value={role} onChange={e => setRole(e.target.value)} className="w-full border border-slate-300 rounded-lg px-3 py-2 text-black shadow-sm">
                    <option value="Operator">Operator</option>
                    <option value="Admin">Admin</option>
                    <option value="Production Manager">Production Manager</option>
                    <option value="GM">GM</option>
                  </select>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-bold text-slate-700 mb-1 uppercase tracking-wide">Dept</label>
                    <select value={department} onChange={e => setDepartment(e.target.value)} className="w-full border border-slate-300 rounded-lg px-3 py-2 text-black shadow-sm">
                      <option value="Management">Management</option>
                      <option value="Welding">Welding</option>
                      <option value="Grinding">Grinding</option>
                      <option value="Assembly">Assembly</option>
                      <option value="Painting">Painting</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-sm font-bold text-slate-700 mb-1 uppercase tracking-wide">Skill</label>
                    <select value={skill} onChange={e => setSkill(e.target.value)} className="w-full border border-slate-300 rounded-lg px-3 py-2 text-black shadow-sm">
                      <option value="">None</option>
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
                    {submitting ? "Saving..." : "Create Profile"}
                  </button>
                </div>
              </form>
            </div>
          </div>
        </div>

        {/* List of Users */}
        <div className="md:col-span-2">
          <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
            <div className="bg-slate-800 px-6 py-4 flex justify-between items-center">
              <h2 className="text-xl font-bold text-white">Active System Users</h2>
              <span className="bg-slate-700 text-white px-3 py-1 rounded-full text-sm font-bold">{users.length} Total</span>
            </div>
            
            <div className="divide-y divide-slate-100">
              {users.map(u => (
                <div key={u.id} className="p-6 flex items-center justify-between hover:bg-slate-50 transition-colors">
                  <div className="flex items-center gap-4">
                    <div className="w-12 h-12 rounded-full bg-blue-100 text-blue-600 flex items-center justify-center font-black text-xl border border-blue-200">
                      {u.name.charAt(0).toUpperCase()}
                    </div>
                    <div>
                      <h3 className="font-bold text-slate-900 text-lg">{u.name} <span className="ml-2 bg-slate-100 text-slate-600 border border-slate-200 px-2 py-0.5 rounded-lg text-xs font-bold uppercase tracking-wider">{u.role}</span></h3>
                      <p className="text-slate-500 text-sm font-medium">@{u.username} • {u.department || 'No Dept'}</p>
                    </div>
                  </div>
                  <div className="text-right">
                    <button onClick={() => openPermissionsModal(u)} className="text-sm font-bold text-indigo-600 hover:text-indigo-800 bg-indigo-50 hover:bg-indigo-100 px-4 py-2 rounded-lg transition-colors border border-indigo-200">
                      Manage Access
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Permissions Modal */}
      {selectedUser && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-2xl max-w-2xl w-full max-h-[90vh] overflow-hidden flex flex-col">
            <div className="px-6 py-4 border-b border-slate-200 flex justify-between items-center bg-slate-50">
              <h3 className="text-xl font-bold text-slate-800">Permissions: {selectedUser.name}</h3>
              <button onClick={() => setSelectedUser(null)} className="text-slate-400 hover:text-slate-600">
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12"></path></svg>
              </button>
            </div>
            
            <div className="p-6 overflow-y-auto flex-1">
              <p className="text-slate-600 mb-6 text-sm">Toggle the specific modules this user is allowed to access. Note: Developers and GMs have full access bypasses.</p>
              
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {AVAILABLE_MODULES.map(mod => (
                  <label key={mod.id} className="flex items-center space-x-3 p-3 border border-slate-200 rounded-xl hover:bg-slate-50 cursor-pointer transition-colors">
                    <input 
                      type="checkbox" 
                      checked={userModules.includes(mod.id)}
                      onChange={() => toggleModule(mod.id)}
                      className="w-5 h-5 text-indigo-600 rounded border-slate-300 focus:ring-indigo-500"
                    />
                    <span className="font-medium text-slate-800">{mod.label}</span>
                  </label>
                ))}
              </div>
            </div>
            
            <div className="px-6 py-4 border-t border-slate-200 bg-slate-50 flex justify-end gap-3">
              <button onClick={() => setSelectedUser(null)} className="px-4 py-2 text-sm font-bold text-slate-600 hover:text-slate-800 bg-white border border-slate-300 rounded-lg shadow-sm">
                Cancel
              </button>
              <button onClick={savePermissions} disabled={savingPerms} className="px-4 py-2 text-sm font-bold text-white bg-indigo-600 hover:bg-indigo-700 rounded-lg shadow-sm disabled:opacity-50">
                {savingPerms ? 'Saving...' : 'Save Permissions'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
