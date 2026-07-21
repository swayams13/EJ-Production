"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Card, CardBody } from "@/components/ui";

const ACTIONS = [
  {
    title: "Attendance",
    desc: "Record today's worker check-ins and mark present / absent",
    href: "/workforce",
    accent: "#3e7c77",
    tint: "#e7f1ef",
  },
  {
    title: "Work Orders",
    desc: "View, assign, and complete today's work orders",
    href: "/scheduler",
    accent: "#5c8a6c",
    tint: "#eaf2ec",
  },
  {
    title: "Shop Floor Entry",
    desc: "Log fabrication, welding, and final-check progress",
    href: "/production/entry",
    accent: "#bd8a52",
    tint: "#f6eee1",
  },
  {
    title: "Worker Productivity",
    desc: "View per-worker efficiency and footage stats",
    href: "/productivity",
    accent: "#4a7aac",
    tint: "#e5eef6",
  },
];

export default function SupervisorPortal() {
  const [today, setToday] = useState("");

  useEffect(() => {
    setToday(new Date().toLocaleDateString("en-IN", { weekday: "long", day: "numeric", month: "long", year: "numeric" }));
  }, []);

  return (
    <div className="max-w-3xl mx-auto py-10 px-4">
      <div className="mb-8">
        <h1 className="font-display text-3xl font-extrabold uppercase tracking-wide text-ink">
          Supervisor Portal
        </h1>
        {today && (
          <p className="mt-1 font-data text-sm text-ink-soft">{today}</p>
        )}
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        {ACTIONS.map((action) => (
          <Link key={action.href} href={action.href} className="group block focus:outline-none">
            <Card className="h-full transition-shadow group-hover:shadow-md">
              <CardBody className="gap-3 p-6">
                <div
                  className="inline-block rounded px-2.5 py-1 text-xs font-semibold uppercase tracking-wider"
                  style={{ backgroundColor: action.tint, color: action.accent }}
                >
                  {action.title}
                </div>
                <p className="text-sm text-ink-soft leading-relaxed">{action.desc}</p>
                <span className="mt-1 text-xs font-medium" style={{ color: action.accent }}>
                  Open &rarr;
                </span>
              </CardBody>
            </Card>
          </Link>
        ))}
      </div>

      <p className="mt-10 text-xs text-ink-soft text-center">
        Logged in as Supervisor &mdash; use the sidebar to navigate between your tools.
      </p>
    </div>
  );
}
