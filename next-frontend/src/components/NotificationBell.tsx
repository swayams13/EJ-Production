"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { apiFetch } from "@/lib/api";

const API = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8003";

interface Notification {
  id: number;
  title: string;
  body: string | null;
  link: string | null;
  is_read: boolean;
  created_at: string;
}

export default function NotificationBell() {
  const router = useRouter();
  const [count, setCount] = useState(0);
  const [open, setOpen] = useState(false);
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const ref = useRef<HTMLDivElement>(null);

  const fetchCount = async () => {
    try {
      const res = await apiFetch(`${API}/api/v1/notifications/unread-count`);
      if (res.ok) {
        const data = await res.json();
        setCount(data.count ?? 0);
      }
    } catch {
      // ponytail: silent — never crash the sidebar
    }
  };

  const fetchNotifications = async () => {
    try {
      const res = await apiFetch(`${API}/api/v1/notifications/`);
      if (res.ok) {
        const data = await res.json();
        setNotifications(data);
      }
    } catch {
      // silent
    }
  };

  useEffect(() => {
    fetchCount();
    const interval = setInterval(fetchCount, 30000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    if (!open) return;
    fetchNotifications();
  }, [open]);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const markRead = async (n: Notification) => {
    try {
      await apiFetch(`${API}/api/v1/notifications/${n.id}/read`, { method: "PUT" });
      setNotifications((prev) =>
        prev.map((x) => (x.id === n.id ? { ...x, is_read: true } : x))
      );
      setCount((c) => Math.max(0, c - 1));
    } catch {
      // silent
    }
    if (n.link) router.push(n.link);
    setOpen(false);
  };

  const markAllRead = async () => {
    try {
      await apiFetch(`${API}/api/v1/notifications/read-all`, { method: "PUT" });
      setNotifications((prev) => prev.map((x) => ({ ...x, is_read: true })));
      setCount(0);
    } catch {
      // silent
    }
  };

  const badgeLabel = count > 9 ? "9+" : String(count);

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        className="relative rounded-md p-1.5 hover:bg-white/10 transition-colors"
        aria-label="Notifications"
      >
        {/* Bell SVG */}
        <svg
          xmlns="http://www.w3.org/2000/svg"
          className="h-5 w-5 text-[#d7e3e0]"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={2}
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9"
          />
        </svg>
        {count > 0 && (
          <span className="absolute -right-1 -top-1 flex h-4 min-w-[1rem] items-center justify-center rounded-full bg-rose-500 px-0.5 text-[10px] font-bold text-white leading-none">
            {badgeLabel}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 top-9 z-50 w-80 rounded-lg border border-line bg-paper-raised shadow-xl">
          <div className="flex items-center justify-between border-b border-line px-3 py-2">
            <span className="text-xs font-semibold text-ink uppercase tracking-wide">
              Notifications
            </span>
            {count > 0 && (
              <button
                onClick={markAllRead}
                className="text-xs text-brand hover:underline"
              >
                Mark all read
              </button>
            )}
          </div>
          <div className="max-h-80 overflow-y-auto">
            {notifications.length === 0 ? (
              <p className="px-4 py-6 text-center text-xs text-ink-soft">
                No notifications
              </p>
            ) : (
              notifications.map((n) => (
                <button
                  key={n.id}
                  onClick={() => markRead(n)}
                  className={`w-full border-b border-line px-3 py-2.5 text-left transition-colors hover:bg-white/5 ${
                    n.is_read ? "opacity-60" : ""
                  }`}
                >
                  <div className="flex items-start gap-2">
                    {!n.is_read && (
                      <span className="mt-1.5 h-1.5 w-1.5 flex-none rounded-full bg-brand" />
                    )}
                    <div className={n.is_read ? "" : "pl-0"}>
                      <p className="text-xs font-semibold text-ink">{n.title}</p>
                      {n.body && (
                        <p className="mt-0.5 text-xs text-ink-soft line-clamp-2">
                          {n.body}
                        </p>
                      )}
                    </div>
                  </div>
                </button>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}
