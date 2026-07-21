"use client";

import { useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";

// Pages Supervisors cannot access — redirect to their hub.
// All other roles are unrestricted by this guard (backend enforces via 403).
const BLOCKED_FOR_SUPERVISOR = [
  "/projects/add",
  "/projects/edit",
  "/master",
  "/operators",
  "/audit",
  "/procurement/settings",
  "/dashboard/executive",
  "/dashboard/planning",
];

export default function RouteGuard({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();

  useEffect(() => {
    const role = localStorage.getItem("user_role");
    if (role !== "Supervisor") return;
    if (BLOCKED_FOR_SUPERVISOR.some((p) => pathname.startsWith(p))) {
      router.replace("/supervisor");
    }
  }, [pathname, router]);

  return <>{children}</>;
}
