"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";

export default function Sidebar() {
  const pathname = usePathname();
  const router = useRouter();
  const [role, setRole] = useState<string | null>(null);

  useEffect(() => {
    const userRole = localStorage.getItem("user_role");
    if (!userRole) {
      router.push("/");
    } else {
      setRole(userRole);
    }
  }, [router]);

  const navLinks = [
    { name: "Progress Dashboard", href: "/dashboard" },
    { name: "Executive Dashboard", href: "/dashboard/executive" },
    { name: "Projects List", href: "/projects" },
    { name: "Add Projects", href: "/projects/add" },
    { name: "Edit Projects", href: "/projects/edit" },
    { name: "Production & Capacity Master", href: "/master" },
  ];

  const handleLogout = () => {
    localStorage.removeItem("user_role");
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
          <Link href="/dashboard" className="flex items-center space-x-3 px-4 py-3 rounded-lg text-slate-300 hover:bg-slate-800 hover:text-white transition-colors">
            <span>Progress Dashboard</span>
          </Link>
          <Link href="/dashboard/wip" className="flex items-center space-x-3 px-4 py-3 rounded-lg text-slate-300 hover:bg-slate-800 hover:text-white transition-colors">
            <span>WIP Tracking Center</span>
          </Link>
          <Link href="/dashboard/executive" className="flex items-center space-x-3 px-4 py-3 rounded-lg text-slate-300 hover:bg-slate-800 hover:text-white transition-colors">
            <span>Executive Dashboard</span>
          </Link>
          <Link href="/projects" className="flex items-center space-x-3 px-4 py-3 rounded-lg text-slate-300 hover:bg-slate-800 hover:text-white transition-colors">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 002-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10"></path></svg>
            <span>Projects</span>
          </Link>
          <Link href="/production/entry" className="flex items-center space-x-3 px-4 py-3 rounded-lg text-slate-300 hover:bg-slate-800 hover:text-white transition-colors">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 6V4m0 2a2 2 0 100 4m0-4a2 2 0 110 4m-6 8a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4m6 6v10m6-2a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4"></path></svg>
            <span>Shop Floor Input</span>
          </Link>
          <Link href="/master" className="flex items-center space-x-3 px-4 py-3 rounded-lg text-slate-300 hover:bg-slate-800 hover:text-white transition-colors">
            <span>Production & Capacity Master</span>
          </Link>
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
