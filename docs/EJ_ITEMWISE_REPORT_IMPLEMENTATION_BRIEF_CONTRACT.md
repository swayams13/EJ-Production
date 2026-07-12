# CONTRACT — Assembly Chain per Tag (WI-1) + Box Packing (WI-2)

**Read this before touching any file.** Every coding agent in this workflow sees ONLY this file plus their one assigned source file. This document is the single source of truth for every name, type, JSON key, function signature, and import that more than one file must agree on. If your assigned file must match something here, match it **character-for-character**. Do not invent alternate spellings, casing, or shapes.

Scope of these two work items and nothing else:
- **WI-1 Assembly Chain per tag** — new `AssemblyStep` DB table, `ASSEMBLY_CHAINS` catalog data + helper, MES create/sync helper, new REST endpoint + `assembly_steps` on the existing parts response, entry-page UI card, master-page read-only sub-list.
- **WI-2 Box Packing** — add `"packing"` to the final-check types (backend) and to the hardcoded frontend filter array.

Do **not** wire assembly-step status or packing status into `calculate_project_progress`. They are informational/trackable only.

---

## 0. Canonical vocabulary (spell these EXACTLY)

| Concept | Canonical token | Where used |
|---|---|---|
| SQLAlchemy model class | `AssemblyStep` | db_service.py, mes_service.py, router.py |
| DB table name | `assembly_steps` | db_service.py `__tablename__`, AuditLog `table_name` |
| Unique constraint name | `uq_assembly_step_line_no` | db_service.py |
| Catalog data dict | `ASSEMBLY_CHAINS` | joint_catalog.py |
| Catalog step constructor | `_step` | joint_catalog.py |
| Catalog lookup helper | `assembly_chain_for` | joint_catalog.py, mes_service.py |
| MES create/sync helper | `create_assembly_steps_for_line` | mes_service.py, router (not called from router, but same name family) |
| Pydantic request model | `AssemblyStepUpdate` | router.py (defined inline in router.py) |
| REST update endpoint | `PUT /api/v1/production/assembly-steps/{step_id}` | router.py, entry/page.tsx |
| JSON key on GET /parts/{req_id} | `assembly_steps` | router.py, entry/page.tsx |
| JSON key on GET /master/joint-types per-type | `assembly_chain` | joint_catalog.py `list_catalog()`, master/page.tsx |
| New final-check type value | `packing` (lowercase) | mes_service.py, entry/page.tsx filter |
| TS interface (DB-backed, entry page) | `AssemblyStep` | entry/page.tsx |
| TS state var (entry page) | `assemblySteps` / `setAssemblySteps` | entry/page.tsx |
| TS handler (entry page) | `handleUpdateAssemblyStep` | entry/page.tsx |
| TS interface (catalog, master page) | `AssemblyChainStep` | master/page.tsx |
| Warning badge text | `Pending GM sign-off` | entry/page.tsx and master/page.tsx, `<Badge tone="warning">` |

**Two DIFFERENT step shapes exist — do not conflate them:**
- **DB-backed step** (per production line, has `id` + `status` + `date_ready` + `notes`): returned by `GET /parts/{req_id}` under `assembly_steps`, edited via `PUT /assembly-steps/{id}`, rendered on the entry page.
- **Catalog step** (per tag, just `step_no` + `label`, read-only, no id/status): returned by `GET /master/joint-types` under each type's `assembly_chain`, rendered on the master page.

---

## 1. `backend/services/db_service.py` — new model

**No new imports needed.** Line 3 already imports `Column, Integer, String, Date, ForeignKey, Text, UniqueConstraint` — all that `AssemblyStep` uses.

**Insertion point:** immediately AFTER the `JobFinalCheck` class (which ends at line 167 with its `__table_args__`) and BEFORE `class WeldingLog(Base):` (line 169). Mirror `JobFinalCheck`'s style exactly.

Add verbatim:

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

**Do NOT** add an `ALTER TABLE` line to `init_db()`. This is a brand-new table; `Base.metadata.create_all(bind=engine)` (line 276) creates it automatically. Adding a migration entry is wrong (those are only for adding columns to existing tables).

Column facts every consumer must rely on: `status` default is `"pending"`; allowed status values are `pending | in_process | ready`; there is **no** `date_pending`, **no** `is_required`, **no** `updated_by`/`updated_at` on this table (unlike `JobFinalCheck`).

---

## 2. `backend/services/joint_catalog.py` — data + helper + list_catalog

### 2.1 Insertion point
Insert the `_step` constructor, the full `ASSEMBLY_CHAINS` literal, the wiring loop, and the `assembly_chain_for` helper **immediately after the `_BY_TAG` definition** (line 212: `_BY_TAG = {jt["tag_no"]: jt for jt in JOINT_TYPES}`) and **before `def get_type(tag_no):`** (line 215). The wiring loop needs both `JOINT_TYPES` and `_BY_TAG`, both defined by line 212.

### 2.2 The `_step` constructor and full `ASSEMBLY_CHAINS` literal — TRANSCRIBE VERBATIM
This is domain data from the GM-review workbook. Copy it **exactly** — every step label, every quote character `'`, every `→`, every `×2`, every `(centre)`. Do not re-derive, reorder, or "clean up" punctuation.

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

### 2.3 Wiring loop + helper — add directly below the `ASSEMBLY_CHAINS` literal (still before `def get_type`)

```python
# Attach each tag's proposed assembly chain onto its JOINT_TYPES entry.
for _jt in JOINT_TYPES:
    _jt["assembly_chain"] = ASSEMBLY_CHAINS.get(_jt["tag_no"], [])


def assembly_chain_for(tag_no):
    """Ordered proposed sub-assembly steps for a tag. Empty list if none (legacy/unknown tag)."""
    jt = _BY_TAG.get(tag_no)
    return jt.get("assembly_chain", []) if jt else []
```

`assembly_chain_for(tag_no)` returns a list of `{"step_no": int, "label": str}` dicts, or `[]`. This is the exact shape `mes_service.create_assembly_steps_for_line` iterates (`step["step_no"]`, `step["label"]`).

### 2.4 `list_catalog()` — surface `assembly_chain` per type
Inside `list_catalog()` (lines 239–274), in the per-type dict appended to `types` (lines 250–268), add the key `"assembly_chain"` **right after the `"components": [ ... ]` list closes (after line 264) and before `"variable_components"` (line 265)**:

```python
                "assembly_chain": jt.get("assembly_chain", []),
```

Result: each type object in `GET /master/joint-types` → `data[].types[]` now carries `assembly_chain: [{step_no, label}, ...]` alongside the existing `tag_no`, `description`, `weld_family`, `components`, `variable_components`.

---

## 3. `backend/services/mes_service.py`

### 3.1 Import (top of file, lines 3–5)
Add `AssemblyStep` to the existing `from backend.services.db_service import (...)` tuple:

```python
from backend.services.db_service import (
    Project, ProjectProductionLine, Part, PartProcess, ProductionLog, JobFinalCheck, AssemblyStep
)
```

### 3.2 WI-2: add `"packing"` to final checks (two edits)
- Line 11: `FINAL_CHECK_TYPES = ["testing", "painting", "weight", "marking", "packing"]`
- In `default_final_check_rows`'s `defaults` dict (lines 15–20), add `"packing": {}` (empty defaults, same as `"painting"`/`"weight"`):

```python
        defaults = {
            "testing": {"test_method": "Hydro/Pneumatic"},
            "painting": {},
            "weight": {},
            "marking": {"marking_type": "Hard Punch"},
            "packing": {},
        }
```

No other change needed for packing — `create_final_checks_for_line` iterates `FINAL_CHECK_TYPES` and is idempotent (skips existing `check_type`s).

### 3.3 WI-1: new helper `create_assembly_steps_for_line`
**Signature (exact):** `create_assembly_steps_for_line(db, line_id, tag_no)` — a `@staticmethod`. Note it takes `line_id` (an int), NOT a line object.

**Insertion point:** immediately after the `create_final_checks_for_line` static method (which ends at line 32) and before `final_check_gate` (line 34). Add verbatim:

```python
    @staticmethod
    def create_assembly_steps_for_line(db: Session, line_id: int, tag_no: str = None):
        """Create AssemblyStep rows from the tag's proposed chain. No-op for legacy/untagged lines.
        Idempotent: skips step_no values already present, so it never resets a step marked ready."""
        if not tag_no or not joint_catalog.get_type(tag_no):
            return
        existing = {s.step_no for s in db.query(AssemblyStep).filter_by(production_line_id=line_id).all()}
        for step in joint_catalog.assembly_chain_for(tag_no):
            if step["step_no"] in existing:
                continue
            db.add(AssemblyStep(production_line_id=line_id, step_no=step["step_no"], label=step["label"]))
```

### 3.4 WI-1: call the helper from the tag-driven create branch
In `create_parts_for_production_line`, the tag branch ends with `MESService.create_final_checks_for_line(db, line.id)` (line 98) then `return line` (line 99). Add the assembly-steps call between them, using the local `tag` variable (defined at line 70):

```python
            MESService.create_final_checks_for_line(db, line.id)
            MESService.create_assembly_steps_for_line(db, line.id, tag)
            return line
```

**Do NOT** call it from `_create_parts_legacy` (lines 104–130). Legacy/untagged lines get no assembly steps.

### 3.5 WI-1: call the helper from `sync_part_targets` (idempotent ensure)
In `sync_part_targets` (lines 132–184), the local `tag` variable is defined at line 141 and the early-return guard at lines 142–143 already ensures `tag` is a valid catalog tag past that point. At the **end** of the method (after the deletion loop that ends at line 184), add:

```python
        MESService.create_assembly_steps_for_line(db, line.id, tag)
```

Because the helper checks `existing` first, this never resets a step someone already marked `ready`, and assembly steps don't depend on quantity — this call only backfills any missing steps.

---

## 4. `backend/app/production/router.py`

### 4.1 Imports
- Line 6: add `AssemblyStep` to the `from backend.services.db_service import (...)`:
  ```python
  from backend.services.db_service import get_db, ProjectProductionLine, PartProcess, ProductionLog, User, AuditLog, JobFinalCheck, AssemblyStep
  ```
- Add a new import near the top (line 3/4 area): `from typing import Optional` — **currently NOT imported in this file** and required by `AssemblyStepUpdate`. `date` is already imported (line 3), `BaseModel` already imported (line 4).

### 4.2 Add `assembly_steps` to `GET /parts/{req_id}` response
In `get_requirement_parts` (lines 27–74): after the `checks_data` list comprehension (ends line 64) and before the `return {...}` (line 65), add:

```python
    steps = db.query(AssemblyStep).filter_by(production_line_id=line.id).order_by(AssemblyStep.step_no).all()
    steps_data = [{
        "id": s.id, "step_no": s.step_no, "label": s.label, "status": s.status,
        "date_ready": s.date_ready.isoformat() if s.date_ready else None, "notes": s.notes,
    } for s in steps]
```

Then add the key to the returned `data` dict (lines 65–74). Insert `"assembly_steps": steps_data,` alongside `"final_checks": checks_data,` (e.g. immediately after line 69):

```python
        "final_checks": checks_data,
        "assembly_steps": steps_data,
```

**Exact response shape of each element in `assembly_steps`:**
```json
{ "id": 12, "step_no": 1, "label": "Bellows + Collar → 'A'", "status": "pending", "date_ready": null, "notes": null }
```
`date_ready` is an ISO date string (`"YYYY-MM-DD"`) or `null`. `status` is one of `pending | in_process | ready`. The array is ordered by `step_no` ascending. For legacy/untagged lines it is `[]`.

### 4.3 New endpoint `PUT /assembly-steps/{step_id}`
**Insertion point:** immediately after the `update_final_check` handler (ends line 158) and before the `from backend.app.production.schemas import WeldingLogCreate` line (line 160). Define the Pydantic model **inline in router.py** (mirroring how `PaintStatusUpdate` is defined inline at line 126; do NOT put it in schemas.py). Add verbatim:

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
    db_user = db.query(User).filter_by(username=current_user["username"]).first() if current_user else None
    db.add(AuditLog(
        user_id=db_user.id if db_user else None,
        username=current_user["username"] if current_user else None,
        action="Update", table_name="assembly_steps", record_id=step.id,
        details=f"Updated assembly step {step.step_no} -> status={step.status}",
    ))
    db.commit()
    return {"success": True, "message": f"Updated assembly step {step.step_no}"}
```

Notes: the role list is `["Developer", "GM", "Admin", "Production Manager", "Supervisor"]` (same as `update_final_check`, i.e. NO "Worker"). Response is `{"success": true, "message": "..."}`. `AssemblyStepUpdate` has exactly three optional fields: `status`, `date_ready`, `notes` — there is no `is_required`, `date_pending`, or `step_no`/`label` on the update body (labels/step_no are catalog-owned, not editable).

---

## 5. `next-frontend/src/app/(main)/production/entry/page.tsx`

### 5.1 WI-2 fix — the hardcoded filter (CRITICAL, quote to locate)
Current line 619 reads exactly:

```tsx
                  {finalChecks.filter((c) => ["testing", "painting", "weight", "marking"].includes(c.check_type)).map((c) => (
```

Change the array to include `"packing"`:

```tsx
                  {finalChecks.filter((c) => ["testing", "painting", "weight", "marking", "packing"].includes(c.check_type)).map((c) => (
```

Nothing else needed for packing: the card title uses `capitalize` on `c.check_type` (line 622), so "Packing" renders correctly with no extra case. The grid is `lg:grid-cols-4` (line 618) and will hold 5 cards fine.

### 5.2 WI-1 — TypeScript interface (DB-backed step)
Add this interface next to the existing `FinalCheck` interface (which is at lines 35–47). Name it **exactly** `AssemblyStep`, fields matching §4.2 response:

```tsx
interface AssemblyStep {
  id: number;
  step_no: number;
  label: string;
  status: string;
  date_ready?: string | null;
  notes?: string | null;
}
```

### 5.3 WI-1 — state (mirror `finalChecks`)
Alongside `const [finalChecks, setFinalChecks] = useState<FinalCheck[]>([]);` (line 81), add:

```tsx
  const [assemblySteps, setAssemblySteps] = useState<AssemblyStep[]>([]);
```

### 5.4 WI-1 — fetch + reset (mirror `final_checks` in the same useEffect)
The parts-fetch `useEffect` runs on `[requirementId]` (lines 104–132).
- In the early-return block (lines 104–112, when `!requirementId`), add `setAssemblySteps([]);` alongside `setParts([])` etc.
- In the `.then` that reads `resData.data` (lines 115–122), where `setFinalChecks(resData.data.final_checks || [])` is (line 119), add on the next line:
  ```tsx
          setAssemblySteps(resData.data.assembly_steps || []);
  ```

### 5.5 WI-1 — update handler (copy `handleUpdateCheck`)
`handleUpdateCheck` is at lines 187–202. Add a sibling `handleUpdateAssemblyStep` right after it, identical pattern but pointed at the new endpoint. The refetch trick (`setRequirementId("")` then restore) must be preserved so the card reflects the new status.

```tsx
  const handleUpdateAssemblyStep = async (stepId: number, patch: Partial<AssemblyStep>) => {
    setSubmitting(true); setErrorMsg("");
    try {
      const res = await apiFetch(`${process.env.NEXT_PUBLIC_API_URL || "http://localhost:8003"}/api/v1/production/assembly-steps/${stepId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      if (!res.ok) { const e = await res.json(); throw new Error(e.detail || "Update failed"); }
      setSuccessMsg("Assembly step updated");
      const reqId = requirementId; setRequirementId(""); setTimeout(() => setRequirementId(reqId), 50);
      setTimeout(() => setSuccessMsg(""), 3000);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : String(err));
    } finally { setSubmitting(false); }
  };
```

The status toggle passes the same patch shape as the Final Checks button (line 647): `{ status: step.status === "ready" ? "pending" : "ready", date_ready: new Date().toISOString().slice(0, 10) }`.

### 5.6 WI-1 — the card (render location, exact)
Do **NOT** add a new tab. The card goes **inside** the existing `activeTab === "Fabrication"` block. That block is the JSX between line 465 (`) : activeTab === "Fabrication" ? (`) and its closing `</div>` at **line 550**. The parts grid `<div className="grid ...">` opens at line 466 and closes at line 550. Append the assembly card **after that grid's closing `</div>` (line 550) but still inside the Fabrication branch** — i.e. wrap the existing grid and the new card in a fragment, or place the card immediately after line 550's `</div>` and before the `) : (` at line 551.

Render rule:
- If `assemblySteps.length === 0`: render nothing (legacy/un-recategorized lines have no chain — do not show an empty card).
- If non-empty: render a `Card` titled **"Proposed Assembly Sequence"** with `<Badge tone="warning">Pending GM sign-off</Badge>` next to the title, then an ordered list of steps (`step_no` + `label`), each row with a status toggle `Button` styled exactly like the Final Checks Mark Ready/Mark Pending button (lines 643–650): `variant={step.status === "ready" ? "secondary" : "primary"}`, label `step.status === "ready" ? "Mark Pending" : "Mark Ready"`, `onClick={() => handleUpdateAssemblyStep(step.id, { status: step.status === "ready" ? "pending" : "ready", date_ready: new Date().toISOString().slice(0, 10) })}`, `disabled={submitting}`. Show the current status via `<Badge tone={step.status === "ready" ? "success" : "neutral"}>{step.status}</Badge>` (same pattern as line 623).

Imports already available at line 5 (`Card, Badge, Button` all imported). `warning` is a valid `Badge` tone (see §7).

---

## 6. `next-frontend/src/app/(main)/master/page.tsx` — read-only catalog sub-list

The master page fetches `GET /api/v1/master/joint-types` and stores it in `jointTypes` (lines 92–99). After §2.4, each type now carries `assembly_chain`.

### 6.1 Types
Add a catalog-step interface (distinct from the entry page's DB-backed `AssemblyStep` — this one has NO id/status) near the existing `JointComponent`/`JointTypeDef` interfaces (lines 27–41):

```tsx
interface AssemblyChainStep {
  step_no: number;
  label: string;
}
```

Extend `JointTypeDef` (lines 35–41) with:

```tsx
  assembly_chain?: AssemblyChainStep[];
```

### 6.2 Render — reuse the existing per-tag BOM rendering pattern
Each tag renders inside the per-type `<div key={t.tag_no} className="rounded-md border border-line p-4">` (opens line 488, closes line 522). The BOM `<Table>` closes at line 516, and the optional "Variable components" `<p>` is at lines 517–521. Add the assembly-chain sub-list **after that `<p>` block (after line 521) and before the div's closing `</div>` (line 522)**.

Render rule: only if `t.assembly_chain && t.assembly_chain.length > 0`. Surface it as a read-only ordered list (reuse the same `Card`/`Table` visual vocabulary already in this file — a small heading plus an ordered list of `step_no`. `label` is acceptable), with the `Badge tone="warning"` reading **"Pending GM sign-off"** next to the sub-list heading, matching the entry page. This is read-only here — no buttons, no PUT calls. Example shape (styling should match the file's existing idiom):

```tsx
{t.assembly_chain && t.assembly_chain.length > 0 && (
  <div className="mt-3">
    <div className="mb-2 flex items-center gap-2">
      <h4 className="font-display text-xs font-bold uppercase tracking-wide text-ink">Proposed Assembly Sequence</h4>
      <Badge tone="warning">Pending GM sign-off</Badge>
    </div>
    <ol className="list-decimal pl-5 text-[13px] text-ink-soft">
      {t.assembly_chain.map((s) => (
        <li key={s.step_no}>{s.label}</li>
      ))}
    </ol>
  </div>
)}
```

`Badge` is already imported (lines 5–23). This gives management one place to review/print all 12 proposed chains.

---

## 7. Shared UI facts (do not change these files)

- `Badge` (`next-frontend/src/components/ui/Badge.tsx`) accepts `tone` of exactly: `"brand" | "success" | "warning" | "critical" | "neutral"`. **`"warning"` is valid** and is the tone both WI-1 UIs must use for the "Pending GM sign-off" badge. `Badge` takes only `tone` and `children` — no other props.
- Both `Card` and `Badge` and `Button` are exported from `@/components/ui` (see `index.ts`). Entry page already imports `Card, Badge, Button` (line 5); master page already imports `Card, Badge, Button, CardHeader, CardBody, Table, THead, TBody, Tr, Th, Td` (lines 5–23). No new UI imports required for either page.
- `Button` `variant` values used elsewhere in these files: `"primary"`, `"secondary"`, `"ghost"`. Use `"primary"`/`"secondary"` for the entry-page toggle exactly as Final Checks does.

---

## 8. Endpoint/JSON key quick-reference (must match across backend + frontend)

| Item | Exact value |
|---|---|
| Update endpoint | `PUT ${API}/api/v1/production/assembly-steps/{step_id}` |
| Update body JSON | `{ "status"?: string, "date_ready"?: "YYYY-MM-DD", "notes"?: string }` |
| Update response JSON | `{ "success": true, "message": string }` |
| Parts response new key | `data.assembly_steps` (array; `[]` for legacy) |
| Parts response step element | `{ id:int, step_no:int, label:string, status:string, date_ready:string|null, notes:string|null }` |
| Joint-types response new key | `data[].types[].assembly_chain` (array of `{ step_no:int, label:string }`) |
| Final-check new type value | `"packing"` |

`${API}` = `process.env.NEXT_PUBLIC_API_URL || "http://localhost:8003"` (the exact pattern already used throughout both TSX files).

---

## 9. Guardrails (all agents)

- Do NOT modify `joint_catalog.py`'s existing `JOINT_TYPES` component/quantity data, `templates.py`, or `calculate_project_progress`. Assembly-step and packing status must NOT feed the progress formula.
- Do NOT add an `ALTER TABLE` for `assembly_steps`; it is created by `create_all`.
- Do NOT add `"packing"` anywhere except `FINAL_CHECK_TYPES`, the `defaults` dict, and the one entry-page filter array.
- PostgreSQL only; no new dependencies.
- The DB-backed `AssemblyStep` (entry page / router / db_service) and the catalog `AssemblyChainStep` (master page) are **different shapes** — keep them separate.
