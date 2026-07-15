"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";

interface NavItem {
  name: string;
  href: string;
  hideForRoles?: string[];
}

interface NavGroup {
  label: string;
  items: NavItem[];
}

const NAV_GROUPS: NavGroup[] = [
  {
    label: "Dashboards",
    items: [
      { name: "Progress", href: "/dashboard" },
      { name: "Executive", href: "/dashboard/executive" },
      { name: "Planning", href: "/dashboard/planning" },
      { name: "WIP Tracking", href: "/dashboard/wip" },
    ],
  },
  {
    label: "Projects & Scheduling",
    items: [
      { name: "All Projects", href: "/projects" },
      { name: "Add Project", href: "/projects/add" },
      { name: "Edit Project", href: "/projects/edit" },
      { name: "Daily Scheduler", href: "/scheduler" },
      { name: "Hold Center", href: "/dashboard/holds" },
    ],
  },
  {
    label: "Production",
    items: [
      { name: "Shop Floor Entry", href: "/production/entry" },
      { name: "Visual Tracking", href: "/production/kanban" },
      { name: "QC Inspection", href: "/inspection" },
      { name: "Dispatch Log", href: "/dispatch" },
    ],
  },
  {
    label: "Workforce",
    items: [
      { name: "Workforce Intelligence", href: "/workforce" },
      { name: "User Management", href: "/operators" },
    ],
  },
  {
    label: "Master Data & Admin",
    items: [
      { name: "Production & Capacity Master", href: "/master" },
      { name: "System Audit Logs", href: "/audit", hideForRoles: ["Production Manager", "GM"] },
    ],
  },
  {
    label: "Procurement",
    items: [
      { name: "Dashboard", href: "/procurement" },
      { name: "Purchase Orders", href: "/procurement/po" },
      { name: "Vendors", href: "/procurement/vendors" },
      { name: "Warehouse Stock", href: "/procurement/stock" },
      { name: "Settings", href: "/procurement/settings" },
    ],
  },
];

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

  const handleLogout = () => {
    localStorage.removeItem("user_role");
    router.push("/");
  };

  return (
    <div className="fixed left-0 top-0 flex h-screen w-64 flex-col bg-ink text-[#d7e3e0] shadow-xl">
      <div className="border-b border-white/10 p-6">
        <h2 className="font-display uppercase tracking-wide text-xl font-extrabold text-white">
          EJ Tracker
        </h2>
        {role && (
          <div className="mt-2 inline-block rounded border border-brand/40 bg-brand/20 px-2 py-1 text-xs font-medium text-[#9fd6d0]">
            {role}
          </div>
        )}
      </div>

      <nav className="flex-1 overflow-y-auto py-3">
        {NAV_GROUPS.map((group) => {
          const visibleItems = group.items.filter((item) => !item.hideForRoles?.includes(role || ""));
          if (visibleItems.length === 0) return null;

          return (
            <div key={group.label} className="mb-1">
              <div className="font-data px-4 pb-1 pt-3 text-[10px] uppercase tracking-widest text-[#8fa39e]">
                {group.label}
              </div>
              {visibleItems.map((item) => {
                const active = pathname === item.href;
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    className={`flex items-center gap-2.5 border-l-2 px-4 py-2 text-sm transition-colors ${
                      active
                        ? "border-brand bg-white/5 font-semibold text-white"
                        : "border-transparent text-[#d7e3e0] hover:bg-white/5 hover:text-white"
                    }`}
                  >
                    <span
                      className={`h-1.5 w-1.5 flex-none rounded-full ${active ? "bg-brand" : "bg-[#5c6e69]"}`}
                    />
                    {item.name}
                  </Link>
                );
              })}
            </div>
          );
        })}
      </nav>

      <div className="border-t border-white/10 p-4">
        <button
          onClick={handleLogout}
          className="w-full rounded-md border border-transparent bg-white/5 px-4 py-2 text-sm font-medium text-[#d7e3e0] transition-colors hover:border-critical/30 hover:bg-critical/10 hover:text-[#e8a99b]"
        >
          Sign Out
        </button>
      </div>
    </div>
  );
}
