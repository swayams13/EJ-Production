# Design: Project Completion Workflow, Notification System & Executive Dashboard

**Date:** 2026-07-26
**Scope:** Phase A (completion workflow + notifications) + Phase B (CEO/MD roles + executive dashboard + in-app mail)

---

## 1. What We're Building

Four tightly related sub-features sharing the same infrastructure:

1. **Project Completion Workflow** — PM initiates bulk-complete with checklist preview; GM approves or rejects; all child records marked complete on approval.
2. **Role-Aware Notification System** — In-app bell with badge count + automated system emails for key events across all roles.
3. **CEO/MD Roles + Executive Dashboard** — Two new read-only roles with financial visibility and a dedicated `/dashboard/executive` page.
4. **In-App Mail via `mailto:`** — CEO/MD/GM/PM can send contextual emails from the app using their own Outlook accounts; zero credential management.

---

## 2. Database Changes

### 2a. `project_completion_requests` (new table)

```sql
id                  SERIAL PRIMARY KEY
project_id          INTEGER NOT NULL REFERENCES projects(id)
requested_by        VARCHAR NOT NULL          -- PM username
requested_at        TIMESTAMP DEFAULT NOW()
status              VARCHAR DEFAULT 'pending' -- pending | approved | rejected
reviewed_by         VARCHAR                   -- GM username
reviewed_at         TIMESTAMP
rejection_reason    TEXT
```

One row per completion request per project. A new request can only be created if no `pending` row exists for that project.

### 2b. `notifications` (new table)

```sql
id           SERIAL PRIMARY KEY
for_role     VARCHAR NOT NULL    -- "GM" | "Production Manager" | "CEO" | "MD" | "Supervisor"
event_type   VARCHAR NOT NULL    -- see event table in §6
title        VARCHAR NOT NULL
body         TEXT
link         VARCHAR             -- frontend path, e.g. /projects/42
project_id   INTEGER REFERENCES projects(id) ON DELETE SET NULL
is_read      BOOLEAN DEFAULT false
created_at   TIMESTAMP DEFAULT NOW()
```

One row per (event, target role). Badge count = `COUNT(*) WHERE for_role = current_role AND is_read = false`.

---

## 3. RBAC Changes

Add two new roles to `rbac.py`:

```python
EXECUTIVES = ["CEO", "MD"]
MANAGEMENT = ["Developer", "GM", "Admin", "Production Manager"] + EXECUTIVES
SUPERVISORS = MANAGEMENT + ["Supervisor"]
```

CEO and MD are read-only — they are added to `MANAGEMENT` so they can call GET endpoints, but all write endpoints explicitly exclude them via `require_roles(["GM", "Production Manager", ...])` without including CEO/MD.

**New env vars (Railway):**
- `CEO_USER`, `CEO_PASS`, `CEO_EMAIL`
- `MD_USER`, `MD_PASS`, `MD_EMAIL`
- `GM_EMAIL`, `PM_EMAIL` (new — needed for system notification emails)
- `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS` (one org Outlook account as system sender)

Auth router gets two new credential checks following the existing pattern.

---

## 4. Backend Modules

### 4a. `backend/services/email_service.py` (new file)

Uses stdlib `smtplib` + `email` — no new packages.

```python
send_system_email(to: str | list[str], subject: str, body: str) -> None
```

Called by:
- Completion request submitted → email to GM
- Completion approved → email to PM
- Completion rejected → email to PM (includes rejection reason)

All emails go FROM the configured SMTP sender account. Subject always prefixed with `[EJ Tracker]`.

### 4b. `backend/services/notification_service.py` (new file)

```python
create_notification(db, for_role: str, event_type: str, title: str, body: str, link: str, project_id: int = None) -> None
```

Single function. Called from routers at event trigger points. No background tasks — synchronous, fires inline with the request.

### 4c. `backend/app/projects/completion.py` (new router, mounted at `/api/v1/projects`)

**Endpoints:**

| Method | Path | Role | Action |
|--------|------|------|--------|
| GET | `/{id}/completion-preview` | PM | Returns checklist: counts of PartProcess, AssemblyStep, JobFinalCheck, production lines |
| POST | `/{id}/completion-request` | PM | Creates request row, notifies GM (in-app + email), 409 if pending already exists |
| GET | `/completion-requests/pending` | GM | Lists all pending requests |
| POST | `/completion-requests/{req_id}/approve` | GM | Bulk-completes all records (see §5), notifies PM |
| POST | `/completion-requests/{req_id}/reject` | GM | Sets rejection reason, notifies PM (in-app + email) |

### 4d. `backend/app/notifications/router.py` (new module)

Also includes:

```
GET /api/v1/notifications/mail-recipients   →  GM, PM, CEO, MD
```
Returns the role-email mapping the current user is permitted to see (e.g. PM sees `{gm: "gm@org.com"}`, CEO sees `{gm: "...", pm: "..."}`). Reads from env vars server-side — email addresses are never baked into the frontend bundle. Called once on login and cached in component state.

### 4d-cont. `backend/app/notifications/router.py` (new module)

| Method | Path | Role | Action |
|--------|------|------|--------|
| GET | `/` | all | Returns notifications for current role, newest first, limit 50 |
| GET | `/unread-count` | all | Returns `{"count": N}` — polled by frontend bell |
| PUT | `/{id}/read` | all | Marks single notification read |
| PUT | `/read-all` | all | Marks all for current role read |

### 4e. `backend/app/dashboard/router.py` — new executive endpoint

```
GET /api/v1/dashboard/executive   →  EXECUTIVES only
```

Returns:
- **KPIs:** total active projects, total order value (sum of `order_value`), on-time count (`committed_dispatch_date >= today`), delayed count (`committed_dispatch_date < today AND status = Active`), on-hold count
- **Project rows:** id, quotation_no, project_name, client_name, status, order_value, advance_received, committed_dispatch_date, target_date, overall progress % (computed as `AVG(completed_qty / total_qty)` across PartProcesses), completion_request_status

Financial fields (`order_value`, `advance_received`) are already in the `projects` table but currently not returned by the projects list endpoint for non-MANAGEMENT roles. The executive endpoint exposes them explicitly — no schema change needed.

---

## 5. Bulk-Complete Logic (on GM Approval)

Single DB transaction on `POST /completion-requests/{req_id}/approve`:

```
1. PartProcess: status → "ready", completed_qty → Part.total_qty  (join part_processes → parts; set each PartProcess.completed_qty = its parent Part.total_qty)
2. AssemblyStep: status → "ready"                             (for all lines in project)
3. JobFinalCheck: status → "ready"                            (for all lines in project)
4. ProjectProductionLine: paint_status → "Completed"          (for all lines in project)
5. Project: status → "Completed"
6. ProjectCompletionRequest: status → "approved", reviewed_by, reviewed_at
7. create_notification(db, "Production Manager", "completion_approved", ...)
8. send_system_email(PM_EMAIL, "[EJ Tracker] Project Completed: {name}", ...)
```

All in one `db.commit()`. Rolls back entirely if any step fails.

---

## 6. Notification Event Table

| Event | Trigger location | Target roles | Email also? |
|-------|-----------------|--------------|-------------|
| Completion request submitted | completion router | GM | Yes → GM |
| Completion approved | completion router | PM | Yes → PM |
| Completion rejected | completion router | PM | Yes → PM (+ reason) |
| New project created | projects router | GM, CEO, MD | No |
| Project put on Hold | projects router | GM, CEO, MD | No |
| Material goes red (stock gap > 0) | dashboard/materials endpoint | GM, PM | No |
| PO received (GR created) | procurement router | PM | No |
| Work order generated | scheduler router | PM | No |

Material-red notifications are created when the `/dashboard/materials` endpoint is called and detects new red rows — not on a background schedule. Simple, no celery needed. To prevent duplicate notifications per material spec, the trigger checks: `notifications WHERE event_type = 'material_red' AND body LIKE '%{spec}%' AND created_at > NOW() - INTERVAL '24 hours'` before inserting — one alert per spec per day maximum.

---

## 7. Frontend Changes

### 7a. Notification Bell (`components/NotificationBell.tsx`)

- Placed in `Navbar.tsx` (top-right)
- Polls `GET /api/v1/notifications/unread-count` every 30 seconds
- Badge: red circle with count number, hidden if count = 0
- Click → dropdown panel: last 20 notifications, each clickable (navigates to `link`, marks read)
- "Mark all read" button at top of panel
- Uses existing `useApi` hook pattern — no new fetch infrastructure

### 7b. Completion Request Flow (PM view)

On project detail page:
- "Mark as Complete" button (visible only to PM, only if project status = Active and no pending request)
- Click → modal:
  - Title: "Review Completion Checklist"
  - Shows counts fetched from `/completion-preview`: "X part processes · Y assembly steps · Z final checks · W production lines"
  - Warning: "All records will be marked complete. This cannot be undone after GM approval."
  - [Cancel] [Submit for Approval] buttons
- On submit → POST → success toast "Completion request sent to GM"
- While pending: yellow info banner at top of project detail "Completion approval pending GM review — entries can still be logged."
- Button changes to "Completion Pending" (disabled) while request is pending

### 7c. GM Approval Panel

Added as a card in the GM dashboard (or a dedicated section on `/projects`):
- "Pending Completions" heading, only visible to GM
- Each pending request shows: project name, quotation no, requested by, requested date
- [Approve] button → confirmation dialog "This will mark all records complete for [Project Name]"
- [Reject] button → modal with text field "Reason for rejection" (required)
- After action: card disappears, success toast

### 7d. `/dashboard/executive` (new page, CEO/MD only)

Layout:
- **KPI row** (4 cards): Active Projects · Pipeline Value (₹) · On Time · Delayed
- **Projects table:** Quotation No · Project · Client · Order Value · Advance · Dispatch Date · Status · Progress · Mail

Progress shown as a percentage bar (same `ProgressBar` component already in the design system).

"Send Mail" column: opens `mailto:` link pre-filled with project context (see §7e).

Page is added to Sidebar under a new "Executive" section, visible only to CEO/MD roles.

### 7e. Send Mail (`mailto:` links)

No backend endpoint. Pure frontend `<a href="mailto:...">` links.

**Pre-fill template:**
```
To:      [recipient email from env — not exposed to frontend directly; use a /api/v1/mail-recipients endpoint returning {gm: "...", pm: "..."} for authenticated users]
Subject: Re: [EJ Tracker] Project: {quotation_no} — {project_name}
Body:    Project: {project_name}\nClient: {client_name}\nStatus: {status}\nTarget Date: {target_date}\n\n[Your message here]
```

**Recipient logic by role:**

| Sender role | Recipient options |
|-------------|-------------------|
| CEO / MD | GM only, PM only, or Both (small dropdown before generating link) |
| GM | PM |
| PM | GM |

A small `MailButton` component handles the dropdown and link generation. Clicking opens the user's Outlook (desktop or web) with the pre-filled compose window. They send from their own account.

Recipient emails are fetched once on login from `GET /api/v1/mail-recipients` (authenticated, returns only the role-email mapping the current user is allowed to see — never exposes all emails to all users).

---

## 8. Phase Split

### Phase A — Completion Workflow + Notification System
Delivers immediate operational value.

- DB: `project_completion_requests` + `notifications` migrations
- Backend: `email_service.py`, `notification_service.py`, completion router, notifications router
- Frontend: `NotificationBell`, completion modal (PM), GM approval panel, project banner
- Event triggers for: completion workflow events + new project + hold (low-effort, high-value)

### Phase B — CEO/MD Executive View + In-App Mail
Builds on Phase A's email infrastructure.

- RBAC: CEO + MD roles, env vars
- Backend: executive dashboard endpoint, `mail-recipients` endpoint, remaining notification triggers (material red, PO received, work order)
- Frontend: `/dashboard/executive` page, `MailButton` component (CEO/MD + GM + PM), sidebar entry

---

## 9. What's Deliberately Not Built

- **Real-time push (WebSocket/SSE):** 30-second poll is enough for this volume. Add when users complain about lag.
- **Notification retention/pagination beyond 50:** Irrelevant at current scale.
- **GM one-click approve from email:** Requires token-based email links. Deferred — app-login approval is sufficient.
- **Per-user notification preferences:** All events go to all relevant roles. Filtering can come later if roles report noise.
- **Background material-stock scanning:** Material-red notification fires on dashboard load. No cron/celery needed yet.
