# Executive Dashboard & CEO/MD Roles — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **Prerequisite:** Plan `2026-07-26-completion-workflow-notifications.md` must be fully implemented and deployed first. This plan depends on `email_service.py` and the notifications infrastructure from that plan.

**Goal:** Add CEO and MD as new read-only roles with their own login credentials; build a real executive dashboard at `/dashboard/executive` (replacing the existing stub) showing financial KPIs + project table; add in-app `mailto:` mail button for CEO/MD/GM/PM.

**Architecture:** Two new env-var-based roles (CEO, MD) added to RBAC and auth router; new `GET /api/v1/dashboard/executive` endpoint exposes financial data (order value, advance, dispatch dates) gated to EXECUTIVES; existing stub page `/dashboard/executive/page.tsx` gets real data wired in; `MailButton` component generates `mailto:` links using recipient emails fetched from the already-built `/api/v1/notifications/mail-recipients` endpoint.

**Tech Stack:** Python/FastAPI, SQLAlchemy, PostgreSQL, Next.js/TSX, existing `apiFetch`/`MetricCard`/`Table`/`ProgressBar`/`Badge` design system.

## Global Constraints

- PostgreSQL only — no SQLite.
- Push to `demo` branch only; never merge to `main` without user approval.
- CEO and MD are **read-only** — never add them to write endpoints.
- Start backend: `python -m uvicorn backend.main:app --port 8003 --reload`
- Start frontend: `npm --prefix next-frontend run dev`
- Build check: `npm --prefix next-frontend run build` (must pass 0 TS errors)
- `py_compile` check after every Python file change.
- No `alert()`/`confirm()`/`prompt()` in frontend.
- No runtime Tailwind class interpolation.

---

## File Map

**Modify (backend):**
- `backend/app/auth/router.py` — add CEO/MD credential checks in login endpoint
- `backend/app/auth/rbac.py` — add EXECUTIVES role group, update MANAGEMENT + SUPERVISORS
- `backend/app/dashboard/router.py` — add `GET /api/v1/dashboard/executive` endpoint

**Modify (frontend):**
- `next-frontend/src/app/(main)/dashboard/executive/page.tsx` — replace stub with real data
- `next-frontend/src/components/Sidebar.tsx` — restrict write-only nav items from CEO/MD

**Create (frontend):**
- `next-frontend/src/components/MailButton.tsx` — `mailto:` link generator with recipient picker

---

## Task 1: CEO/MD RBAC + Auth

**Files:**
- Modify: `backend/app/auth/rbac.py`
- Modify: `backend/app/auth/router.py`

**Interfaces:**
- Produces: `EXECUTIVES = ["CEO", "MD"]` importable from `backend.app.auth.rbac`; CEO/MD users can log in and receive JWT tokens with their respective roles

- [ ] **Step 1: Update rbac.py**

Open `backend/app/auth/rbac.py`. Replace the role groups block (lines 40–42):

```python
# Before:
MANAGEMENT = ["Developer", "GM", "Admin", "Production Manager"]
SUPERVISORS = MANAGEMENT + ["Supervisor"]
USER_ADMINS = ["Developer", "GM", "Production Manager"]

# After:
EXECUTIVES = ["CEO", "MD"]
MANAGEMENT = ["Developer", "GM", "Admin", "Production Manager"] + EXECUTIVES
SUPERVISORS = MANAGEMENT + ["Supervisor"]
USER_ADMINS = ["Developer", "GM", "Production Manager"]
```

- [ ] **Step 2: Update auth/router.py — add CEO/MD login checks**

In `backend/app/auth/router.py`, find the login endpoint (around line 80). Add two new elif blocks after the PM check and before the `if not role:` fallback:

```python
    elif req.username == os.getenv("CEO_USER") and req.password == os.getenv("CEO_PASS"):
        role = "CEO"
    elif req.username == os.getenv("MD_USER") and req.password == os.getenv("MD_PASS"):
        role = "MD"
```

- [ ] **Step 3: Syntax check**

```bash
python -m py_compile backend/app/auth/rbac.py
python -m py_compile backend/app/auth/router.py
```

- [ ] **Step 4: Start server and test login**

```bash
python -m uvicorn backend.main:app --port 8003 --reload
```

In a terminal, set temp env vars and test (replace with real values or add to .env):
```bash
CEO_USER=ceo CEO_PASS=test123 python -m uvicorn backend.main:app --port 8003
curl -X POST http://localhost:8003/api/v1/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username": "ceo", "password": "test123"}'
```

Expected: response contains `access_token` and the JWT decodes to `role: "CEO"`.

- [ ] **Step 5: Add Railway env vars**

In Railway (demo + main), add:
- `CEO_USER`, `CEO_PASS`
- `MD_USER`, `MD_PASS`
- `CEO_EMAIL`, `MD_EMAIL`

- [ ] **Step 6: Commit**

```bash
git add backend/app/auth/rbac.py backend/app/auth/router.py
git commit -m "feat: add CEO and MD roles to RBAC and login auth"
```

---

## Task 2: Executive Dashboard Backend Endpoint

**Files:**
- Modify: `backend/app/dashboard/router.py`

**Interfaces:**
- Produces: `GET /api/v1/dashboard/executive` — role: EXECUTIVES only
- Returns: `{ kpis: {...}, projects: [...] }`

- [ ] **Step 1: Add EXECUTIVES import to dashboard router**

In `backend/app/dashboard/router.py`, add to the RBAC import line:
```python
from backend.app.auth.rbac import require_roles, SUPERVISORS, MANAGEMENT, EXECUTIVES
```

- [ ] **Step 2: Add executive endpoint**

Append to `backend/app/dashboard/router.py`:

```python
from datetime import date as date_type

@router.get("/executive")
def executive_dashboard(
    db: Session = Depends(get_db),
    user=Depends(require_roles(EXECUTIVES + ["Developer"])),
):
    from backend.services.db_service import Project, ProjectProductionLine, Part, PartProcess, ProjectCompletionRequest

    today = date_type.today()

    projects = db.query(Project).all()

    total_active = sum(1 for p in projects if p.status == "Active")
    total_on_hold = sum(1 for p in projects if p.status == "Hold")
    total_completed = sum(1 for p in projects if p.status == "Completed")
    pipeline_value = sum((p.order_value or 0) for p in projects if p.status != "Completed")
    on_time = sum(
        1 for p in projects
        if p.status == "Active" and p.committed_dispatch_date and p.committed_dispatch_date >= today
    )
    delayed = sum(
        1 for p in projects
        if p.status == "Active" and p.committed_dispatch_date and p.committed_dispatch_date < today
    )

    # Per-project progress: avg(completed_qty / total_qty) across PartProcesses
    project_rows = []
    for p in projects:
        line_ids = [l.id for l in db.query(ProjectProductionLine.id).filter_by(project_id=p.id).all()]
        part_ids = [pt.id for pt in db.query(Part.id).filter(Part.production_line_id.in_(line_ids)).all()] if line_ids else []
        processes = db.query(PartProcess).filter(PartProcess.part_id.in_(part_ids)).all() if part_ids else []

        if processes:
            progress = round(
                sum(min(pp.completed_qty / pp.part.total_qty, 1.0) if pp.part and pp.part.total_qty else 0 for pp in processes)
                / len(processes)
                * 100
            )
        else:
            progress = 100 if p.status == "Completed" else 0

        pending_req = db.query(ProjectCompletionRequest).filter_by(project_id=p.id, status="pending").first()

        project_rows.append({
            "id": p.id,
            "quotation_no": p.quotation_no,
            "project_name": p.project_name,
            "client_name": p.client_name,
            "status": p.status,
            "order_value": p.order_value,
            "advance_received": p.advance_received,
            "committed_dispatch_date": p.committed_dispatch_date.isoformat() if p.committed_dispatch_date else None,
            "target_date": p.target_date.isoformat() if p.target_date else None,
            "progress_pct": progress,
            "completion_request_status": "pending" if pending_req else None,
        })

    return {
        "kpis": {
            "total_active": total_active,
            "total_on_hold": total_on_hold,
            "total_completed": total_completed,
            "pipeline_value": pipeline_value,
            "on_time": on_time,
            "delayed": delayed,
        },
        "projects": project_rows,
    }
```

- [ ] **Step 3: Syntax check**

```bash
python -m py_compile backend/app/dashboard/router.py
```

- [ ] **Step 4: Start server and test endpoint (as Developer role)**

```bash
python -m uvicorn backend.main:app --port 8003 --reload
# Get a Developer token first, then:
curl http://localhost:8003/api/v1/dashboard/executive \
  -H "Authorization: Bearer <token>" | python -m json.tool
```

Expected: JSON with `kpis` and `projects` arrays.

- [ ] **Step 5: Commit**

```bash
git add backend/app/dashboard/router.py
git commit -m "feat: add executive dashboard endpoint with KPIs and financial project data"
```

---

## Task 3: MailButton Component

**Files:**
- Create: `next-frontend/src/components/MailButton.tsx`

**Interfaces:**
- Consumes: `GET /api/v1/notifications/mail-recipients` (from Plan A); accepts `projectContext: { quotation_no, project_name, client_name, status, target_date }`
- Produces: `<MailButton projectContext={...} />` — opens Outlook compose window via `mailto:`

- [ ] **Step 1: Create MailButton.tsx**

```tsx
"use client";

import { useEffect, useState } from "react";
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

  useEffect(() => {
    apiFetch(`${API}/api/v1/notifications/mail-recipients`)
      .then((r) => r.ok ? r.json() : {})
      .then((data) => setRecipients(data))
      .catch(() => {});
  }, []);

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

  if (recipientList.length === 1) {
    // Single recipient — just a direct link, no picker needed
    const [[, email]] = recipientList;
    return (
      <a
        href={buildMailtoLink([email])}
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex items-center gap-1 rounded border border-line bg-paper-raised px-2 py-1 text-xs text-ink hover:bg-paper-raised/80 transition-colors"
      >
        <svg className="w-3 h-3" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
        </svg>
        Send Mail
      </a>
    );
  }

  return (
    <div className="relative inline-block">
      <button
        onClick={() => setOpen((v) => !v)}
        className="inline-flex items-center gap-1 rounded border border-line bg-paper-raised px-2 py-1 text-xs text-ink hover:bg-paper-raised/80 transition-colors"
      >
        <svg className="w-3 h-3" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
        </svg>
        Send Mail
      </button>

      {open && (
        <div className="absolute right-0 top-8 z-40 w-52 rounded-lg border border-line bg-paper shadow-xl p-3 space-y-2">
          <p className="text-xs font-semibold text-ink-soft uppercase tracking-wide">Send to</p>
          {recipientList.map(([role]) => (
            <label key={role} className="flex items-center gap-2 cursor-pointer">
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
            className="w-full mt-1 rounded bg-brand px-2 py-1.5 text-xs font-semibold text-white disabled:opacity-40 hover:opacity-90 transition-opacity"
          >
            Open in Outlook
          </button>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Build check**

```bash
npm --prefix next-frontend run build
```

- [ ] **Step 3: Commit**

```bash
git add next-frontend/src/components/MailButton.tsx
git commit -m "feat: add MailButton component with mailto: link and recipient picker"
```

---

## Task 4: Executive Dashboard Page (Replace Stub)

**Files:**
- Modify: `next-frontend/src/app/(main)/dashboard/executive/page.tsx`

**Interfaces:**
- Consumes: `GET /api/v1/dashboard/executive`; `MetricCard`, `ProgressBar`, `Badge`, `Spinner`, `Table`, `THead`, `TBody`, `Tr`, `Th`, `Td` from design system; `MailButton` from `@/components/MailButton`

- [ ] **Step 1: Replace executive/page.tsx content**

```tsx
"use client";
import { apiFetch } from "@/lib/api";
import { useState, useEffect } from "react";
import { MetricCard, ProgressBar, Badge, Spinner, Table, THead, TBody, Tr, Th, Td } from "@/components/ui";
import MailButton from "@/components/MailButton";

const API = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8003";

interface Kpis {
  total_active: number;
  total_on_hold: number;
  total_completed: number;
  pipeline_value: number;
  on_time: number;
  delayed: number;
}

interface ProjectRow {
  id: number;
  quotation_no: string;
  project_name: string | null;
  client_name: string | null;
  status: string;
  order_value: number | null;
  advance_received: number | null;
  committed_dispatch_date: string | null;
  target_date: string | null;
  progress_pct: number;
  completion_request_status: string | null;
}

function fmt(n: number | null): string {
  if (n == null) return "—";
  return "₹" + n.toLocaleString("en-IN");
}

export default function ExecutiveDashboard() {
  const [kpis, setKpis] = useState<Kpis | null>(null);
  const [projects, setProjects] = useState<ProjectRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<"all" | "active" | "delayed" | "completed">("all");

  useEffect(() => {
    apiFetch(`${API}/api/v1/dashboard/executive`)
      .then((r) => r.json())
      .then((data) => {
        setKpis(data.kpis);
        setProjects(data.projects);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  if (loading) return <Spinner label="Loading executive view…" />;
  if (!kpis) return <p className="text-ink-soft text-sm">Failed to load data.</p>;

  const filtered = projects.filter((p) => {
    if (filter === "active") return p.status === "Active";
    if (filter === "delayed") return p.status === "Active" && p.committed_dispatch_date && new Date(p.committed_dispatch_date) < new Date();
    if (filter === "completed") return p.status === "Completed";
    return true;
  });

  return (
    <div className="flex flex-col gap-8">
      <div>
        <h1 className="font-display text-3xl font-extrabold uppercase tracking-wide text-ink">Executive Dashboard</h1>
        <p className="text-ink-soft">Full project and financial overview.</p>
      </div>

      {/* KPI Row */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6">
        <MetricCard label="Active Projects" value={String(kpis.total_active)} tone="neutral" />
        <MetricCard label="Pipeline Value" value={fmt(kpis.pipeline_value)} tone="neutral" />
        <MetricCard label="On Time" value={String(kpis.on_time)} tone="success" />
        <MetricCard label="Delayed" value={String(kpis.delayed)} tone="critical" />
        <MetricCard label="On Hold" value={String(kpis.total_on_hold)} tone="warning" />
        <MetricCard label="Completed" value={String(kpis.total_completed)} tone="neutral" />
      </div>

      {/* Filter chips */}
      <div className="flex gap-2 flex-wrap">
        {(["all", "active", "delayed", "completed"] as const).map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`rounded-full border px-3 py-1 text-xs font-semibold capitalize transition-colors ${
              filter === f
                ? "border-brand bg-brand/10 text-brand"
                : "border-line bg-paper-raised text-ink-soft hover:text-ink"
            }`}
          >
            {f === "all" ? `All (${projects.length})` : f === "active" ? `Active (${kpis.total_active})` : f === "delayed" ? `Delayed (${kpis.delayed})` : `Completed (${kpis.total_completed})`}
          </button>
        ))}
      </div>

      {/* Projects Table */}
      <Table>
        <THead>
          <Tr>
            <Th>Quotation</Th>
            <Th>Project</Th>
            <Th>Client</Th>
            <Th>Status</Th>
            <Th numeric>Order Value</Th>
            <Th numeric>Advance</Th>
            <Th>Dispatch Date</Th>
            <Th numeric>Progress</Th>
            <Th>Mail</Th>
          </Tr>
        </THead>
        <TBody>
          {filtered.length === 0 && (
            <Tr>
              <Td colSpan={9}>
                <p className="text-center text-ink-soft text-sm py-4">No projects found.</p>
              </Td>
            </Tr>
          )}
          {filtered.map((p) => {
            const isDelayed =
              p.status === "Active" &&
              p.committed_dispatch_date &&
              new Date(p.committed_dispatch_date) < new Date();
            return (
              <Tr key={p.id}>
                <Td><span className="font-mono text-xs">{p.quotation_no}</span></Td>
                <Td>{p.project_name || "—"}</Td>
                <Td>{p.client_name || "—"}</Td>
                <Td>
                  <Badge
                    tone={
                      p.status === "Completed" ? "success"
                        : p.status === "Hold" ? "warning"
                        : isDelayed ? "critical"
                        : "neutral"
                    }
                  >
                    {p.status === "Active" && isDelayed ? "Delayed" : p.status}
                  </Badge>
                </Td>
                <Td numeric>{fmt(p.order_value)}</Td>
                <Td numeric>
                  {p.advance_received != null ? `${p.advance_received}%` : "—"}
                </Td>
                <Td>
                  {p.committed_dispatch_date
                    ? <span className={isDelayed ? "text-rose-600 font-medium" : ""}>
                        {new Date(p.committed_dispatch_date).toLocaleDateString("en-IN")}
                      </span>
                    : "—"}
                </Td>
                <Td numeric>
                  <div className="flex items-center gap-2">
                    <ProgressBar value={p.progress_pct} tone={p.progress_pct >= 80 ? "success" : p.progress_pct >= 40 ? "warning" : "critical"} />
                    <span className="text-xs text-ink-soft w-8 text-right">{p.progress_pct}%</span>
                  </div>
                </Td>
                <Td>
                  <MailButton
                    projectContext={{
                      quotation_no: p.quotation_no,
                      project_name: p.project_name || "",
                      client_name: p.client_name,
                      status: p.status,
                      target_date: p.target_date,
                    }}
                  />
                </Td>
              </Tr>
            );
          })}
        </TBody>
      </Table>
    </div>
  );
}
```

- [ ] **Step 2: Build check**

```bash
npm --prefix next-frontend run build
```

Expected: 0 TS errors.

- [ ] **Step 3: Dev server visual check**

```bash
npm --prefix next-frontend run dev
```

Log in as Developer (has EXECUTIVES access). Navigate to `/dashboard/executive`. Confirm:
- 6 KPI cards show real data
- Filter chips work
- Table rows show financial columns
- "Send Mail" column appears with `MailButton`

- [ ] **Step 4: Commit**

```bash
git add next-frontend/src/app/(main)/dashboard/executive/page.tsx
git commit -m "feat: replace executive dashboard stub with real KPI and financial data"
```

---

## Task 5: Sidebar — Restrict Write Actions from CEO/MD + Add MailButton to Projects Page

**Files:**
- Modify: `next-frontend/src/components/Sidebar.tsx`
- Modify: `next-frontend/src/app/(main)/projects/page.tsx`

- [ ] **Step 1: Update Sidebar role restrictions**

In `next-frontend/src/components/Sidebar.tsx`, the `SUP` constant currently restricts items from Supervisor + Operator. CEO/MD are read-only — they should also not see write-only nav items like "Add Project" and "Edit Project".

Change:
```tsx
const SUP = ["Supervisor", "Operator"]; // shorthand for management-only items
```

To:
```tsx
const SUP = ["Supervisor", "Operator", "CEO", "MD"]; // read-only roles excluded from write actions
```

This automatically applies `hideForRoles: SUP` to "Add Project", "Edit Project", "Settings", "System Audit Logs", and any other items already using `SUP`.

- [ ] **Step 2: Add MailButton to projects list page for GM/PM**

In `next-frontend/src/app/(main)/projects/page.tsx`, add import:
```tsx
import MailButton from "@/components/MailButton";
```

In the expanded project row (alongside the existing "Mark as Complete" logic added in Plan A Task 9), add MailButton for GM and PM roles:

```tsx
{(userRole === "GM" || userRole === "Production Manager") && (
  <div className="mt-2">
    <MailButton
      projectContext={{
        quotation_no: p.quotation_no,
        project_name: p.project_name || "",
        status: p.status,
        target_date: p.target_date,
      }}
    />
  </div>
)}
```

- [ ] **Step 3: Build check**

```bash
npm --prefix next-frontend run build
```

- [ ] **Step 4: Dev test**

1. Log in as CEO → confirm "Add Project" and "Edit Project" not visible in sidebar
2. Log in as GM → confirm "Send Mail" button appears in expanded project row → click → recipient picker opens → select PM → "Open in Outlook" → confirm mailto link pre-fills correctly

- [ ] **Step 5: Commit**

```bash
git add next-frontend/src/components/Sidebar.tsx next-frontend/src/app/(main)/projects/page.tsx
git commit -m "feat: restrict CEO/MD from write nav items; add MailButton to projects page"
```

---

## Task 6: End-to-End Test + Railway Deploy

- [ ] **Step 1: Full flow test (dev)**

1. Set `CEO_USER=ceo CEO_PASS=test123` in local `.env` → log in as CEO → confirm `/dashboard/executive` loads with real KPIs
2. CEO on executive page → click "Send Mail" → picker shows GM and PM → select GM → "Open in Outlook" → confirm mailto opens with project context pre-filled
3. GM on projects page → "Send Mail" → picker shows PM only → confirm mailto link is correct
4. Log in as CEO → confirm cannot navigate to `/projects/add` directly (route should 403 or redirect — RouteGuard handles this via role check)

- [ ] **Step 2: Build check**

```bash
npm --prefix next-frontend run build
python -m py_compile backend/app/auth/rbac.py backend/app/auth/router.py backend/app/dashboard/router.py
```

- [ ] **Step 3: Push to demo**

```bash
git push origin demo
```

- [ ] **Step 4: Verify on Railway demo**

1. Log in as CEO on Railway demo URL → confirm executive dashboard loads
2. Confirm KPI numbers match active project count
3. Click "Send Mail" → Outlook opens with correct pre-filled content
4. Confirm CEO cannot access Add Project page

- [ ] **Step 5: Final commit if any fixes needed**

```bash
git add -p
git commit -m "fix: <describe fix>"
git push origin demo
```
