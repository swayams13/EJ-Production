# EJ Production Tracker — Session Context Handoff (2026-07-10)

## Purpose

This file exists so a **new chat session** can pick up this project without replaying the full
conversation history that produced it. Read this file first, then `projectprogress.md` (full
session-by-session log) and `docs/EJ_DJ_CALCULATION_LOGIC.md` (welding/resource math reference)
if more depth is needed on a specific area. The repo is at
`/Users/sonusingh/AI DEVELOPMENT DESPL/Precise Engineers/EJ Production Tracker`, backend is
FastAPI + Postgres, frontend is Next.js (App Router) + TypeScript + Tailwind v4. Work happens on
the `demo` branch; `main` is never touched without explicit permission.

## The big feature this session built: Joint → Type(tag) → per-tag BOM

**Original problem:** the app only distinguished joints as `EJ` (Expansion Joint) vs `DJ`
(Dismantling Joint) — a binary flag. The user needed a real hierarchy: **Sr no → Joint (Simple
Expansion Joint / Universal Joint / Dismantling Joint) → Type (a specific tag number, e.g.
`U-EJ-F-1MF-S-L`) → PN rating → Size → Qty**, where each *tag* has its own exact bill of
materials (BOM) — not a generic EJ/DJ template. Quantities must scale linearly with the line
quantity `n` (order 10 of a tag → every part's qty × 10). The user supplied Excel workbooks
defining 12 exact tags and their BOMs, which were extracted into tables and explicitly confirmed
correct by the user ("ya it's correct now") before implementation.

**Explicit build instructions from the user** (paraphrased, but this is the actual spec):
specific BOM per specific joint+tag with quantities scaling by n; a single EJ welding-feet master
serves both Simple and Universal Expansion Joints (not doubled for Universal), DJ has its own
master; material status / shop floor input must be driven by joint+tag, not hardcoded; Paint is a
per-line **status** (`Yet to start` / `Started` / `In progress` / `Completed`), not a quantity;
no generic/hardcoded BOM should ever be visible anywhere (material status, fabrication, assembly)
— everything must come from the per-tag BOM. Bellows PDF/master data stays as-is for now (same EJ
master used for Single and Universal), to be revisited later.

### Architecture — single source of truth

`backend/services/joint_catalog.py` is the **only** place the 12 tags and their BOMs are defined.
Do not re-hardcode parts lists anywhere else. Each tag has: `category` (`SIMPLE_EJ` /
`UNIVERSAL_EJ` / `DJ`), `weld_family` (`EJ` or `DJ` — which welding-feet master to use), and a
`components` list. Each component has a `kind`:

- `FIXED` — constant per unit (e.g. Element = 1 per unit).
- `ENTER` — user supplies the per-unit qty at order time (e.g. Limit rod), stored in
  `ProjectProductionLine.variable_qtys_json`.
- `DERIVED` — computed from another `ENTER` component (e.g. Lug = 2 × Limit rod).
- `STATUS` — Paint. Not a quantity; a line-level status field (`paint_status`), not a `Part` row.

`joint_catalog.resolve_components(tag_no, qty, variable_qtys)` returns each non-STATUS,
non-zero component with `per_unit` and `total_qty = round(per_unit * qty)`. This was smoke-tested
against the confirmed BOM tables and matches exactly (e.g. `U-EJ-F-1MF-S-L` × 10 with Limit
rod=4/unit, Bolts&Nuts=16/unit produces the correct scaled totals for all 10 components).

`backend/services/templates.py` was rewritten: it no longer holds the EJ/DJ BOM (that moved to
`joint_catalog.py`); it now only holds `PROCESS_ROUTES` (component name → ordered process steps)
and `COMPONENT_WEIGHTS` (relative weight per component, used for progress %). The old
`EXPANSION_JOINT_TEMPLATE` / `DISMANTLING_JOINT_TEMPLATE` / `TEMPLATES` dict are kept, explicitly
marked legacy, and used **only** as a fallback for production lines that predate this feature
(see "Legacy project handling" below).

### Backend files touched

- `backend/services/joint_catalog.py` — **new**, the 12-tag BOM catalog (source of truth).
- `backend/services/templates.py` — rewritten: process routes + weights only; old templates kept
  as legacy fallback.
- `backend/services/db_service.py` — added to `ProjectProductionLine`: `joint_category`,
  `joint_type_code` (the tag), `paint_status` (default `"Yet to start"`), `variable_qtys_json`.
  Added to `Part`: `qty_per_unit`, `total_qty`. All additive `ALTER TABLE` migrations, both in
  `init_db()`'s columns list and in `main.py`'s `_run_startup_migration()`.
- `backend/services/mes_service.py` — `create_parts_for_production_line()`: if the line has a
  known tag, builds Parts strictly from `joint_catalog.resolve_components()` with scaled
  `qty_per_unit`/`total_qty` and weights renormalized from `COMPONENT_WEIGHTS`; else falls back to
  legacy `_create_parts_legacy()`. New `sync_part_targets()` re-resolves a tag line's BOM in place
  when qty/ENTER values change (preserves `completed_qty`, adds/removes Part rows as the BOM
  changes, no-ops for legacy lines). `calculate_project_progress()`: per-process completion is now
  measured against **`part.total_qty`** (falls back to `line.quantity` for legacy parts), not the
  raw line quantity — this was the critical correctness fix for scaled BOMs.
- `backend/services/production_service.py` — `_line_identity(size, tag, weld_family, pn_rating)`:
  tagged lines are identified by their tag; legacy lines fall back to weld_family so old data still
  matches on re-sync. `sync_project_production_lines()` rewritten around this identity to
  create/update/delete lines correctly for both tagged and legacy items; welding-feet lookup
  unchanged (EJ master for Simple+Universal, DJ master for Dismantling, with the pre-existing
  EJ-fallback-for-missing-DJ-size logging preserved).
- `backend/app/projects/schemas.py` — `BellowItem` gained `joint_category`, `joint_type_code`,
  `variable_qtys`; the old `type` field (EJ/DJ) is kept for legacy items.
- `backend/app/projects/router.py` — bellows endpoints return/accept the new fields plus
  `tag_no`/`description`/`paint_status`; simulate endpoints derive weld family from the tag when
  present.
- `backend/app/production/router.py` — requirements/parts endpoints expose `tag_no`,
  `joint_category`, `paint_status`, `total_qty`; new `PUT /requirements/{id}/paint-status`
  endpoint restricted to `joint_catalog.PAINT_STATES`.
- `backend/app/master/router.py` — new `GET /master/joint-types` returns the full catalog grouped
  by category (this is what the frontend cascading selects are built from).
- `backend/app/inventory/router.py` — material shortages now walk each line's actual `Part` rows
  (any BOM component) instead of a single hardcoded "bellows" check.

### Frontend files touched

- `next-frontend/src/app/(main)/projects/add/page.tsx` — new-project form: Sr no → Joint (category
  select, from `/master/joint-types`) → Type (tag select, filtered by category, shows
  `tag_no — description`) → PN Rating → Size (filtered by the tag's weld_family) → Qty, plus a
  dynamic grid of number inputs for that tag's `variable_components` (ENTER quantities).
- `next-frontend/src/app/(main)/projects/edit/page.tsx` — same cascading UI for editing; see
  "Legacy project handling" below for the most recent change here.
- `next-frontend/src/app/(main)/production/entry/page.tsx` — shop floor entry: requirement picker
  shows the tag, a "Tag: ..." badge, a Paint Status selector wired to the new endpoint, and part
  targets/pending-qty now read `part.total_qty` instead of the raw line quantity.
- `next-frontend/src/app/(main)/inventory/page.tsx` — material name list expanded to the full BOM
  component vocabulary (Element, Collar, Flange, Weldend, Spool, Liner, Lug, Limit rod, Matching
  Flanges, Bolts&Nuts, Gaskets, Pipe-1/2, Stopper Patti, flanges, O-ring, Studs Long/Short, etc.).
- `next-frontend/src/app/(main)/master/page.tsx` — new "Joint Types & BOM" card that renders the
  full catalog (category → tag → component list with its FIXED/ENTER/DERIVED/STATUS rule) from
  `/master/joint-types`.

### Confirmed decisions worth remembering

- Simple **and** Universal Expansion Joints both use the **EJ** welding-feet master (same feet per
  size) — Universal is not auto-doubled for welding, per explicit instruction. Only Dismantling
  uses the DJ master. Revisit only if the user says otherwise.
- Weldend=2 alongside Flange=2 on the `-S-L` tag variants is intentional (confirmed by user), not
  a data error. "2 x Limit Rods" in the source Excel is the Lug=2×Limit-rod derivation rule, not a
  literal quantity. "Enter" values in the Excel are always **per-unit** (multiplied by line qty).
- Paint is a line-level status field, never a `Part`/quantity row.
- Bellows welding-feet PDF/master data is intentionally left as one shared table for Single and
  Universal for now; the user said they'll update this later — don't "fix" it preemptively.

## Legacy project handling (fixed 2026-07-10, later in the day)

After the above shipped, the user reported that pre-existing projects (created before this
feature existed) no longer showed under any joint category in the Edit Projects UI. Diagnosis:
legacy `ProjectProductionLine` rows have the old `joint_type` (EJ/DJ) set but `joint_category` and
`joint_type_code` are `NULL`. The user proposed: legacy lines keep showing as broad "Expansion
Joint"/"Dismantling Joint" categories, with an opt-in "Recategorize" control to move a specific
line onto the new Joint→Type→tag schema when ready — validated as the right approach (a legacy
line's history can't be retroactively mapped onto one specific tag's BOM automatically).

**A more serious bug was found during diagnosis, now also fixed:** `projects/edit/page.tsx`'s
save-time filter only kept bellow rows that had a `joint_type_code`. Since legacy rows never have
one, saving *any* legacy project from the Edit page — even with no changes intended — silently
dropped every legacy line from the submitted payload. `sync_project_production_lines()` deletes
any production line not present in what's submitted, so this meant **saving a legacy project's
Edit form deleted all of its production lines, Parts, and progress.** This was a live data-loss
bug, not just a display bug.

**Fix (frontend-only — the backend already handled legacy `type` items correctly, no backend
changes were needed):** `BellowRow` gained `legacy_type` (the row's original EJ/DJ, set only when
no tag exists) and `recategorize` (a per-row opt-in flag). A row with `legacy_type` and no
category/tag renders as a static "Expansion Joint (Legacy)"/"Dismantling Joint (Legacy)" badge
plus a "Recategorize" button, instead of blank/unselected cascading dropdowns. The shared
`toBellowPayload()` helper (used by both the resource-simulation effect and `handleSubmit`) submits
a row either as a full `{joint_category, joint_type_code, variable_qtys}` payload (once both are
chosen) or, for an untouched/mid-recategorization legacy row, as `{type: legacy_type}` — matching
its original identity so `sync_project_production_lines()` keeps updating the same line instead of
deleting it. Clicking "Recategorize" opens a confirmation modal explaining that assigning a real
tag rebuilds that line's BOM from scratch (old generic fabrication progress on that line doesn't
carry over, since the new tag has its own distinct parts list); confirming reveals the normal
Joint/Type selects for that row so the user can pick a category + tag, with a "Cancel — keep as
legacy" escape hatch.

Committed on `demo` as `4716981` ("fix(edit-projects): keep legacy EJ/DJ lines visible + safe on
save, add Recategorize control"), on top of `f912739` (the main Joint→Type→BOM feature commit).

## Current repo / verification state

- Branch: `demo`. Latest commits: `4716981` (legacy-row fix) on top of `f912739` (the main
  feature).
- **Not yet confirmed by the user:** `npm run build` in `next-frontend` has not been run
  successfully and reported back. Neither the cloud sandbox nor the device-bridge Linux VM used in
  this session have working npm-registry network access, so the TSX changes were hand-verified
  (read in full, traced logic, confirmed against the `Modal` component's actual prop signature)
  but never machine-typechecked. **Run `npm run build` from the user's own terminal before
  pushing**, and treat any TypeScript errors it surfaces as the top priority to fix.
- **Not yet confirmed:** `git push origin demo` — the user needs to push from their own terminal
  (this session's tooling has no outbound network access for git push).
- Runtime-against-Postgres has not been verified in this session either (per the open flags
  already logged in `projectprogress.md`'s "Session 7" entry) — worth a smoke test once deployed:
  create a project with a tag, confirm Parts/qty scale correctly, edit qty and confirm
  `sync_part_targets` rescales without losing `completed_qty`, and open a pre-existing legacy
  project in Edit Projects to confirm it now shows its legacy badge instead of blank selects.

## How to continue in a new session

1. Read this file, then skim `projectprogress.md`'s latest entry for anything added after
   2026-07-10.
2. Confirm with the user whether `npm run build` and `git push origin demo` succeeded. If build
   errors were found, fix them and commit as a new commit (not an amend).
3. Any further legacy-line work, additional tags, or master-data changes should extend
   `joint_catalog.py` / `templates.py` — do not add a second BOM source anywhere else.
