"use client";

import { useEffect, useRef, useState } from "react";
import { apiFetch } from "@/lib/api";

const API = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8003";

interface ProjectContext {
  quotation_no: string;
  project_name: string;
  client_name?: string | null;
  status?: string | null;
  target_date?: string | null;
}

interface MailButtonProps {
  projectContext: ProjectContext;
}

export default function MailButton({ projectContext }: MailButtonProps) {
  const [recipients, setRecipients] = useState<Record<string, string>>({});
  const [selected, setSelected] = useState<string[]>([]);
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    apiFetch(`${API}/api/v1/notifications/mail-recipients`)
      .then((r) => (r.ok ? r.json() : {}))
      .then((data) => setRecipients(data))
      .catch(() => {});
  }, []);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    function handleOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleOutside);
    return () => document.removeEventListener("mousedown", handleOutside);
  }, [open]);

  const recipientList = Object.entries(recipients); // [["GM", "gm@org.com"], ...]

  if (recipientList.length === 0) return null;

  function buildMailtoLink(toEmails: string[]): string {
    const subject = encodeURIComponent(
      `Re: [EJ Tracker] Project: ${projectContext.quotation_no} — ${projectContext.project_name}`
    );
    const body = encodeURIComponent(
      `Project: ${projectContext.project_name}\n` +
        `Quotation: ${projectContext.quotation_no}\n` +
        `Client: ${projectContext.client_name || "—"}\n` +
        `Status: ${projectContext.status || "—"}\n` +
        `Target Date: ${projectContext.target_date || "—"}\n\n` +
        `[Your message here]`
    );
    return `mailto:${toEmails.join(",")}?subject=${subject}&body=${body}`;
  }

  function handleSend() {
    const toEmails = selected.map((role) => recipients[role]).filter(Boolean);
    if (!toEmails.length) return;
    window.open(buildMailtoLink(toEmails), "_blank");
    setOpen(false);
    setSelected([]);
  }

  // Single recipient — direct mailto anchor, no picker needed
  if (recipientList.length === 1) {
    const [[, email]] = recipientList;
    return (
      <a
        href={buildMailtoLink([email])}
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex items-center gap-1 rounded border border-line bg-paper-raised px-2 py-1 text-xs text-ink transition-colors hover:opacity-90"
      >
        <svg
          className="h-3 w-3"
          fill="none"
          stroke="currentColor"
          strokeWidth={2}
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"
          />
        </svg>
        Send Mail
      </a>
    );
  }

  // 2+ recipients — button + dropdown with checkboxes
  return (
    <div className="relative inline-block" ref={containerRef}>
      <button
        onClick={() => setOpen((v) => !v)}
        className="inline-flex items-center gap-1 rounded border border-line bg-paper-raised px-2 py-1 text-xs text-ink transition-colors hover:opacity-90"
      >
        <svg
          className="h-3 w-3"
          fill="none"
          stroke="currentColor"
          strokeWidth={2}
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"
          />
        </svg>
        Send Mail
      </button>

      {open && (
        <div className="absolute right-0 top-8 z-40 w-52 space-y-2 rounded-lg border border-line bg-paper p-3 shadow-xl">
          <p className="text-xs font-semibold uppercase tracking-wide text-ink-soft">Send to</p>
          {recipientList.map(([role]) => (
            <label key={role} className="flex cursor-pointer items-center gap-2">
              <input
                type="checkbox"
                checked={selected.includes(role)}
                onChange={(e) =>
                  setSelected((prev) =>
                    e.target.checked ? [...prev, role] : prev.filter((r) => r !== role)
                  )
                }
                className="rounded border-line"
              />
              <span className="text-sm text-ink">{role}</span>
            </label>
          ))}
          <button
            disabled={selected.length === 0}
            onClick={handleSend}
            className="mt-1 w-full rounded bg-brand px-2 py-1.5 text-xs font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-40"
          >
            Open in Outlook
          </button>
        </div>
      )}
    </div>
  );
}
