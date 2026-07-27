# Problems Resolved — EJ Production Tracker

Running log of bugs, performance issues, and deployment problems — what went wrong, why, how it was fixed, and why that specific approach was chosen.
Update this alongside `projectprogress.md` whenever a non-trivial problem is solved.

---

## 2026-07-27 — Material risk digest + daily email digest: three design decisions (Session 35)

Not a bug-fix session, but per this repo's convention, logging the non-trivial design/architecture decisions made while building the two Briefing v2 features (full detail in `projectprogress.md`).

**Decision 1 — materials notification side effect stays in `get_materials_dashboard`, not the extracted `_compute_material_rows`:** the original `get_materials_dashboard` (`backend/app/dashboard/router.py`) both computes the stock-vs-demand rows *and* fires GM/PM notification-dedup queries as a side effect. When extracting a reusable pure function so the new `executive-briefing` endpoint could reuse the row computation, the notification side effect was deliberately left behind in `get_materials_dashboard` rather than pulled into `_compute_material_rows`. Reason: the briefing endpoint calls the computation on every page load; if the notification side effect had moved into the shared function, every briefing load would also re-trigger GM/PM notification-dedup queries — unnecessary load and a behavior change nobody asked for. Keeping the pure computation and the side effect separate meant the briefing endpoint could reuse the former without inheriting the latter.

**Decision 2 — `get_executive_briefing_data` kept in `backend/app/dashboard/router.py`, not moved to `backend/services/briefing_service.py`:** the original design spec suggested moving the extracted briefing-assembly logic into the service layer so the new email script could import it. It was kept in the router module instead, because `briefing_service.py` is a service-layer module and `router.py` is an app/router-layer module — every other file in this codebase has services imported by routers, never the reverse. Moving it to the service layer would have required the service layer to import router-layer code to reconstitute the full response shape, inverting the established dependency direction for one convenience import. `scripts/send_daily_briefing.py` imports `get_executive_briefing_data` directly from `backend.app.dashboard.router` instead.

**Decision 3 — `JWT_SECRET_KEY` import-time dependency (real deployment-configuration gap, not code bug):** while reviewing Task 7, tracing `scripts/send_daily_briefing.py`'s imports found that it transitively imports `backend.app.auth.router` at module load time (`backend.app.dashboard.router` → `backend.app.auth.rbac` → `backend.app.auth.router`), and `backend/app/auth/router.py` raises `RuntimeError` at import if `JWT_SECRET_KEY` is not set in the process environment (confirmed by direct source read, ~lines 13-17). This means the script fails before it even gets to running, not just when it tries to authenticate, if `JWT_SECRET_KEY` is missing from the Railway Cron Job's env vars. The script's own code was correct — this was a gap in the original plan's Railway env var checklist, which listed only `DATABASE_URL`, `BREVO_API_KEY`, `SMTP_FROM_EMAIL`, `SMTP_FROM_NAME`, `CEO_EMAIL`, `MD_EMAIL` (6 vars). Folded into the Session 35 Railway setup steps as a 7th required var rather than treated as a code fix, since there was nothing wrong to fix in the script itself.

---

## 2026-07-27 — Executive briefing chart stagger + Sidebar hiding dashboard from CEO/MD (Session 34)

**Symptom 1 — chart "staggering":** `HorizontalBarChart` (`next-frontend/src/components/charts/BarChart.tsx`) and `ProgressBar` (`next-frontend/src/components/ui/ProgressBar.tsx`) both had `transition-all duration-700` on the bar-fill `div`. Bars render at their final width on mount (no draw-in was ever requested), so the transition only fired on re-renders — most visibly React Strict Mode's dev-mode double-invoke of the data-fetching `useEffect`, which re-commits state and re-triggers the transition on ~10 bars at once. Since each bar's paint cost differs slightly, they don't finish repainting in the same frame, reading as a cascading/staggered draw-in. **Fix:** removed `transition-all duration-700` from both components — no animation was ever requested. `npm run build` passes.

**Symptom 2 — CEO/MD saw "sign in failed" locally:** unrelated to credentials — `next-frontend/.env.local` had `NEXT_PUBLIC_API_URL=http://localhost:4500`, but the backend runs on port 8003 (nothing was listening on 4500), so every local login attempt failed to reach the backend at all, for every role, not just CEO/MD. Fixed the URL; `.env.local` is gitignored so no code change needed.

**Symptom 3 — CEO/MD logged in fine (confirmed via backend + corrected `.env.local`) but saw no Executive dashboard link at all:** `next-frontend/src/components/Sidebar.tsx` had a `SUP = ["Supervisor", "Operator", "CEO", "MD"]` list meant to hide *write-action* nav items (Add/Edit Project, User Management, Master Data, Procurement Settings) from read-only roles — correct for those. But the same `SUP` array was reused as `hideForRoles` on the **Executive** and **Planning** dashboard links too, so CEO/MD lost visibility into the one dashboard built for them, even though the backend already returned 200 for their role. **Fix:** split out a separate `SHOP_FLOOR = ["Supervisor", "Operator"]` list for the two dashboard nav items, leaving `SUP` (with CEO/MD) on the genuinely write-only items where it belongs.

**Verified:** started backend (port 8003) + frontend (port 3000) locally, added temporary `CEO_USER=VD`/`MD_USER=RD` to local `.env` (gitignored), logged in via API as both — JWT `role` claim correctly resolved to `CEO`/`MD` — and confirmed `GET /api/v1/dashboard/executive-briefing` returns HTTP 200 for both. User confirmed in-browser after the `.env.local` and `Sidebar.tsx` fixes that login, the Executive link, and the dashboard all work correctly with no more chart stagger.

**Also confirms (not a code bug):** the earlier Railway "CEO/MD can't log in" report is purely a missing-env-var problem on Railway (`CEO_USER`/`CEO_PASS`/`MD_USER`/`MD_PASS` still not set there — pending since Session 30) — the backend role-resolution logic is username-agnostic and works correctly with `VD`/`RD` as literal values once those vars exist.

---

## 2026-07-27 — Executive briefing PM/GM attribution fixed (follow-up to the entry below)

**Fix applied same day**, in a scoped follow-up (chose option 2 from below — narrower fix, no auth-model change):

- Added `raised_by_username` (`purchase_orders`) and `received_by_username` (`goods_receipts`) companion string columns, mirroring the existing `AuditLog.username` pattern (`AuditLog` already solves exactly this problem for its own rows — same fix, applied consistently).
- `create_project` now also writes an `AuditLog` row (`action="Create", table_name="projects"`) with the real username, so "Project created" survives in the activity feed even when `created_by` is `NULL`. `Project.created_by` is kept as-is (harmless, populates correctly whenever a real DB user creates a project).
- **Separately found and fixed a second, unrelated bug while investigating:** `create_po` (`backend/app/procurement/router.py`) never set `raised_by` at all — not an env-var issue, just missing from the `PurchaseOrder(...)` constructor. Fixed to mirror the existing `log_receipt`/`received_by` pattern.
- New `resolve_role(username, known_role, env_values)` helper (`backend/services/briefing_service.py`, unit-tested in `test_briefing_service.py`) falls back to matching `DEV_USER`/`GM_USER`/`PM_USER`/`CEO_USER`/`MD_USER` env-var values when no DB `User` row exists. Used both in the activity feed (actor_role) and the PM/GM PO/GR KPI counts.
- Simplified `pm_completions`/`gm_approved`/`gm_rejected`: dropped the `User`-role join entirely — `ProjectCompletionRequest` submission/review is already RBAC-gated to a single role each (submit: Production Manager/Developer; approve/reject: GM/Developer, see `backend/app/projects/completion.py`), so no role lookup was needed there in the first place.

**Verified against the real dev Postgres DB:** confirmed all three new/changed columns exist via `information_schema.columns`; raised a test PO as the env-var `Developer` login → `raised_by_username` correctly stored `"Developer"` (the actual env-var value) while `raised_by` stayed `NULL` as expected → `people.by_role.pm.pos_raised` correctly stayed `0` (role mismatch: "Developer" ≠ "Production Manager", proving the role distinction works, not just counting everything) → re-fetched `/executive-briefing` and saw real historical completion-request events now resolve to `actor_role: "Production Manager"` / `"GM"` (previously would have been `"—"`). Test PO deleted afterward; `npm run build` and `python test_briefing_service.py` both pass.

**Left as-is:** option 1 (backing every management login with a real `users` row) was not done — the option-2 fix above resolves the practical symptom (attribution in this feature) without touching the shared auth model, which still has broader blast radius across other endpoints not investigated here.

---

## 2026-07-27 — Executive briefing "Project created" activity event can never fire (found, not fixed)

**Symptom:** During manual end-to-end verification of the new `GET /api/v1/dashboard/executive-briefing` endpoint, a test project created via the API (as a logged-in `Developer`-role user) did not appear in the endpoint's `activity` feed or affect `people.leaderboard`, even though the endpoint explicitly builds a "Project created" event from `Project.created_by`.

**Root cause:** `create_project` (`backend/app/projects/router.py`) resolves the project creator via `db.query(User).filter_by(username=current_user["username"]).first()` and writes `created_by = creator.id if creator else None`. Every management/executive login in this app (`DEV_USER`, `GM_USER`, `PM_USER`, `CEO_USER`, `MD_USER`) is an env-var login (`backend/app/auth/router.py`) with no corresponding row in the `users` table — confirmed directly: the `users` table has 59 rows, all `Operator` role (workers synced from Excel), zero management-role users. So `creator` is always `None` for any real login today, `created_by` is always written `NULL`, and the briefing endpoint's activity-feed query (`Project.created_by.isnot(None)`) filters every project-creation event out — the feature is currently dead code in practice, even though it will populate correctly for any project row where `created_by` happens to be set.

**Verified concretely:** created project `BRIEFING-TEST-001` via `POST /api/v1/projects` as the `DEV_USER` login → DB row showed `created_by = NULL` → re-fetched `/executive-briefing` → project absent from `activity` and `people.leaderboard`. Test project deleted afterward (`DELETE /api/v1/projects/5`) to leave the dev DB clean.

**Fix:** Not applied in this session — this is an architecture decision (how management logins map to `User` rows) that predates and extends beyond the executive-briefing feature, so it wasn't fixed under Task 6's "verify + document" scope. Flagged here per this repo's convention of logging non-trivial problems found during verification.

**Options for a future session:**
1. Back `CEO_USER`/`MD_USER`/`GM_USER`/`PM_USER`/`DEV_USER` logins with real rows in the `users` table (matches how `Operator` accounts already work), so `creator` resolves correctly everywhere that looks up `User` by username — not just this endpoint.
2. Or, narrower fix scoped to this feature only: have `create_project` fall back to writing a sentinel/role-based value into `created_by` (or a separate `created_by_role` column) when no DB `User` row matches, so the activity feed can still attribute "created by GM" etc. without a full auth-model change.

**Why not fixed now:** Changing the login/user model has blast radius across every endpoint that resolves `current_user` to a DB `User` row, not just this one; deciding between the two options above needs a product call, not just a code fix.

---

## 2026-07-22 — Procurement dashboard loading 1–2 minutes in production

**Symptom:** Clicking the procurement (morning list) dashboard took 1–2 minutes or more to load, sometimes timing out.

**Root cause: N+1 database queries**

`get_morning_list` in `backend/services/procurement_service.py` had a triple-nested loop (`project → line → part`) with 5+ individual DB queries fired inside the innermost loop:

| Call | Queries per part |
|------|-----------------|
| `_uncovered_qty(db, part)` | 1 aggregate query |
| `_available_stock(db, ...)` | 1 lookup query |
| `_lead_time(db, ...)` | 1 lookup query (called twice — once in `compute_priority_score`, once after) |
| `recent_po` vendor lookup | 1 query |
| `_vendor_avg_days_late(db, vendor_id)` | up to 10 queries |
| SQLAlchemy lazy-loading of `project.production_lines`, `line.parts`, `part.processes` | 1 per relationship access |

With 70 projects × ~5 lines × ~5 parts ≈ 1,750 parts → **8,000–15,000 DB round-trips per page load**.

Also: `router.py`'s `morning_list` endpoint iterated draft POs and accessed `po.lines` and `line.allocations` lazily — another hidden N+1.

**Why this approach wasn't caught earlier:** The page worked fine with <20 projects in dev/early prod. N+1 problems only become visible at scale.

**Fix: bulk pre-fetches + dict lookups**

Replaced all per-part DB calls with 6 bulk queries run once before the loop, results stored in dicts:

1. `subqueryload(Project.production_lines).subqueryload(...parts).subqueryload(...processes)` — entire hierarchy in one pass
2. `AVG(order_value)` scalar
3. `GROUP BY client_name COUNT(*)` — repeat-client set
4. All `MaterialLeadTime` rows → `{material_name: days}` dict
5. All `WarehouseStock` rows → `{(material, size, joint_type): available_qty}` dict
6. `SUM(allocated_qty) GROUP BY part_id` for open POs — coverage map per part
7. All received-PO lines → `{(material, size, joint_type): vendor_id}` dict

Vendor lateness (`_vendor_avg_days_late`) kept as-is but now called lazily per distinct vendor (cached in a dict). At most 1 query per vendor, not 1 per part.

Hot loop became pure in-memory dict lookups — zero DB calls inside it.

**Why this approach (not alternatives):**

- **ORM-level caching (dogpile/redis):** Adds infra dependency. Not needed — the fix is to stop making unnecessary queries, not to cache bad queries.
- **Denormalised summary table / materialized view:** More complex, requires migration + sync triggers. Overkill for a dashboard that loads fresh data every click.
- **Pagination:** Doesn't help — the bottleneck is computing the priority score for every part to know which ones to show. You can't skip parts without computing them first.
- **Bulk pre-fetch:** Correct root-cause fix. Query count stays flat at ~6 regardless of project count. Scales to 500+ projects.

**Files changed:**
- `backend/services/procurement_service.py` — rewrote `get_morning_list`; removed `compute_priority_score`, `_is_repeat_client`, `_avg_order_value` as standalone DB-calling functions (logic inlined with pre-fetched data)
- `backend/app/procurement/router.py` — added `subqueryload(PurchaseOrder.lines).subqueryload(...allocations)` on draft-PO query

**Result:** ~6 queries per page load instead of 8,000+. Load time: < 5 seconds at 70 projects, flat growth to 500+.

**Commit:** `5ffd66b` on `demo`

---

## 2026-07-05 — EJ/DJ welding-feet calculation independently reimplemented in 7 files

**Symptom:** Footage numbers were inconsistent across different pages — the scheduler, production entry, and dashboard sometimes showed different feet for the same project.

**Root cause:** The EJ vs DJ distinction (EJ = TIG+MIG+Grinding, DJ = MIG+Grinding only, no TIG) and the per-line footage aggregation were reimplemented independently in 7 different backend files. Each implementation had subtle differences in which process types it counted.

**Fix:** Centralized into two helper functions — `compute_master_feet` and `aggregate_line_feet` — in a single service file. All 7 call sites replaced with calls to these helpers.

**Why this approach:** One place to fix, one place to audit. Any future DJ vs EJ rule change touches exactly one file.

**Reference:** `docs/EJ_DJ_CALCULATION_LOGIC.md` — do not reimplement this logic anywhere; always use the two helpers.

**Commit:** on `main` (merged 2026-07-05)

---

## 2026-07-05 — Worker dashboard crash ("This page couldn't load")

**Symptom:** `/workers/[id]` showed "This page couldn't load" in production after new metrics fields were added.

**Root cause:** Backend changes adding `process_split` and `projects` fields to `GET /api/v1/users/{id}/dashboard` were edited but never committed. Demo ran the old endpoint which returned neither field. Frontend called `projects.map()` on `undefined` → runtime crash.

**Fix (three parts):**
1. Committed the missing backend changes.
2. Added `?? []` guards on `process_split` / `projects` in the frontend so the page degrades gracefully if the backend is behind.
3. Added `r.ok` check before calling `.json()` so any non-200 response shows an error state instead of crashing.

**Why all three:** The commit was the real fix; the guards are defence-in-depth for the next time a deploy lags. The `r.ok` check is good hygiene on every fetch — a non-JSON error body would otherwise throw a second unrelated exception masking the real error.

---

## 2026-07-05 — UI inconsistency: pages mixing old and new design system

**Symptom:** Some pages used the shared component library (`/components/ui/`), others still had hand-rolled Tailwind. Badge colours, table spacing, and typography were inconsistent across the app.

**Root cause:** The shared component library was built after the first ~10 pages were already written.

**Fix:** Migrated all 22 pages to the design system. See `docs/UI_DESIGN_SYSTEM.md` for design tokens, component list, and migration rules (no runtime Tailwind interpolation, no `alert()`/`confirm()`, keep `Th`/`Td` `numeric` props in sync).

**Commit:** merged to `main` on 2026-07-15.
