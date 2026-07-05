# EJ / DJ Welding & Resource Calculation Logic — Technical Reference

This is the canonical reference for how Expansion Joint (EJ) and Dismantling
Joint (DJ) welding requirements, workforce productivity, and resource
counts are calculated across the codebase. Read this before touching any
of the files below — this logic was previously duplicated in 7 different
places and quietly drifted; it is now centralized on purpose.

## The business rule

- **EJ (Expansion Joint)**: has three independent welding/finishing metrics —
  **TIG feet**, **MIG feet**, and **Grinding (sq ft)**. Required TIG welders,
  MIG welders, and grinders are each computed from their own feet total.
- **DJ (Dismantling Joint)**: has **no TIG process at all**. All welding
  footage is MIG. Required workers are only MIG welders + grinders.
  `tig_feet` must always be `0` for a DJ production line / master record.

## Where the numbers come from (data flow)

```
Two Excel files on disk (or uploaded)
  -> WeldingMaster table (versioned; get_welding_master_latest() returns
     only the newest version per joint_type)
  -> compute_master_feet(master, joint_type, qty)      [production_service.py]
  -> ProjectProductionLine.tig_feet / mig_feet / grinding_feet
     (written by sync_project_production_lines())
  -> aggregate_line_feet(lines)                         [production_service.py]
  -> used by duration calc, resource-requirement calc, the scheduler,
     the planning dashboard, and the capacity-status dashboard
```

- EJ master data: `import_welding_master_from_disk()` / `import_welding_master_from_upload()`
  — reads the "BELLOWS WELDING FEETS PER SIZE" Excel, header row 2, columns matched by substring.
- DJ master data: `import_dismantling_joint_master()` / `import_dismantling_joint_master_from_upload()`
  — reads the "DISMANTLING JOINT WELDING FEETS PER SIZE" Excel, columns read **positionally**
  (`row.iloc[1]`=size, `[2]`=feet, `[3]`=grinding), forces `tig_feet=0.0`.
- Upload endpoints: `POST /api/v1/master/welding-import` (EJ), `POST /api/v1/master/dj-import` (DJ).
  Disk-based re-sync (legacy, still supported): `POST /api/v1/master/sync/ej`, `/sync/dj`, `/sync/all`.
- Frontend: [next-frontend/src/app/(main)/master/page.tsx](../next-frontend/src/app/(main)/master/page.tsx)
  has both "Sync" (re-read the file already on the server) and "Upload" (pick a new file) buttons.

## The two centralized functions — do not re-duplicate this logic

Both live in [backend/services/production_service.py](../backend/services/production_service.py).

### `compute_master_feet(master, joint_type, qty)`
Converts a `WeldingMaster` row + quantity into `(tig_feet, mig_feet, grinding_feet)`.
For DJ, folds `tig_feet` into `mig_feet` (handles the fallback case where no
DJ-specific master data exists for a size and an EJ record is used as a
same-size proxy — logs a warning when this happens, since it silently
changes the numbers). Used by: `sync_project_production_lines`,
`auto_sync_all_projects_with_master` (master/router.py), and all three
`/simulate*` endpoints in `projects/router.py`.

### `aggregate_line_feet(lines)`
Sums TIG/MIG/Grinding feet across a list of already-synced `ProjectProductionLine`
rows. Since DJ lines should already have `tig_feet == 0` (enforced by
`compute_master_feet` at write time), this is normally a plain filtered sum —
but it defensively folds any stray non-zero `tig_feet` on a DJ line into MIG
and **logs a warning**, because that indicates the line was written outside
`sync_project_production_lines` (e.g. a manual DB edit or a future bug).
Used by: `calculate_project_duration`, `calculate_required_resources_for_deadline`,
`scheduler/router.py` (auto-assign pacing), `dashboard/router.py` (planning forecast).

### `get_productivity_rates(session)`
Single source of truth for TIG/MIG/Grinder ft-per-day productivity, read from
`WorkforceMaster`. Falls back to `{tig: 180, mig: 120, grind: 80}` only if a
resource_type row is missing. Used everywhere a required-worker-count is computed.

## Enforcement points (don't remove these)

- `backend/app/production/schemas.py`: `WeldingLogCreate.feet_done` and
  `TransactionCreate.quantity_completed`/`feet_completed` have `Field(gt=0)`/`Field(ge=0)`
  constraints — negative or zero values are rejected before they reach the DB.
- `backend/app/production/router.py` `add_welding_log()`: rejects `process_type == "TIG"`
  against a `joint_type == "DJ"` line with a 400. This is the **server-side** guard;
  the frontend ([production/entry/page.tsx](../next-frontend/src/app/(main)/production/entry/page.tsx))
  also hides the TIG button for DJ projects, but that's UI-only — don't rely on it alone.

## Known limitations (deliberately not fixed / out of scope so far)

- Inventory shortage calc ([inventory/router.py](../backend/app/inventory/router.py)) checks each
  project's requirement against total stock **independently** — no cumulative allocation
  across multiple concurrent projects competing for the same material.
- The scheduler's per-worker productivity (`Employee.target_per_day` / `User.base_productivity`)
  is a **separate model** from `WorkforceMaster` TIG/MIG/Grind rates. Changing one does not
  affect the other. Left as-is since unifying them is an architectural decision, not a bug fix.
- `get_company_capacity_status()` in production_service.py does its own EJ/DJ split
  (needs `dj_feet` reported separately from `mig_feet` for the dashboard) and was
  **not** migrated to `aggregate_line_feet()` — it was already correct and has a
  different output shape, so don't assume it uses the shared helper.

## Verification patterns that caught false positives this session

Two different automated audits both incorrectly flagged
`mes_service.py`'s progress formula (`fab * 0.7 + welding_pct * 30.0`) as a
scaling bug. It is **not** a bug: `Part.weight_percentage` values sum to 100
per joint template (see [templates.py](../backend/services/templates.py)), so
`line_fabrication_completion` is already on a 0–100 scale before the `* 0.7`,
matching `welding_pct * 30.0`. Before trusting a claimed bug in this file,
verify the actual scale of `weight_percentage` rather than assuming 0–1.
