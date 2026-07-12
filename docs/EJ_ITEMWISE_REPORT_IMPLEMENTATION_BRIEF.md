# EJ/DJ Itemwise Progress Report — Implementation Brief for Claude Code

**Prepared:** 12 Jul 2026 · **Target branch:** `demo` (never `main`) · **Source:** `EJ_Itemwise_Report_Redesign_Spec.xlsx` (GM review workbook, 10 Jul 2026)

**Working assumption (per Swayam, 12 Jul 2026):** GM's formal sign-off on this workbook is delayed. Treat every table in the workbook as correct and implement it now. Anything explicitly marked "pending GM confirmation" below must be built as a single, easily-editable data block so that when GM's answers come back, fixing them is a data edit, not a re-architecture.

**Hard scope rule (explicit instruction from the project owner):** every change in this brief must follow the *existing* opt-in pattern already built into this codebase (see `context.md`, "Legacy project handling," commit `4716981`):

- **New production lines** (created via Add Project with a Joint category + Tag selected) get the full new behavior automatically.
- **Existing/legacy production lines** (created before the tag system, or still un-recategorized) get **none** of the new tag-specific behavior until the user explicitly clicks **Recategorize** on that line in Edit Projects and selects an exact Joint + Tag. Only then does that line's BOM, fabrication tracking, and (per this brief) assembly-chain tracking get (re)built from the catalog.
- Do **not** retroactively change what any existing un-recategorized line shows or tracks. Do not run any backfill that alters `Part`/BOM data for legacy lines.
- The one narrow exception is described in Work Item 2 below (Box Packing) — read that section's justification before assuming it's an exception to this rule too.

---

## 1. Read this first — most of the workbook is already implemented

Before writing any code, open `backend/services/joint_catalog.py` and compare it line-by-line against the workbook's **"Per-Tag BOM & Process Spec"** sheet. They match exactly — all 12 tags (`S-EJ-F`, `S-EJ-F-S-L`, `S-EJ-F-1MF-S-L`, `S-EJ-F-2MF-S-L`, `S-EJ-W-S-L`, `U-EJ-F-S-L`, `U-EJ-F-1MF-S-L`, `U-EJ-F-2MF-S-L`, `U-EJ-W-S-L`, `DEJ-F`, `DEJ-F-1MF`, `DEJ-F-2MF`), every component, every FIXED/ENTER/DERIVED/STATUS kind, every quantity, every process route in `backend/services/templates.py`'s `PROCESS_ROUTES`. This was built in the session documented in `context.md` (2026-07-10) from the *same underlying source data* the GM workbook formalizes. **Do not re-implement, re-generate, or duplicate this catalog.** If you find a genuine mismatch during your own diff, flag it to the user before changing `joint_catalog.py` — do not silently "fix" it.

Also already implemented and matching the workbook's GM Question #5 ("job-level fields: Testing, Paint spec, Weight, Marking"): `JobFinalCheck` (`backend/services/db_service.py`) already has exactly these four check types (`testing`, `painting`, `weight`, `marking`) with `test_method` ("Hydro/Pneumatic"), `paint_spec`, `weight_kgs`, `marking_type` ("Hard Punch") fields, wired up in `MESService.FINAL_CHECK_TYPES` / `default_final_check_rows` (`backend/services/mes_service.py`) and rendered in the "Final Checks" tab of `next-frontend/src/app/(main)/production/entry/page.tsx`. No changes needed here except the one addition in Work Item 2.

The **"Source Errors & Fixes"** sheet requires **zero code changes** — items #3 and #4 explicitly note "app already correct," and the rest are about the paper form / numbering Excel file, not the app.

### What's genuinely new and must be built
1. **Assembly Chain tracking per tag** — the workbook's "Assembly Chain (CONFIRM)" sheet has no equivalent anywhere in the current app. This is the main piece of new work. (Work Item 1)
2. **Box packing / dispatch tracking** — mentioned on the paper form, absent from the BOM and the app. (Work Item 2)
3. A few UI/vocabulary polish items from "Part Name Reconciliation" (Work Item 3, optional/lower priority).

---

## 2. Work Item 1 — Assembly Chain per tag (new feature)

### 2a. Why this is scoped as "proposed, pending GM confirmation"

The workbook is explicit: *"These are proposed sub-assembly sequences for GM review, inferred from the BOM and general fabrication logic — they are NOT confirmed production instructions. The Universal (2-bellows) joint chains are the least certain."* Build the feature, but:
- Store the chain as one data table in `joint_catalog.py` (shown below) so revising a sequence after GM feedback is a data edit.
- Surface a small "Proposed — pending GM sign-off" badge in the UI wherever the assembly chain is shown, so shop-floor staff don't mistake it for confirmed process.

### 2b. Data — add to `backend/services/joint_catalog.py`

Add an `_assembly_chain` list constructor and an `"assembly_chain"` key to each entry in `JOINT_TYPES`. Use this exact data (transcribed from the "Assembly Chain (CONFIRM)" sheet):

```python
def _step(no, label):
    return {"step_no": no, "label": label}

ASSEMBLY_CHAINS = {
    "S-EJ-F": [
        _step(1, "Bellows (Element) + Collar → Sub-assembly 'A'"),
        _step(2, "'A' + Job Flanges → FINAL"),
    ],
    "S-EJ-F-S-L": [
        _step(1, "Bellows + Collar → 'A'"),
        _step(2, "'A' + Weldend → 'B'"),
        _step(3, "'B' + Job Flanges → 'C'"),
        _step(4, "'C' + Internal Sleeve → 'D'"),
        _step(5, "'D' + Lugs & Limit Rods → FINAL"),
    ],
    "S-EJ-F-1MF-S-L": [
        _step(1, "Bellows + Collar → 'A'"),
        _step(2, "'A' + Weldend → 'B'"),
        _step(3, "'B' + Job Flanges → 'C'"),
        _step(4, "'C' + Companion (Matching) Flanges → 'D'"),
        _step(5, "'D' + Internal Sleeve → 'E'"),
        _step(6, "'E' + Lugs & Limit Rods → FINAL"),
    ],
    "S-EJ-F-2MF-S-L": [
        _step(1, "Bellows + Collar → 'A'"),
        _step(2, "'A' + Weldend → 'B'"),
        _step(3, "'B' + Job Flanges → 'C'"),
        _step(4, "'C' + Companion (Matching) Flanges ×2 → 'D'"),
        _step(5, "'D' + Internal Sleeve → 'E'"),
        _step(6, "'E' + Lugs & Limit Rods → FINAL"),
    ],
    "S-EJ-W-S-L": [
        _step(1, "Bellows + Collar → 'A'"),
        _step(2, "'A' + Weldend → 'B'"),
        _step(3, "'B' + Internal Sleeve → 'C'"),
        _step(4, "'C' + Lugs & Limit Rods → FINAL"),
    ],
    "U-EJ-F-S-L": [
        _step(1, "Bellows-1 + Collars → 'A1'"),
        _step(2, "Bellows-2 + Collars → 'A2'"),
        _step(3, "'A1' + 'A2' + Weldend (centre) → 'B'"),
        _step(4, "'B' + Job Flanges → 'C'"),
        _step(5, "'C' + Internal Sleeves → 'D'"),
        _step(6, "'D' + Lugs & Limit Rods → FINAL"),
    ],
    "U-EJ-F-1MF-S-L": [
        _step(1, "Bellows-1 + Collars → 'A1'"),
        _step(2, "Bellows-2 + Collars → 'A2'"),
        _step(3, "'A1' + 'A2' + Weldend (centre) → 'B'"),
        _step(4, "'B' + Job Flanges → 'C'"),
        _step(5, "'C' + Companion (Matching) Flanges → 'D'"),
        _step(6, "'D' + Internal Sleeves → 'E'"),
        _step(7, "'E' + Lugs & Limit Rods → FINAL"),
    ],
    "U-EJ-F-2MF-S-L": [
        _step(1, "Bellows-1 + Collars → 'A1'"),
        _step(2, "Bellows-2 + Collars → 'A2'"),
        _step(3, "'A1' + 'A2' + Weldend (centre) → 'B'"),
        _step(4, "'B' + Job Flanges → 'C'"),
        _step(5, "'C' + Companion (Matching) Flanges ×2 → 'D'"),
        _step(6, "'D' + Internal Sleeves → 'E'"),
        _step(7, "'E' + Lugs & Limit Rods → FINAL"),
    ],
    "U-EJ-W-S-L": [
        _step(1, "Bellows-1 + Collars → 'A1'"),
        _step(2, "Bellows-2 + Collars → 'A2'"),
        _step(3, "'A1' + 'A2' + Spool (centre) → 'B'"),
        _step(4, "'B' + Weldend → 'C'"),
        _step(5, "'C' + Job Flanges → 'D'"),
        _step(6, "'D' + Internal Sleeves → 'E'"),
        _step(7, "'E' + Lugs & Limit Rods → FINAL"),
    ],
    "DEJ-F": [
        _step(1, "Flange FP1 + Pipe-1 → 'A'"),
        _step(2, "Flange FP2 + Pipe-2 → 'B'"),
        _step(3, "Stopper Flange FS + Stopper Patti → 'C'"),
        _step(4, "'A' + 'B' + 'C' + Studs & O-rings → FINAL"),
    ],
    "DEJ-F-1MF": [
        _step(1, "Flange FP1 + Pipe-1 → 'A'"),
        _step(2, "Flange FP2 + Pipe-2 → 'B'"),
        _step(3, "Stopper Flange FS + Stopper Patti → 'C'"),
        _step(4, "'A' + 'B' + 'C' + Studs & O-rings → 'D'"),
        _step(5, "'D' + Companion (Matching) Flange → FINAL"),
    ],
    "DEJ-F-2MF": [
        _step(1, "Flange FP1 + Pipe-1 → 'A'"),
        _step(2, "Flange FP2 + Pipe-2 → 'B'"),
        _step(3, "Stopper Flange FS + Stopper Patti → 'C'"),
        _step(4, "'A' + 'B' + 'C' + Studs & O-rings → 'D'"),
        _step(5, "'D' + Companion (Matching) Flanges ×2 → FINAL"),
    ],
}
```

Wire it into each `JOINT_TYPES` entry as `"assembly_chain": ASSEMBLY_CHAINS["<tag_no>"]` (or look it up by `tag_no` in a loop after the list is defined — either is fine, keep it terse like the rest of the file). Add a lookup helper:

```python
def assembly_chain_for(tag_no):
    """Ordered proposed sub-assembly steps for a tag. Empty list if none (legacy/unknown tag)."""
    jt = _BY_TAG.get(tag_no)
    return jt.get("assembly_chain", []) if jt else []
```

Also include `"assembly_chain"` in the `list_catalog()` output per type (next to `"components"`), so the Master Data page and the Add/Edit Project cascading UI can read it too.

### 2c. New table — `backend/services/db_service.py`

Add a new model, following the exact shape/spirit of `JobFinalCheck` (simple per-line status, not per-quantity — the workbook's own GM Question #1 leaves per-piece serial tracking undecided, so default to line-level status, consistent with how Paint is tracked):

```python
class AssemblyStep(Base):
    __tablename__ = "assembly_steps"
    id = Column(Integer, primary_key=True, index=True)
    production_line_id = Column(Integer, ForeignKey("project_production_lines.id"), nullable=False)
    step_no = Column(Integer, nullable=False)
    label = Column(String, nullable=False)          # e.g. "'A' + Job Flanges → 'C'"
    status = Column(String, default="pending")       # pending | in_process | ready
    date_ready = Column(Date, nullable=True)
    notes = Column(Text, nullable=True)

    __table_args__ = (UniqueConstraint("production_line_id", "step_no", name="uq_assembly_step_line_no"),)
```

This is a **brand-new table**, so `Base.metadata.create_all(bind=engine)` in `init_db()` creates it automatically on next backend start — no `ALTER TABLE` migration entry needed (those are only for adding columns to *existing* tables, per the pattern already used for `joint_category`/`joint_type_code`/etc.).

### 2d. Backend service — `backend/services/mes_service.py`

Add a creation helper mirroring `create_parts_for_production_line`'s tag-driven branch, and a sync helper mirroring `sync_part_targets`:

```python
@staticmethod
def create_assembly_steps_for_line(db, line_id, tag_no):
    """Create AssemblyStep rows from the tag's proposed chain. No-op for legacy/untagged lines."""
    if not tag_no or not joint_catalog.get_type(tag_no):
        return
    existing = {s.step_no for s in db.query(AssemblyStep).filter_by(production_line_id=line_id).all()}
    for step in joint_catalog.assembly_chain_for(tag_no):
        if step["step_no"] in existing:
            continue
        db.add(AssemblyStep(production_line_id=line_id, step_no=step["step_no"], label=step["label"]))
```

Call this from `create_parts_for_production_line`'s tag-driven branch (the `if tag and joint_catalog.get_type(tag):` block, right where `MESService.create_final_checks_for_line(db, line.id)` is already called) — **not** from `_create_parts_legacy`. This guarantees: brand-new tagged lines get assembly steps; legacy lines that stay un-recategorized never do; and because a recategorized line goes through `sync_project_production_lines`'s "identity changed → delete old line, create new line" path (see `production_service.py` `_line_identity`/`sync_project_production_lines`, confirmed by reading it directly), a recategorized legacy line hits this exact same tag-driven branch and gets its assembly steps built fresh — matching the same "BOM rebuilt from scratch on recategorize" behavior already documented for Parts in `context.md`.

For the "quantity or ENTER values changed on an already-tagged line" path (`sync_part_targets`), assembly steps don't depend on quantity, so just ensure they exist without touching status — call `create_assembly_steps_for_line` there too (it's idempotent by design, checking `existing` first, so it never resets a step someone already marked `ready`).

### 2e. Backend API — `backend/app/production/router.py`

1. In `get_requirement_parts` (the `GET /parts/{req_id}` handler), add an `assembly_steps` array to the response, same style as `checks_data`:
```python
steps = db.query(AssemblyStep).filter_by(production_line_id=line.id).order_by(AssemblyStep.step_no).all()
steps_data = [{
    "id": s.id, "step_no": s.step_no, "label": s.label, "status": s.status,
    "date_ready": s.date_ready.isoformat() if s.date_ready else None, "notes": s.notes,
} for s in steps]
```
Add `"assembly_steps": steps_data` to the returned `data` dict. Import `AssemblyStep` from `backend.services.db_service`.

2. Add a new endpoint mirroring `update_final_check`:
```python
class AssemblyStepUpdate(BaseModel):
    status: Optional[str] = None
    date_ready: Optional[date] = None
    notes: Optional[str] = None

@router.put("/assembly-steps/{step_id}")
def update_assembly_step(step_id: int, body: AssemblyStepUpdate, db: Session = Depends(get_db),
                          current_user: dict = Depends(require_roles(["Developer", "GM", "Admin", "Production Manager", "Supervisor"]))):
    step = db.query(AssemblyStep).filter_by(id=step_id).first()
    if not step:
        raise HTTPException(status_code=404, detail="Assembly step not found")
    for field, value in body.model_dump(exclude_unset=True).items():
        setattr(step, field, value)
    db.add(AuditLog(..., action="Update", table_name="assembly_steps", record_id=step.id,
                     details=f"Updated assembly step {step.step_no} -> status={step.status}"))
    db.commit()
    return {"success": True, "message": f"Updated assembly step {step.step_no}"}
```
(Fill in the `AuditLog` user fields exactly as `update_final_check` does above it — copy that pattern, don't diverge.)

### 2f. Frontend — `next-frontend/src/app/(main)/production/entry/page.tsx`

Do **not** add a new tab. The existing "Fabrication" tab's display label is already `"Fabrication & Assembly"` (see the ternary around line 361 building tab labels) — the original naming already anticipated this feature. Add the assembly-chain section **inside** the existing `activeTab === "Fabrication"` block, as a new full-width card appended after the parts grid (after the `))}` that closes the `.map((part) => ...)` over `parts`, and after the "No Parts Found" empty-state check, i.e. right before that block's closing `</div>` around line 550).

- Add `assembly_steps: {id, step_no, label, status, date_ready, notes}[]` to the `PartRow`-adjacent state (a new `assemblySteps` state array, set alongside `setParts`/`setFinalChecks` in the same `useEffect` that fetches `/production/parts/{requirementId}`).
- Render: if `assemblySteps.length === 0`, show nothing extra (covers legacy/un-recategorized lines — don't show an empty "Assembly" card for them, since there's no chain to show). If non-empty, render a `Card` titled "Proposed Assembly Sequence" with a `Badge tone="warning"` reading "Pending GM sign-off" next to the title, then an ordered list of steps (`step_no` + `label`), each with a status toggle button styled exactly like the Final Checks "Mark Ready"/"Mark Pending" button (`handleUpdateCheck`'s pattern) — add a new `handleUpdateAssemblyStep(stepId, patch)` function copied from `handleUpdateCheck`, pointed at `PUT /production/assembly-steps/{id}`.
- Also extend the `master/page.tsx` "Joint Types & BOM" card: wherever it currently iterates a tag's `components` to render the BOM table, add a second read-only sub-list underneath rendering that tag's `assembly_chain` (from the now-extended `/master/joint-types` payload), with the same "pending GM sign-off" badge. This gives management a single place to review/print all 12 proposed chains before sending them back to GM.

---

## 3. Work Item 2 — Box Packing / Dispatch tracking

The workbook's "Part Name Reconciliation" sheet and GM Question #4 both flag: *"Box packing is on the [paper] report but not in the BOM. Should [it] be trackable everywhere?"* Answer assumed **yes** per the "implement now, revise if GM says otherwise" instruction.

**Why this one item is treated as line-agnostic (applies to legacy lines too), unlike Work Item 1:** `testing`/`painting`/`weight`/`marking` already apply uniformly to *every* production line regardless of tag status — `MESService.create_final_checks_for_line` is called from both the tag-driven and legacy branches of `create_parts_for_production_line`, and `backend/services/itemwise_backfill.py`'s `backfill_itemwise()` already runs `create_final_checks_for_line` unconditionally for every existing line on every backend startup (see `backend/main.py`'s startup migration block). Box packing is a job-level dispatch checkbox, not a BOM/fabrication component — it's the same *kind* of thing as Testing/Weight/Marking, not the same kind of thing as a tag's Parts list. Treating it identically to those four (i.e., adding it everywhere, purely additively, no Part/BOM data touched) is consistent with existing precedent and carries no risk of altering any line's BOM. If you want to be extra conservative, flag this specific call to the user before running it — but per the existing pattern it should be safe to just extend it.

### Changes

1. `backend/services/mes_service.py`: add `"packing"` to `MESService.FINAL_CHECK_TYPES` and to `default_final_check_rows`'s `defaults` dict (empty `{}`  is fine, same as `"painting"`/`"weight"`).
2. `backend/app/production/schemas.py`: no change needed — `FinalCheckUpdate` already has generic `status`/`notes`/`date_ready`/`date_pending` fields that work for any `check_type`.
3. **Frontend — critical, easy to miss:** `next-frontend/src/app/(main)/production/entry/page.tsx` line ~619 has a **hardcoded** filter: `finalChecks.filter((c) => ["testing", "painting", "weight", "marking"].includes(c.check_type))`. Add `"packing"` to that array or the new check type will exist in the database and API response but silently never render. Also add a `"packing"` case to the label if you want anything more specific than the default `capitalize` styling already applied to `c.check_type` (the current rendering already title-cases generically, so this may need no further change beyond the filter array).
4. Because `backfill_itemwise()` already runs `create_final_checks_for_line` for every existing line unconditionally on every startup, adding `"packing"` to `FINAL_CHECK_TYPES` is sufficient — the next backend restart on `demo` will backfill a `packing` row onto every line, new and legacy alike, with zero Part/BOM changes. No new migration script needed.

---

## 4. Work Item 3 — Part-name reconciliation polish (lower priority, optional)

The app's canonical component names (`Element`, `Liner`, `Flange`, `Matching Flanges`, `Stopper Patti`, `Studs Long`/`Studs Short`, `Pipe-1`/`Pipe-2`, etc. — see `joint_catalog.py`) already match the workbook's "App Code Name" column exactly, and that's the vocabulary the tag-driven UI already shows everywhere. No functional renaming is needed.

The one gap: shop-floor staff who know the paper form's older names (`Bellows (B)`, `Job Flanges (F)`, `Companion Flanges (CF)`, `Internal Sleeve (IS)`, `Limit Rods (LR)`) may not immediately recognize the app's canonical names. If you want to close this gap cheaply: add a small `title`/tooltip attribute on each BOM component label in the Master Data "Joint Types & BOM" card, sourced from a small static `PAPER_FORM_ALIASES` dict in `joint_catalog.py` (built directly from the workbook's "Part Name Reconciliation" sheet — Progress-Report Form Name column), e.g. `Element → "Bellows (B)"`, `Liner → "Internal Sleeve (IS)"`, `Flange → "Job Flanges (F)"`, `Matching Flanges → "Companion Flanges (CF)"`. This is presentation-only, touches no tracked data, and is safe to skip if time-constrained — flag it as a nice-to-have, not a blocker for the demo push.

Do **not** touch the legacy `EXPANSION_JOINT_TEMPLATE`/`DISMANTLING_JOINT_TEMPLATE` names in `templates.py` (`"Bellows (B)"`, `"Compensator Flanges (F)"`, etc.) — those are intentionally frozen as the fallback for pre-tag lines and are out of scope per the guardrail in Section 0.

---

## 5. GM Questions — assumptions adopted for this demo push

| # | Question | Assumption adopted now | Where it lives if GM answers differently |
|---|---|---|---|
| 1 | Report granularity: per job/tag vs. generic master sheets; per-piece serial rows vs. one row + qty column | Already built as per-tag, per-line-with-quantity-column (the "recommended" option) — no change | N/A, matches current architecture |
| 2 | Assembly step sequence per tag, esp. Universal 2-bellows chains | Implement the proposed chains as-is (Section 2b), flagged "pending GM sign-off" in the UI | Edit the `ASSEMBLY_CHAINS` dict in `joint_catalog.py` — one data edit, no UI/API changes needed |
| 3 | Canonical part names | Adopt "App Code Name" column — already the case | N/A |
| 4 | Bolts/Nuts + Box packing trackable everywhere | Bolts/Nuts already tracked (ENTER component on relevant tags); Box packing added per Work Item 2 | Remove `"packing"` from `FINAL_CHECK_TYPES` if GM says no |
| 5 | Job-level fields: Testing/Paint spec/Weight/Marking | Already fully implemented via `JobFinalCheck` | N/A |
| 6 | What drives ENTER quantities (Limit rod, Studs, Bolts&Nuts, MF Gaskets) at order time | No schema change; still free-text per-unit entry at order time (size/PN rating assumed to inform the value, entered manually) | N/A unless GM wants a lookup table — that would be new scope |

---

## 6. Explicit guardrails for the implementation session

- **Branch:** commit and push to `demo` only. Never merge into `main` or push there without the user's explicit go-ahead (per `CLAUDE.md`).
- **Database:** PostgreSQL only, per `CLAUDE.md` — do not introduce SQLite anywhere, do not add new dependencies to `backend/requirements.txt` (root `requirements.txt` only, since Railway builds from root).
- **Do not touch:** `joint_catalog.py`'s existing `JOINT_TYPES` component/quantity data, `templates.py`'s `PROCESS_ROUTES`/`COMPONENT_WEIGHTS`/legacy templates, `mes_service.py`'s `calculate_project_progress` weighting formula, or anything in the "already implemented" list in Section 1 — these are correct and tested; re-touching them is out of scope and risks the exact kind of regression `mistakes.md` #3 and #4 describe.
- **UI conventions:** follow `docs/UI_DESIGN_SYSTEM.md` — use the shared `next-frontend/src/components/ui/` component library (`Card`, `Badge`, `Button`, `Input`, `Modal`, etc.), never `window.alert()`/`confirm()`/`prompt()`, never interpolate Tailwind class names at runtime (map to a literal lookup instead), keep `Th`/`Td` `numeric` props in sync if you touch any table.
- **Read `docs/EJ_DJ_CALCULATION_LOGIC.md`** before touching anything that looks like it might overlap welding-feet or progress-percentage math — it isn't in scope for this brief, but Work Item 1/2 additions must not change `calculate_project_progress`'s existing 70% fabrication / 30% welding blend or the final-check gate. Assembly-step and packing-check status should be informational/trackable but should NOT be wired into that progress-percentage formula unless the user asks for that explicitly later — keep this brief's scope to "make it trackable," not "make it gate overall progress," since that's a judgment call GM hasn't weighed in on.
- **Read `projectprogress.md`'s latest entries and `context.md`** at the start of the session — both already exist and describe the exact architecture this brief builds on top of.
- **Update `projectprogress.md` and `context.md`-style handoff notes** at the end of the session per `CLAUDE.md`'s standing instruction, so the next session (post-GM-feedback) can pick this up.
- **`npm run build` and `git push origin demo`** could not be verified from a prior session's sandbox (no outbound npm-registry/git-push network access there per `context.md`'s "Current repo / verification state") — if the same constraint applies in the Claude Code session doing this work, hand-verify the TSX changes carefully (types, prop signatures against the actual `Modal`/`Badge`/etc. components) and flag to the user that `npm run build` should be run from their own terminal before the demo deploy is trusted.

---

## 7. Verification checklist

1. **New tagged line:** create a project with a new production line, pick a Joint category + Tag (e.g. `U-EJ-F-1MF-S-L`), enter a quantity and the ENTER components (Limit rod, Bolts & Nuts). Confirm: Parts/BOM scale correctly (unchanged behavior — regression check only), a `Paint` status field appears, all 5 `JobFinalCheck` rows including `packing` are created, and `assembly_steps` are created matching the 7-step chain in Section 2b for that tag, all `pending`.
2. **Existing legacy line, not recategorized:** open an existing pre-tag project in Edit Projects. Confirm it still shows its "Expansion Joint (Legacy)"/"Dismantling Joint (Legacy)" badge (regression check), and in Shop Floor Entry, confirm no "Proposed Assembly Sequence" card renders for that line (since `assembly_steps` is empty) — but its `packing` final check *does* appear (per Work Item 2's intentional exception), alongside its pre-existing testing/painting/weight/marking checks.
3. **Recategorize an existing legacy line:** click Recategorize, pick a Joint + Tag, save. Confirm the line's BOM rebuilds (existing regression-tested behavior) and now also gets `assembly_steps` for the chosen tag, all `pending`.
4. **Mark an assembly step "ready"** in Shop Floor Entry, then edit that line's quantity in Edit Projects and re-save (triggering `sync_part_targets`/the new sync call). Confirm the previously-`ready` step is **not** reset to `pending` (idempotency check).
5. **Master Data page:** confirm the "Joint Types & BOM" card now also shows each tag's proposed assembly chain with the "pending GM sign-off" badge, for all 12 tags.
6. Run `npm --prefix next-frontend run build` and `npm --prefix next-frontend run lint` and resolve any TypeScript errors before considering this done.
