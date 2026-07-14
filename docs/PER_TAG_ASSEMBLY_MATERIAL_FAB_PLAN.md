
# Per-Tag Material Status / Fabrication / Assembly — Implementation Plan

## Goal
All 12 joint tags should produce complete, correctly-separated data across the
Shop Floor Entry page's 5 tabs (Material Status, Fabrication, Assembly,
Welding & Grinding, Final Checks) — for both brand-new tagged lines AND
already-existing tagged lines already in the database — without ever touching
an untagged/legacy line's data (the standing guardrail).

## Reference material
`docs/EJ_DJ_12_Tag_Spec_for_Claude.xlsx` — per-tag BOM, the resolved process
route for every component (already labeled with which tab it belongs in:
Material Status / Fabrication / Welding & Grinding), the assembly chain per
tag, final checks, and component weights. This was cross-checked line-by-line
against the current codebase and against the user's own
"EJ DEJ Numbering and Quantity 1.xlsx" — **no discrepancies found**. Treat it
as a verification reference, not something to blindly re-implement from
scratch — the BOM/process data is already correct in the codebase.

## Confirmed root cause of "Assembly tab missing for some lines"
`backend/services/itemwise_backfill.py`'s `backfill_itemwise()` runs on every
backend startup and backfills missing `PartProcess` rows + `JobFinalCheck`
rows for ALL existing lines — but it never calls
`MESService.create_assembly_steps_for_line()`. So any production line that:

- has a real joint tag (`joint_type_code` set), AND
- was created/synced BEFORE the Assembly Chain feature was deployed,

...has zero `assembly_steps` rows, so its Assembly tab stays hidden forever
(the frontend correctly hides the tab when `assemblySteps.length === 0` —
that part is working as designed; the data just was never created for that
line). This matches the screenshot: line CJ112 / S-EJ-F-1MF-S-L shows
Material Status / Fabrication / Welding & Grinding / Final Checks, but no
Assembly tab.

Manually clicking "Recategorize" on one line at a time works around it, but a
backfill fixes every existing tagged line at once, automatically, on the next
deploy.

## Tasks

1. **Backfill assembly steps for existing tagged lines (the real fix)**
   - In `backend/services/itemwise_backfill.py`, inside the per-line loop in
     `backfill_itemwise()`, after the existing
     `MESService.create_final_checks_for_line(db, line.id)` call, add:
     ```python
     if getattr(line, "joint_type_code", None):
         from backend.services import joint_catalog
         if joint_catalog.get_type(line.joint_type_code):
             MESService.create_assembly_steps_for_line(db, line.id, line.joint_type_code)
     ```
   - `create_assembly_steps_for_line` is already idempotent (skips `step_no`
     values already present, never resets a step already marked `"ready"`) —
     safe to run on every startup exactly like the rest of the backfill.
   - This must NOT run for lines with no `joint_type_code` (legacy/untagged) —
     `joint_catalog.get_type()` returns `None` for those, so the guard above
     already enforces the no-retroactive-change rule.

2. **Spot-check the 12-tag BOM / process / assembly data against the spec
   workbook** — no code changes expected (already verified matching), just a
   confidence pass while the reference file is open.

3. **Optional — only if the workbook's "Open Items" sheet has been filled
   in**: extend `PROCESS_ROUTES` / `COMPONENT_WEIGHTS` (in
   `backend/services/templates.py`) or `ASSEMBLY_CHAINS` (in
   `backend/services/joint_catalog.py`) with tag-specific overrides for any
   component that needs to differ per tag. Today those are keyed by
   component name only and shared across every tag that uses that component.

4. **Verification**
   - Restart the backend (or redeploy) and confirm the Assembly tab now
     appears for pre-existing tagged lines like CJ112, alongside the other 4
     tabs.
   - Confirm a brand-new line with a tag still gets assembly steps at
     creation time (already working — don't break this).
   - Confirm an untouched legacy/untagged line shows exactly what it showed
     before: no Assembly tab, no new BOM rows, nothing retroactive. This is
     the guardrail check — it's the most important thing to verify.

## Out of scope for this pass
GM's formal sign-off on the Assembly Chain sequence itself. The app already
marks every assembly step "Pending GM sign-off"; that stays until GM
responds, per the standing instruction to implement the workbook as correct
now and revise later if GM's answers differ.
