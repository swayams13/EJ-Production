# Executive Morning Briefing — Design Spec

**Date:** 2026-07-27
**Status:** Approved, pending implementation plan
**Extends:** `docs/superpowers/specs/2026-07-26-project-completion-notifications-executive-design.md` (Plan B — CEO/MD roles + `/dashboard/executive`)

## 1. Problem

CEO/MD currently land on `/dashboard/executive`, which shows 6 KPI cards (active, pipeline value, on-time, delayed, on-hold, completed) plus a flat project table. They want a morning-briefing experience: what happened yesterday and last week, what's scheduled today, who did what (and how much), and per-role KPIs (PM, Supervisor, Worker, GM) with simple charts. This is an extension of the existing page, not a rebuild — the existing KPI row and project table are preserved, just relocated.

## 2. Data reality (grounds every field below)

- **SJM = GM.** SJM is the GM's personal name, not a separate role. All "SJM KPIs" below are GM-role KPIs.
- Workers do not log in. Supervisors log worker output via `operator_id` on `WeldingLog`/`ProductionLog`. Worker KPIs come from feet produced/efficiency, never from login/entry activity.
- Production shop-floor writes (`part-process transaction`, `welding_logs`, paint-status, final-check, assembly-step) already write `AuditLog` with `user_id`, `username`, `action`, `table_name`, `details` (human-readable, e.g. "Added 40 feet of TIG for requirement 12"), `timestamp` — this is the primary source for the activity feed and per-person entry counts.
- Procurement (`PurchaseOrder.raised_by`, `GoodsReceipt.received_by`) and completion workflow (`ProjectCompletionRequest.requested_by`/`reviewed_by`) carry actor + timestamp but do **not** write to `AuditLog` — the briefing endpoint unions these sources itself.
- `Project` creation has no actor column today — see migration in §5.
- `/scheduler/productivity` already computes per-worker target vs actual feet + `efficiency_pct` + days worked over a date range — reused as-is for Worker KPIs.
- No charting library is installed (only `xlsx`). Charts are hand-rolled CSS/SVG, following the `dataviz` skill, matching existing design tokens (`brand`, `success`/`warning`/`critical`, no runtime Tailwind class interpolation per `docs/UI_DESIGN_SYSTEM.md`).

## 3. Page structure — 3 tabs on `/dashboard/executive`

Tab state is local (no new route), default tab = Briefing.

### Tab 1 — 📋 Briefing (default)
- Header: "Good morning" + today's date
- Briefing KPI strip: yesterday's total feet, last-7-days total feet, today's allotted feet (target), entries logged yesterday
- **Today's Allotted Work** — table of today's `WorkOrder` rows: project, process type, target feet, actual-so-far, % done, status
- **14-day production trend** — bar chart, daily feet (TIG/MIG/Grind stacked)
- **Process split** — donut, TIG vs MIG vs Grinding share (last 7d)
- **Activity feed** — last ~50 entries across all sources, newest first: actor name + role, action text, timestamp, project ref where applicable

### Tab 2 — 👥 People & KPIs
- **Per-role KPI cards**: PM, Supervisor, Worker, GM (definitions in §4)
- **Entry leaderboard** — bar chart, entry counts per person (yesterday and last-7d toggle)
- **Worker efficiency** — horizontal bar chart, target vs actual feet + efficiency_pct (from `/scheduler/productivity`), sorted, top/bottom performers highlighted

### Tab 3 — 📊 Projects
- Existing 6 KPI cards (unchanged, moved here)
- **Status donut** — Active/Delayed/Hold/Completed share (new, small addition)
- Existing filterable project table with financials, progress, MailButton (unchanged, moved here)

## 4. Per-role KPI definitions

| Role | KPIs | Source |
|---|---|---|
| Worker | Target vs actual feet, efficiency_pct, days worked, top/bottom performers | `/scheduler/productivity` (reused) |
| Supervisor | Entries logged (count), total feet logged, work orders completed | `AuditLog` grouped by user, `WeldingLog`/`ProductionLog` |
| PM (Production Manager) | POs raised, goods receipts recorded, projects on-time %, completion requests submitted, red-material count touched | `PurchaseOrder.raised_by`, `GoodsReceipt.received_by`, `ProjectCompletionRequest.requested_by`, project on-time calc |
| GM (SJM) | Completion requests approved/rejected, projects held/resumed, overall on-time % | `ProjectCompletionRequest.reviewed_by`, `ProjectHoldHistory` |

## 5. Backend changes

### 5.1 Migration: `Project.created_by`
Add nullable `created_by` (FK `users.id`) to `Project`. Set in `POST /api/v1/projects` (`projects/router.py:105`) from `current_user`. Existing rows stay `NULL` — feed shows "Project created" without a name for pre-migration projects, with a name going forward.

### 5.2 New endpoint: `GET /api/v1/dashboard/executive-briefing`
Role: EXECUTIVES (+ Developer, matching existing `/executive` gate). Returns:
```
{
  production: {
    yesterday: { tig_feet, mig_feet, grinding_feet, total_feet, entries },
    last_7d:   { tig_feet, mig_feet, grinding_feet, total_feet, entries },
    trend_14d: [{ date, tig_feet, mig_feet, grinding_feet }]
  },
  today_allotted: [{ project_id, quotation_no, process_type, target_feet, actual_feet, pct, status }],
  activity: [{ timestamp, actor_name, actor_role, action, detail, project_ref }],
  people: {
    leaderboard: [{ user_id, full_name, role, entries_yesterday, entries_7d }],
    by_role: { pm: {...}, supervisor: {...}, gm: {...} }
  }
}
```
Implementation: pure aggregation queries against existing tables (§2) + the new `created_by` column; no new tables. Worker KPIs are fetched by the frontend directly from the existing `/scheduler/productivity` endpoint (kept as a separate call, not duplicated server-side).

### 5.3 Reused endpoints (no changes)
- `GET /api/v1/dashboard/executive` — KPIs + project table (Tab 3)
- `GET /api/v1/scheduler/productivity` — worker efficiency (Tab 2)

## 6. Frontend changes

- `next-frontend/src/app/(main)/dashboard/executive/page.tsx` — add tab state, split existing JSX into Tab 3, add Tab 1/Tab 2 content, fetch the new briefing endpoint + productivity endpoint.
- New small chart components in `next-frontend/src/components/charts/`: `BarChart` (vertical + horizontal variants, CSS flex-based) and `Donut` (inline SVG). No new dependency. Built to existing design tokens; consult `dataviz` skill and `docs/UI_DESIGN_SYSTEM.md` while implementing.
- Reuse existing `MetricCard`, `Table`, `ProgressBar`, `Badge` for everything else.

## 7. Error handling

- Briefing endpoint: if a sub-aggregation fails (e.g. no work orders today), returns empty arrays/zeros, not an error — mirrors current `/executive` behavior (`Failed to load data.` only on total fetch failure).
- Activity feed caps at 50 most recent entries; no pagination in v1 (ponytail: fixed cap, add pagination if the feed becomes the primary audit view).

## 8. Testing

- Backend: one `test_executive_briefing.py` exercising the new endpoint against seeded rows in `AuditLog`, `WeldingLog`, `PurchaseOrder`, `WorkOrder`, `ProjectCompletionRequest` — assert shape and correct yesterday/7d date bucketing.
- Frontend: manual verification (dev server) per project convention — no existing frontend test suite to extend.
- Migration: verify `created_by` populates on new project creation and `NULL` on pre-existing rows without breaking `/executive`.

## 9. Out of scope (explicitly deferred)

- Drill-down detail pages per activity-feed entry (click-through to the record) — v2 if requested.
- Activity feed pagination beyond the 50-entry cap.
- Backfilling `created_by` for existing projects.
- Adding a real "SJM" role — confirmed SJM is the GM's name, not a role.
