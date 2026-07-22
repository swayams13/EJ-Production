# Problems Resolved — EJ Production Tracker

Running log of bugs, performance issues, and deployment problems — what went wrong, why, how it was fixed, and why that specific approach was chosen.
Update this alongside `projectprogress.md` whenever a non-trivial problem is solved.

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
