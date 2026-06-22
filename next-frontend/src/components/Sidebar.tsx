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
          {navLinks.map((link) => {
            const isActive = pathname === link.href;
            return (
              <Link
                key={link.name}
                href={link.href}
                className={`group flex items-center px-3 py-2.5 text-sm font-medium rounded-md transition-colors ${
                  isActive 
                    ? "bg-indigo-600 text-white shadow-md shadow-indigo-900/20" 
                    : "text-slate-300 hover:bg-slate-800 hover:text-white"
                }`}
              >
                {link.name}
              </Link>
            );
          })}
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
