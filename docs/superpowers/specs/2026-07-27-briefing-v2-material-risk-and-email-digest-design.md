# Executive Briefing v2 — Material Risk Digest + Daily Email Digest — Design Spec

**Date:** 2026-07-27
**Status:** Approved, pending implementation plan
**Extends:** `docs/superpowers/specs/2026-07-27-executive-morning-briefing-design.md` (v1 — 3-tab Briefing/People/Projects page, `GET /api/v1/dashboard/executive-briefing`)

Two independent sub-features from the "Briefing v2" backlog logged in `projectprogress.md` (2026-07-27, Session 33 backlog section), picked as the highest-value/lowest-effort items since both reuse infrastructure that already works end-to-end. Built together in one session; each has its own implementation plan.

## 1. Problem

The Briefing tab explains production/activity but not *why* a project might stall — material shortages are a common real cause and today require a separate trip to `/dashboard/materials` to notice. Separately, the briefing is a page someone has to remember to open; the CEO/MD env vars, Brevo email infra, and the aggregation logic all already exist but nothing pushes the briefing to them proactively.

## 2. Part 1 — Material Risk Digest

### 2.1 Data reality

- `GET /api/v1/dashboard/materials` (`backend/app/dashboard/router.py:646-790`) already computes, per material spec (`material_name`, `size`, `joint_type`): stock on hand, reserved, minimum threshold, incoming (open PO) qty, total demand from active projects, `net_gap = total_demand - available_stock - incoming_qty`, and a `status` of `red` (net_gap > 0 — a hard shortfall) / `amber` (available stock below minimum, but no hard gap yet) / `green`. Each row also carries the list of projects (`id`, `name`, `qty_needed`, `delivery_date`) that need that spec.
- This computation is currently inline inside the `get_materials_dashboard` route handler — not a reusable function. Per this repo's CLAUDE.md rule against re-duplicating calculation logic across files, it must be extracted rather than copied.
- "Blocked" = touching at least one `red` spec (confirmed with user — `amber` is a stock warning, not yet an actual blocker).

### 2.2 Backend changes

**Extract, don't duplicate:** move the body of `get_materials_dashboard` (stock/PO/demand pre-fetch through building `List[MaterialRow]`) into a plain function `_compute_material_rows(db: Session) -> List[MaterialRow]` in `backend/app/dashboard/router.py`. `get_materials_dashboard` becomes `return _compute_material_rows(db)` (response/behavior unchanged). `executive_briefing` also calls `_compute_material_rows(db)`.

**New pure function** `summarize_material_risk(rows, top_n=5)` in `backend/services/briefing_service.py` (matches the file's existing pattern of small testable pure aggregation functions — `summarize_production`, `build_leaderboard`, etc.). Duck-types on `.status`, `.net_gap`, `.projects` (no import of the `MaterialRow` pydantic class needed, keeps the service layer decoupled from the router module):

```python
def summarize_material_risk(rows, top_n: int = 5) -> dict:
    red_rows = [r for r in rows if r.status == "red"]
    blocked_project_ids = {p.id for r in red_rows for p in r.projects}
    top = sorted(red_rows, key=lambda r: r.net_gap, reverse=True)[:top_n]
    return {
        "projects_blocked": len(blocked_project_ids),
        "top_risks": [
            {
                "material_name": r.material_name, "size": r.size, "joint_type": r.joint_type,
                "net_gap": r.net_gap, "projects": [p.name for p in r.projects],
            }
            for r in top
        ],
    }
```

**Wiring:** `executive_briefing()` adds one call — `materials = summarize_material_risk(_compute_material_rows(db))` — and a new `"materials"` key in its response:
```
materials: { projects_blocked: int, top_risks: [{ material_name, size, joint_type, net_gap, projects: [str] }] }
```

### 2.3 Frontend changes (`next-frontend/src/app/(main)/dashboard/executive/page.tsx`, Briefing tab)

- One more `MetricCard` in the existing top KPI strip (currently 4 cards): "Projects Blocked on Material", `tone="critical"` if `> 0` else `"neutral"`.
- New section below "Today's Allotted Work" (same `<h2>` + content pattern already used for that section and the activity feed): "Material Risk" — lists `top_risks`, each row showing material/size/joint type, `Badge tone="critical"` with the net gap, and the affected project name(s) (comma-joined). Empty state ("No material shortages blocking projects") when `top_risks` is empty. No drill-down/click-through — matches item #9 in the v2 backlog, explicitly deferred.

### 2.4 Testing

Unit test `summarize_material_risk` in `test_briefing_service.py` with hand-built row fixtures (plain objects/namedtuples exposing `.status`/`.net_gap`/`.projects`): zero red rows → `projects_blocked: 0, top_risks: []`; overlapping projects across multiple red rows → project counted once; more than `top_n` red rows → only the top N by `net_gap` returned, correctly sorted.

## 3. Part 2 — Daily Email Digest

### 3.1 Scheduling mechanism

Railway Cron Job service (native Railway feature — a separate service in the same Railway project that runs a one-shot command on a cron schedule). No new Python dependency, no in-process scheduler thread to babysit inside the web dyno. This repo currently has zero scheduling infrastructure (confirmed: no APScheduler/croniter in `requirements.txt`, no `railway.json`/`Procfile`), so this is new but minimal.

**Railway-side setup (manual, outside this repo — cannot be done by an agent):**
1. In the Railway project (same one hosting the `demo` backend), add a new service → **Cron Job** type, same repo/branch (`demo`).
2. Command: `python -m backend.scripts.send_daily_briefing`
3. Schedule: `30 2 * * *` (Railway cron is UTC; 2:30 AM UTC = 8:00 AM IST — this repo has no timezone handling anywhere today, so the UTC offset is baked into the cron expression itself rather than computed in code).
4. Share the same environment variable group as the backend service (needs `DATABASE_URL`, `BREVO_API_KEY`, `SMTP_FROM_EMAIL`, `SMTP_FROM_NAME`, `CEO_EMAIL`, `MD_EMAIL`).

### 3.2 Backend changes

**Refactor (reuse, not duplicate):** `executive_briefing()`'s ~150 lines of query/orchestration (production feet, today's allotted work, activity feed union, leaderboard, by-role KPIs) currently live directly in the FastAPI route body. Extract into a plain function `get_executive_briefing_data(db: Session) -> dict` in `briefing_service.py`, including the new `materials` key from Part 1. The route becomes:
```python
@router.get("/executive-briefing")
def executive_briefing(db: Session = Depends(get_db), user=Depends(require_roles(EXECUTIVES + ["Developer"]))):
    return get_executive_briefing_data(db)
```
This is what lets the cron script reuse the exact same aggregation the page uses, instead of a second hand-rolled query set.

`get_executive_briefing_data` gains one more field in its returned dict: `"today": today.isoformat()` (the function already computes `today = _date.today()` internally for the production-window query — just also returns it). The email subject line and body header both use this field, so there's a single source of "what date is this briefing for" shared by the page and the email.

**New pure function** `format_briefing_email(data: dict) -> str` in `briefing_service.py` — condensed plain-text body:
```
EJ Tracker — Morning Briefing — <date>

Yesterday: <total_feet> ft (<entries> entries)
Last 7 days: <total_feet> ft
Today's allotted work: <N> work orders, <target_feet> ft target
Projects blocked on material: <N>

Recent activity:
- <actor> — <action> — <detail>
  (top 3-5 by timestamp, newest first)
```
Unit-testable with a fixture `dict` matching `get_executive_briefing_data`'s shape — no DB involved.

**New script** `backend/scripts/send_daily_briefing.py` — thin entrypoint, the actual command Railway's Cron Job runs:
```python
from backend.services.db_service import SessionLocal
from backend.services.briefing_service import get_executive_briefing_data, format_briefing_email
from backend.services.email_service import send_system_email
import os, sys

def main():
    recipients = [e for e in (os.getenv("CEO_EMAIL"), os.getenv("MD_EMAIL")) if e]
    if not recipients:
        print("No CEO_EMAIL/MD_EMAIL configured — nothing to send", file=sys.stderr)
        sys.exit(1)  # fail loud: an unattended daily job should show as a failed Railway run, not a silent no-op
    db = SessionLocal()
    try:
        data = get_executive_briefing_data(db)
    finally:
        db.close()
    body = format_briefing_email(data)
    send_system_email(recipients, f"EJ Tracker — Morning Briefing — {data['today']}", body)

if __name__ == "__main__":
    main()
```

Recipients: `CEO_EMAIL` + `MD_EMAIL` only (confirmed with user — GM/PM already see this data by logging in themselves; no new env vars, both already referenced in `backend/app/notifications/router.py`, just not yet set on Railway).

Content depth: condensed summary, not the full page dumped as text (confirmed with user) — `send_system_email` is plain-text only today (Brevo `textContent`), so a full dump would be a wall of text anyway.

### 3.3 Error handling

- No recipients configured → script exits 1 (visible as a failed Cron Job run in Railway's dashboard).
- `BREVO_API_KEY` unset or Brevo API error → `send_system_email` already logs and returns without raising (existing behavior, unchanged) — the script still exits 0 in this case since the *job* ran correctly, only the send failed inside infra that already has its own diagnostic endpoint (`POST /api/v1/notifications/test-email`). No retry logic added — YAGNI for a job that runs once a day and is checked via Railway logs, not a system where a missed send has severe consequences.
- DB query failure → uncaught, script exits non-zero, surfaces as a failed Railway Cron run. No special handling needed.

### 3.4 Testing

Unit test `format_briefing_email` in `test_briefing_service.py` with a fixture dict — asserts the key numbers (yesterday feet, projects blocked) appear in the output string, and that an empty activity list produces a sane "no activity" line rather than crashing.

No automated test for the script itself (thin I/O wrapper, nothing to unit test beyond what the two pure functions already cover) or for the Railway Cron Job (infra, not code) — verified manually after Railway setup by checking the Cron Job's run log and confirming the email arrives.

## 4. Out of scope (explicitly deferred)

- Drill-down from the material risk tile into `/dashboard/materials` filtered to the blocking specs (same "explicitly deferred" item as the v1 spec's activity feed drill-down).
- HTML-formatted email (plain text only, matches existing `send_system_email`).
- Configurable send time/recipients via the UI (env var + cron expression only, matches how every other env-var-driven config in this repo works).
- Retry/dead-letter handling for failed sends.
- Repo-wide timezone handling (the 2:30 AM UTC cron expression is a point fix for this one job, not a general TZ solution).
