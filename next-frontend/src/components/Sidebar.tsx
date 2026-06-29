"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";

export default function Sidebar() {
  const pathname = usePathname();
  const router = useRouter();
  const [role, setRole] = useState<string | null>(null);
  const [accessModules, setAccessModules] = useState<string[]>([]);

  useEffect(() => {
    const userRole = localStorage.getItem("user_role");
    const storedModules = localStorage.getItem("access_modules");
    if (!userRole) {
      router.push("/");
    } else {
      setRole(userRole);
      if (storedModules) {
        try {
          setAccessModules(JSON.parse(storedModules));
        } catch (e) {
          setAccessModules([]);
        }
      }
    }
  }, [router]);

  const hasAccess = (moduleName: string) => {
    if (role === 'Developer' || role === 'GM') return true;
    return accessModules.includes(moduleName);
  };

  const handleLogout = () => {
    localStorage.removeItem("user_role");
    localStorage.removeItem("access_modules");
    router.push("/");
  };

  return (
    <div className="w-64 h-screen bg-slate-900 text-slate-300 flex flex-col shadow-xl fixed left-0 top-0">
      <div className="p-6 border-b border-slate-800">
        <h2 className="text-2xl font-bold text-white tracking-tight">EJ Tracker</h2>
        {role && (
          <div className="mt-2 text-xs font-medium px-2 py-1 bg-indigo-500/20 text-indigo-300 rounded border border-indigo-500/30 inline-block">
            {role}
          </div>
        )}
      </div>
      
      <div className="flex-1 overflow-y-auto py-6">
        <nav className="space-y-1 px-3">
          {hasAccess('progress_dashboard') && <Link href="/dashboard" className="flex items-center space-x-3 px-4 py-3 rounded-lg text-slate-300 hover:bg-slate-800 hover:text-white transition-colors">
            <span>Progress Dashboard</span>
          </Link>}
          {hasAccess('wip_tracking') && <Link href="/dashboard/wip" className="flex items-center space-x-3 px-4 py-3 rounded-lg text-slate-300 hover:bg-slate-800 hover:text-white transition-colors">
            <span>WIP Tracking Center</span>
          </Link>}
          {hasAccess('executive_dashboard') && <Link href="/dashboard/executive" className="flex items-center space-x-3 px-4 py-3 rounded-lg text-slate-300 hover:bg-slate-800 hover:text-white transition-colors">
            <span>Executive Dashboard</span>
          </Link>}
          {hasAccess('planning_dashboard') && <Link href="/dashboard/planning" className="flex items-center space-x-3 px-4 py-3 rounded-lg text-slate-300 hover:bg-slate-800 hover:text-white transition-colors">
            <span>Planning Dashboard</span>
          </Link>}
          {hasAccess('holds') && <Link href="/dashboard/holds" className="flex items-center space-x-3 px-4 py-3 rounded-lg text-slate-300 hover:bg-slate-800 hover:text-white transition-colors">
            <span>Hold Center</span>
          </Link>}
          {hasAccess('workforce') && <Link href="/workforce" className="flex items-center space-x-3 px-4 py-3 rounded-lg text-slate-300 hover:bg-slate-800 hover:text-white transition-colors">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z"></path></svg>
            <span>Workforce Intelligence</span>
          </Link>}
          {hasAccess('scheduler') && <Link href="/scheduler" className="flex items-center space-x-3 px-4 py-3 rounded-lg text-slate-300 hover:bg-slate-800 hover:text-white transition-colors">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z"></path></svg>
            <span>Daily Scheduler</span>
          </Link>}
          {hasAccess('projects') && <Link href="/projects" className="flex items-center space-x-3 px-4 py-3 rounded-lg text-slate-300 hover:bg-slate-800 hover:text-white transition-colors">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 002-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10"></path></svg>
            <span>Projects</span>
          </Link>}
          {hasAccess('edit_projects') && <Link href="/projects/edit" className="flex items-center space-x-3 px-4 py-3 rounded-lg text-slate-300 hover:bg-slate-800 hover:text-white transition-colors">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"></path></svg>
            <span>Edit Projects</span>
          </Link>}
          {hasAccess('shop_floor') && <Link href="/production/entry" className="flex items-center space-x-3 px-4 py-3 rounded-lg text-slate-300 hover:bg-slate-800 hover:text-white transition-colors">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 6V4m0 2a2 2 0 100 4m0-4a2 2 0 110 4m-6 8a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4m6 6v10m6-2a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4"></path></svg>
            <span>Shop Floor Input</span>
          </Link>}
          {hasAccess('dispatch') && <Link href="/dispatch" className="flex items-center space-x-3 px-4 py-3 rounded-lg text-slate-300 hover:bg-slate-800 hover:text-white transition-colors">
            <span>Dispatch Log</span>
          </Link>}
          {hasAccess('qc_inspection') && <Link href="/inspection" className="flex items-center space-x-3 px-4 py-3 rounded-lg text-slate-300 hover:bg-slate-800 hover:text-white transition-colors">
            <span>QC Inspection</span>
          </Link>}
          {hasAccess('master') && <Link href="/master" className="flex items-center space-x-3 px-4 py-3 rounded-lg text-slate-300 hover:bg-slate-800 hover:text-white transition-colors">
            <span>Production & Capacity Master</span>
          </Link>}
          {hasAccess('inventory') && <Link href="/inventory" className="flex items-center space-x-3 px-4 py-3 rounded-lg text-emerald-400 hover:bg-slate-800 transition-colors">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4"></path></svg>
            <span className="font-bold">Material Intelligence</span>
          </Link>}
          {hasAccess('users') && <Link href="/operators" className="flex items-center space-x-3 px-4 py-3 rounded-lg text-slate-300 hover:bg-slate-800 hover:text-white transition-colors">
            <span>User Management</span>
          </Link>}
          {hasAccess('audit') && <Link href="/audit" className="flex items-center space-x-3 px-4 py-3 rounded-lg text-slate-300 hover:bg-slate-800 hover:text-white transition-colors">
            <span>System Audit Logs</span>
          </Link>}
        </nav>
      </div>

      <div className="p-4 border-t border-slate-800">
        <button
          onClick={handleLogout}
          className="w-full flex items-center justify-center px-4 py-2 border border-transparent text-sm font-medium rounded-md text-slate-300 bg-slate-800 hover:bg-red-500/10 hover:text-red-400 hover:border-red-500/30 transition-all"
        >
          Sign Out
        </button>
      </div>
    </div>
  );
}
