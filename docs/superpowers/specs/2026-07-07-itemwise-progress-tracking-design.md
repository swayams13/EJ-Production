# Itemwise Progress Tracking — Design Spec

**Date:** 2026-07-07
**Status:** Approved design, pending implementation plan
**Source:** `JOB Itemwise Progress Report.xlsx` (company's end-to-end production tracking sheet)

---

## 1. Goal

Bring the company's existing paper/Excel "Job Itemwise Progress Report" into the platform so supervisors track, per job, every component through its manufacturing steps, the sub-assembly progression, and final quality checks — and surface that progress on the WIP and Executive dashboards.

The Excel has three tracks:

1. **Component manufacturing** — each component (Bellows, Collar, Weldend, Spool, Flanges, Sleeve, Lugs, Limit Rods, Gaskets, Box packing) moves through its own step sequence (Material Received → Cutting → Welding → DP test → … → Ready), with qty + date at each step.
2. **Sub-assembly progression** — sequential stages (Part A → B → C → D → E → Final), each with Required / In-Process / Ready / Pending status.
3. **Final checks** — Testing (Hydro/Pneumatic), Painting (spec), Weight (kgs), Marking (Hard Punch).

Both product types are covered: EJ (Expansion Joint) and DJ (Dismantling Joint).

---

## 2. Key finding: most of this already exists — REUSE, don't rebuild

The platform **already models component→step→progress** end to end. This spec extends that machinery rather than adding parallel tables. Rebuilding it would duplicate live domain logic, which `CLAUDE.md` explicitly forbids (the EJ/DJ logic was already reimplemented across 7 files and centralized — don't add an 8th).

What already exists and is wired up:

| Layer | File | What it does |
|---|---|---|
| Step definitions | `backend/services/templates.py` | `TEMPLATES["EJ"]` / `["DJ"]` — components, their process steps, and a `weight_percentage` per component |
| Seeding | `backend/services/mes_service.py` → `create_parts_for_production_line()` | Creates `Part` + `PartProcess` rows from the template when a production line is created |
| Persistence | `backend/services/db_service.py` | `Part` (component), `PartProcess` (`completed_qty`), `ProductionLog` (dated qty entries) |
| Entry API | `backend/app/production/router.py` | `GET /requirements`, `GET /parts/{req_id}`, `POST /processes/{id}/transactions` — already backs the Shop Floor Entry page |
| Progress calc | `mes_service.calculate_project_progress()` | Weighted % per project (70% fabrication / 30% welding) using `weight_percentage`; already feeds dashboards |

**Consequence:** the "readiness % weighting" concern from brainstorming is already solved by `weight_percentage`. The sub-assembly track already exists as parts (e.g. `"B/C Assembly Part 'P'"`). We are closing gaps, not greenfielding.

Data model note: EJ/DJ is stored **per production line** (`ProjectProductionLine.joint_type`), not per project — a single quotation can contain both EJ and DJ lines. All tracking hangs off the line, matching the existing structure.

---

## 3. Gap analysis — what the Excel adds

| # | Gap | Existing state | Needed |
|---|---|---|---|
| G1 | Step granularity | `templates.py` is coarser than the Excel (e.g. Collar = Cutting, Ready) | Reconcile template step lists to match the Excel exactly, incl. a `Material Received` (or `PO`) first step on every component |
| G2 | Explicit pending | `completed_qty` only; pending is derived | `qty_pending` derived as `line.quantity − completed_qty` (kept derived, not stored) + `date_pending` stored |
| G3 | Dates on steps | Dates live only in `ProductionLog` rows | Store `date_ready` (and `date_pending`) on `PartProcess` |
| G4 | Assembly status | Assembly parts use `completed_qty` like any part | Add a `status` enum so Required / In-Process / Ready / Pending is explicit |
| G5 | PO number | Not captured | `po_number` on `PartProcess` (used by the `PO`/`Material Received` step of bought-out items) |
| G6 | Final checks | **Not modeled anywhere** | New `job_final_checks` table (testing / painting / weight / marking) |

---

## 4. Design

### 4.1 Enrich `templates.py` (G1)

Reconcile each component's `processes` list to the Excel. Target step lists (from the Excel):

**EJ**
- Bellows (B): Material Received, Cutting, Welding, DP test, Forming, Ready
- Collar (C): Material Received, Cutting, Welding, DP test, Ready
- Weldend (W): Material Received, Cutting, Bending, Welding, Re-Rolling, DP test, SF Cutting, Ready
- Spool (SP): Material Received, Cutting, Bending, Welding, Re-Rolling, DP test, Ready
- Job/Compensator Flanges (F): PO, Material Received, Cutting, Bending, Welding, M/c, Drilling, Inward Insp, Ready
- Companion Flanges (CF): PO, Material Received, Cutting, Bending, Welding, M/c, Drilling, Inward Insp, Ready
- Internal Sleeve (IS): Material Received, Cutting, Welding, Ready
- Lugs (L): Material Received, Cutting, Drilling, Ready
- Limit Rods (LR): PO, Material Received, Inward Insp, Ready
- Gaskets (G): PO, Material Received, Inward Insp, Ready
- Box packing: PO, Material Received, Inward Insp, Ready
- Assembly parts (A→final) retained as-is: Assembly, Ready

**DJ**
- Pipe 1 / Pipe 2 / Stopper: Material Received, Cutting, Bending, Welding, Re-Rolling, DP test, Ready
- Job Flanges (FP1, FP2) / Stopper Flanges (FS) / Companion Flanges (CF): PO, Material Received, Cutting, Bending, Welding, M/c, Drilling, Inward Insp, Ready
- Studs / O Rings / Gaskets / Box packing: PO, Material Received, Inward Insp, Ready
- Assembly parts (A→C→final) retained: Assembly, Ready

`weight_percentage` values are **unchanged** — weight is per component (part), not per step, so the progress-calc denominator is unaffected. Adding steps makes each part's completion finer-grained (and slightly more accurate); acceptable and intended.

### 4.2 Extend `PartProcess` (G2, G3, G4, G5)

Add columns (all nullable / defaulted, additive migration):

```
PartProcess
  + status        String  default 'pending'   # 'pending' | 'required' | 'in_process' | 'ready'
  + date_ready    Date    nullable
  + date_pending  Date    nullable
  + po_number     String  nullable
```

- `qty_pending` stays **derived** (`line.quantity − completed_qty`) — surfaced in the API response, not stored, so it can never drift.
- `status` replaces the loose boolean modeling considered in brainstorming; a single enum makes impossible states unrepresentable. Default `'pending'`; the existing transaction endpoint sets `'ready'` when `completed_qty` reaches `line.quantity`, `'in_process'` when partially done.

### 4.3 New table `job_final_checks` (G6)

The one genuinely new concept. One row per check type per production line, auto-seeded (4 fixed rows) alongside parts.

```
job_final_checks
  id                 PK
  production_line_id FK -> project_production_lines
  check_type         String   # 'testing' | 'painting' | 'weight' | 'marking'
  is_required        Boolean  default True

  # type-specific (others null per row)
  test_method        String   nullable   # 'Hydro/Pneumatic'
  paint_spec         Text     nullable
  weight_kgs         Float    nullable
  marking_type       String   nullable   # 'Hard Punch'

  # shared status
  status             String   default 'pending'   # same enum as PartProcess
  date_ready         Date     nullable
  date_pending       Date     nullable
  notes              Text     nullable
  updated_by         FK -> users  nullable
  updated_at         DateTime

  UNIQUE(production_line_id, check_type)
```

Seeded in `create_parts_for_production_line()` right after parts, so every line gets its 4 checks with no separate init call.

### 4.4 Backfill for existing project lines

Existing lines already have parts seeded from the **old** coarser template and have **no** final-check rows. A startup migration (following the existing `_run_startup_migration()` pattern in `main.py`) reconciles them:

- For each existing production line, add any `PartProcess` steps present in the enriched template but missing on that line (match by part name + process name; never delete or renumber existing rows so logged progress is preserved).
- Insert the 4 `job_final_checks` rows for any line missing them.

Idempotent (`INSERT … WHERE NOT EXISTS` / `ON CONFLICT DO NOTHING`), safe to run on every boot.

---

## 5. API

Extend the existing `production` router — no new router.

- `GET /parts/{req_id}` — **extend** existing response: add `status`, `date_ready`, `date_pending`, `po_number`, and derived `qty_pending` to each process; add a `final_checks` array to the payload.
- `POST /processes/{id}/transactions` — **extend** existing: accept optional `date_ready` / `po_number`; recompute `status` from `completed_qty` vs `line.quantity`.
- `PUT /final-checks/{check_id}` — **new**: update one final check (`is_required`, `status`, type-specific field, `date_ready`, `date_pending`, `notes`). Upsert-safe.

All under existing role gating.

---

## 6. Dashboards

`mes_service.calculate_project_progress()` already produces the weighted % that feeds WIP + Executive. Extend it minimally:

- Fold `job_final_checks` into the completion blend (final checks gate shipment). Proposed: keep 70% fabrication / 30% welding for the per-line fabrication+weld number, then require all `is_required` final checks `= 'ready'` for a line to read 100%. Exact blend finalized in the plan; the point is final checks must be able to hold a line below 100% even when all parts are done.
- WIP dashboard: expose per-line "current stage" = the earliest non-ready step (component or assembly), so stuck items are visible.
- Executive dashboard: already consumes the project %; no change beyond the calc extension.

---

## 7. Frontend

Entry point (per earlier decision): the existing **Shop Floor Entry** page.

- Extend the parts/processes UI to show and edit the new per-step fields (status, date_ready, qty_pending, po_number).
- Add a **Final Checks** section (4 rows) to the same requirement view.
- Uses the existing `ui/` design-system components (`Table`, `Input`, `Badge`, etc.) per `docs/UI_DESIGN_SYSTEM.md` — no new patterns.

---

## 8. Scope boundaries / limitations (v1)

- **Welding-feet vs Welding-step double-entry** (flagged in brainstorming): the app tracks welding feet (`WeldingLog`) *and* has a "Welding" step per component. These stay **independent** in v1. Not linked; noted as a known overlap. Upgrade path: derive the Welding step's status from feet-completion later.
- **Per-piece tracking**: tracking stays per-component-batch (via `completed_qty` against `line.quantity`), not per individual physical piece — matching the existing model and the Excel.
- `qty_pending` is derived, never stored.
- Final-check blend weighting is a gate (all required checks ready → allow 100%), not a weighted fraction, unless the plan finds a reason to weight.

---

## 9. Why this over the alternatives

- **vs. three new parallel tables (original brainstorm):** duplicates the live Part/PartProcess/ProductionLog machinery, the shop-floor API, and the progress calc — and re-solves weighting that `weight_percentage` already handles. Violates the "don't reimplement domain logic" rule in `CLAUDE.md`. Rejected.
- **vs. modeling final checks as special Parts:** avoids one table but overloads `Part`/`PartProcess` semantics (checks have no qty-vs-line-quantity meaning, need type-specific fields). A small dedicated table is clearer. Rejected.
