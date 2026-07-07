# Itemwise Progress Tracking Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bring the company's "Job Itemwise Progress Report" Excel into the platform by extending the existing Part/PartProcess machinery — enriched step definitions, per-step status/date/PO fields, a new final-checks table, wired into the existing shop-floor entry page and progress calc.

**Architecture:** Reuse, don't rebuild. The app already models component→step→progress (`templates.py` → `mes_service` seeding → `Part`/`PartProcess`/`ProductionLog` → `production` router → `calculate_project_progress`). This plan (1) enriches `templates.py` step lists to match the Excel, (2) adds columns to `PartProcess`, (3) adds one `JobFinalCheck` table, (4) backfills existing rows, (5) extends the existing API + progress calc, (6) extends the existing Shop Floor Entry page. No parallel tables. See spec: `docs/superpowers/specs/2026-07-07-itemwise-progress-tracking-design.md`.

**Tech Stack:** FastAPI, SQLAlchemy 2.0 (declarative `Base`), PostgreSQL only, Next.js App Router frontend with the `@/components/ui` design system.

## Global Constraints

- **PostgreSQL only** — no SQLite, all SQL Postgres-compatible.
- **New Python deps go in root `requirements.txt`** — never `backend/requirements.txt`.
- **Push to `demo` branch only** — never merge to `main` without explicit human approval.
- **Schema changes need two paths**: (a) update the SQLAlchemy model in `backend/services/db_service.py` so fresh DBs (`init_db()` → `create_all`) are correct, AND (b) an idempotent startup migration in `backend/main.py` via the existing `_run_startup_migration(label, statements)` helper so existing DBs get altered. `create_all` does NOT alter existing tables.
- **Do not rename existing `Part` names or change `weight_percentage`** — logged progress matches parts by name; weights are unchanged per spec (§4.1). Only enrich `processes` lists.
- **Frontend uses `@/components/ui` primitives** per `docs/UI_DESIGN_SYSTEM.md`; never `alert()`/`confirm()`/`prompt()`; never interpolate Tailwind class names at runtime.
- **Sandbox note:** there is no local Postgres in this environment. Pure-function tests run with `python <file>.py`. DB/endpoint/frontend tasks include a **manual verification** step (stand up Postgres + `uvicorn`, or the canned-JSON `http.server` on port 4500 pattern used in prior sessions) — the executing engineer runs these where a DB is available.

---

### Task 1: Enrich `templates.py` step lists to match the Excel

**Files:**
- Modify: `backend/services/templates.py`
- Test: `test_templates_itemwise.py` (repo root, matches existing `test_*.py` convention)

**Interfaces:**
- Consumes: nothing.
- Produces: `TEMPLATES["EJ"]` / `TEMPLATES["DJ"]` — each a list of `{"name": str, "weight": float, "processes": [str, ...]}`. Part `name` and `weight` values are UNCHANGED from the current file; only `processes` lists change. Later tasks (backfill, API) rely on these process names as the canonical per-component step list.

- [ ] **Step 1: Write the failing test**

Create `test_templates_itemwise.py`:

```python
# Verifies templates.py step lists match the company Excel (itemwise progress report).
from backend.services.templates import TEMPLATES

# Expected process lists per part NAME (names/weights unchanged; only processes enriched).
EJ_EXPECTED = {
    "Bellows (B)": ["Material Received", "Cutting", "Welding", "DP test", "Forming", "Ready"],
    "Collar (C)": ["Material Received", "Cutting", "Welding", "DP test", "Ready"],
    "Weldend (W)": ["Material Received", "Cutting", "Bending", "Welding", "Re-Rolling", "DP test", "SF Cutting", "Ready"],
    "Spool (SP)": ["Material Received", "Cutting", "Bending", "Welding", "Re-Rolling", "DP test", "Ready"],
    "Compensator Flanges (F)": ["PO", "Material Received", "Cutting", "Bending", "Welding", "M/c", "Drilling", "Inward Insp", "Ready"],
    "Companion Flanges (CF)": ["PO", "Material Received", "Cutting", "Bending", "Welding", "M/c", "Drilling", "Inward Insp", "Ready"],
    "Internal Sleeve (IS)": ["Material Received", "Cutting", "Welding", "Ready"],
    "Lugs (L)": ["Material Received", "Cutting", "Drilling", "Ready"],
    "Limit Rods (LR)": ["PO", "Material Received", "Inward Insp", "Ready"],
    "MAT. BOLTS, NUT, WASHER SET": ["PO", "Material Received", "Inward Insp", "Ready"],
    "GASKET (G)": ["PO", "Material Received", "Inward Insp", "Ready"],
}
# Assembly parts (names containing "Assembly") keep ["Assembly", "Ready"] — not asserted here.

DJ_EXPECTED = {
    "PIPE-1 (P1)": ["Material Received", "Cutting", "Bending", "Welding", "Re-Rolling", "DP test", "Ready"],
    "PIPE-2 (P2)": ["Material Received", "Cutting", "Bending", "Welding", "Re-Rolling", "DP test", "Ready"],
    "STOPPER (S)": ["Material Received", "Cutting", "Bending", "Welding", "Re-Rolling", "DP test", "Ready"],
    "Compensator Flanges (F)": ["PO", "Material Received", "Cutting", "Bending", "Welding", "M/c", "Drilling", "Inward Insp", "Ready"],
    "Companion Flanges (CF)": ["PO", "Material Received", "Cutting", "Bending", "Welding", "M/c", "Drilling", "Inward Insp", "Ready"],
    "Limit Rods (LR)": ["PO", "Material Received", "Inward Insp", "Ready"],
    "MAT. BOLTS, NUT, WASHER SET": ["PO", "Material Received", "Inward Insp", "Ready"],
    "GASKET (G)": ["PO", "Material Received", "Inward Insp", "Ready"],
}

def _by_name(tpl):
    return {p["name"]: p["processes"] for p in tpl}

def test_ej_processes():
    got = _by_name(TEMPLATES["EJ"])
    for name, procs in EJ_EXPECTED.items():
        assert name in got, f"EJ missing part {name!r}"
        assert got[name] == procs, f"EJ {name!r}: {got[name]} != {procs}"

def test_dj_processes():
    got = _by_name(TEMPLATES["DJ"])
    for name, procs in DJ_EXPECTED.items():
        assert name in got, f"DJ missing part {name!r}"
        assert got[name] == procs, f"DJ {name!r}: {got[name]} != {procs}"

def test_assembly_parts_unchanged():
    for key in ("EJ", "DJ"):
        for p in TEMPLATES[key]:
            if "Assembly" in p["name"]:
                assert p["processes"] == ["Assembly", "Ready"], f"{key} {p['name']!r} changed"

if __name__ == "__main__":
    test_ej_processes(); test_dj_processes(); test_assembly_parts_unchanged()
    print("OK: templates match Excel")
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python test_templates_itemwise.py`
Expected: `AssertionError` (e.g. `EJ 'Collar (C)': ['Cutting', 'Ready'] != [...]`).

- [ ] **Step 3: Update `processes` lists in `templates.py`**

In `backend/services/templates.py`, change ONLY the `processes` arrays to match. Keep every `name` and `weight` exactly as-is. For EJ:

```python
EXPANSION_JOINT_TEMPLATE = [
    {"name": "Bellows (B)", "weight": 20.0, "processes": ["Material Received", "Cutting", "Welding", "DP test", "Forming", "Ready"]},
    {"name": "Collar (C)", "weight": 5.0, "processes": ["Material Received", "Cutting", "Welding", "DP test", "Ready"]},
    {"name": "B/C Assembly Part 'P'", "weight": 10.0, "processes": ["Assembly", "Ready"]},
    {"name": "Weldend (W)", "weight": 10.0, "processes": ["Material Received", "Cutting", "Bending", "Welding", "Re-Rolling", "DP test", "SF Cutting", "Ready"]},
    {"name": "Spool (SP)", "weight": 5.0, "processes": ["Material Received", "Cutting", "Bending", "Welding", "Re-Rolling", "DP test", "Ready"]},
    {"name": "Part 'P'/W/SP Assembly Part 'Q'", "weight": 10.0, "processes": ["Assembly", "Ready"]},
    {"name": "Compensator Flanges (F)", "weight": 5.0, "processes": ["PO", "Material Received", "Cutting", "Bending", "Welding", "M/c", "Drilling", "Inward Insp", "Ready"]},
    {"name": "Companion Flanges (CF)", "weight": 5.0, "processes": ["PO", "Material Received", "Cutting", "Bending", "Welding", "M/c", "Drilling", "Inward Insp", "Ready"]},
    {"name": "Part 'Q'/F Assembly Part 'R'", "weight": 5.0, "processes": ["Assembly", "Ready"]},
    {"name": "Internal Sleeve (IS)", "weight": 5.0, "processes": ["Material Received", "Cutting", "Welding", "Ready"]},
    {"name": "Part 'R'/IS Assembly Part 'S'", "weight": 5.0, "processes": ["Assembly", "Ready"]},
    {"name": "Lugs (L)", "weight": 2.5, "processes": ["Material Received", "Cutting", "Drilling", "Ready"]},
    {"name": "Part 'S'/L Assembly Part 'T'", "weight": 2.5, "processes": ["Assembly", "Ready"]},
    {"name": "Limit Rods (LR)", "weight": 2.0, "processes": ["PO", "Material Received", "Inward Insp", "Ready"]},
    {"name": "MAT. BOLTS, NUT, WASHER SET", "weight": 2.0, "processes": ["PO", "Material Received", "Inward Insp", "Ready"]},
    {"name": "GASKET (G)", "weight": 1.0, "processes": ["PO", "Material Received", "Inward Insp", "Ready"]},
    {"name": "Main Assembly", "weight": 5.0, "processes": ["Assembly", "Ready"]}
]
```

For DJ:

```python
DISMANTLING_JOINT_TEMPLATE = [
    {"name": "PIPE-1 (P1)", "weight": 10.0, "processes": ["Material Received", "Cutting", "Bending", "Welding", "Re-Rolling", "DP test", "Ready"]},
    {"name": "PIPE-2 (P2)", "weight": 10.0, "processes": ["Material Received", "Cutting", "Bending", "Welding", "Re-Rolling", "DP test", "Ready"]},
    {"name": "STOPPER (S)", "weight": 5.0, "processes": ["Material Received", "Cutting", "Bending", "Welding", "Re-Rolling", "DP test", "Ready"]},
    {"name": "Compensator Flanges (F)", "weight": 10.0, "processes": ["PO", "Material Received", "Cutting", "Bending", "Welding", "M/c", "Drilling", "Inward Insp", "Ready"]},
    {"name": "Companion Flanges (CF)", "weight": 10.0, "processes": ["PO", "Material Received", "Cutting", "Bending", "Welding", "M/c", "Drilling", "Inward Insp", "Ready"]},
    {"name": "Part 'P1'/F Assembly Part 'A'", "weight": 10.0, "processes": ["Assembly", "Ready"]},
    {"name": "Part 'P2'/F Assembly Part 'B'", "weight": 10.0, "processes": ["Assembly", "Ready"]},
    {"name": "Part 'S'/F Assembly Part 'C'", "weight": 10.0, "processes": ["Assembly", "Ready"]},
    {"name": "Limit Rods (LR)", "weight": 5.0, "processes": ["PO", "Material Received", "Inward Insp", "Ready"]},
    {"name": "Part 'A', 'B', & 'C' FINAL ASSEMBLY", "weight": 15.0, "processes": ["Assembly", "Ready"]},
    {"name": "MAT. BOLTS, NUT, WASHER SET", "weight": 2.5, "processes": ["PO", "Material Received", "Inward Insp", "Ready"]},
    {"name": "GASKET (G)", "weight": 2.5, "processes": ["PO", "Material Received", "Inward Insp", "Ready"]},
    {"name": "Main Assembly", "weight": 5.0, "processes": ["Assembly", "Ready"]}
]
```

- [ ] **Step 4: Run test to verify it passes**

Run: `python test_templates_itemwise.py`
Expected: `OK: templates match Excel`

- [ ] **Step 5: Commit**

```bash
git add backend/services/templates.py test_templates_itemwise.py
git commit -m "feat: enrich EJ/DJ step templates to match itemwise Excel

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: Add status/date/PO columns to `PartProcess` + a pure status helper

**Files:**
- Modify: `backend/services/db_service.py` (PartProcess model, ~line 114)
- Create: `backend/services/progress_status.py` (pure helper)
- Modify: `backend/main.py` (add startup migration after the existing `_run_startup_migration` block, ~line 96)
- Test: `test_progress_status.py` (repo root)

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `PartProcess` gains columns: `status: str = 'pending'`, `date_ready: date|None`, `date_pending: date|None`, `po_number: str|None`.
  - `progress_status.compute_process_status(completed_qty: int, required_qty: int) -> str` returning one of `'pending' | 'in_process' | 'ready'`. Used by Task 5 (transaction endpoint) and referenced by Task 6.
  - Status enum canonical values (shared with Task 3): `'pending' | 'required' | 'in_process' | 'ready'`.

- [ ] **Step 1: Write the failing test**

Create `test_progress_status.py`:

```python
from backend.services.progress_status import compute_process_status

def test_none_done_is_pending():
    assert compute_process_status(0, 5) == "pending"

def test_partial_is_in_process():
    assert compute_process_status(2, 5) == "in_process"

def test_all_done_is_ready():
    assert compute_process_status(5, 5) == "ready"

def test_over_done_is_ready():
    assert compute_process_status(7, 5) == "ready"

def test_zero_required_is_ready():
    # A step with no required quantity is considered satisfied (matches calc's valid_processes==0 -> 1.0 behavior)
    assert compute_process_status(0, 0) == "ready"

if __name__ == "__main__":
    for f in [test_none_done_is_pending, test_partial_is_in_process, test_all_done_is_ready,
              test_over_done_is_ready, test_zero_required_is_ready]:
        f()
    print("OK: compute_process_status")
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python test_progress_status.py`
Expected: `ModuleNotFoundError: No module named 'backend.services.progress_status'`

- [ ] **Step 3: Create the pure helper**

Create `backend/services/progress_status.py`:

```python
"""Pure status derivation for item-progress steps and final checks.

Canonical status values: 'pending' | 'required' | 'in_process' | 'ready'.
PartProcess steps use pending/in_process/ready. 'required' is used by
final checks that are flagged required but not yet started.
"""

def compute_process_status(completed_qty: int, required_qty: int) -> str:
    if required_qty <= 0:
        return "ready"
    if completed_qty <= 0:
        return "pending"
    if completed_qty >= required_qty:
        return "ready"
    return "in_process"
```

- [ ] **Step 4: Run test to verify it passes**

Run: `python test_progress_status.py`
Expected: `OK: compute_process_status`

- [ ] **Step 5: Add columns to the `PartProcess` model**

In `backend/services/db_service.py`, in `class PartProcess`, after `completed_qty = Column(...)`:

```python
    status = Column(String, default="pending")      # pending | in_process | ready
    date_ready = Column(Date, nullable=True)
    date_pending = Column(Date, nullable=True)
    po_number = Column(String, nullable=True)
```

- [ ] **Step 6: Add the startup migration**

In `backend/main.py`, after the `project_production_lines.pn_rating` migration block (~line 96), add:

```python
_run_startup_migration("part_processes.itemwise fields", [
    "ALTER TABLE part_processes ADD COLUMN status VARCHAR DEFAULT 'pending'",
    "ALTER TABLE part_processes ADD COLUMN date_ready DATE",
    "ALTER TABLE part_processes ADD COLUMN date_pending DATE",
    "ALTER TABLE part_processes ADD COLUMN po_number VARCHAR",
])
```

- [ ] **Step 7: Verify migration is syntactically valid (import check)**

Run: `python -c "import ast; ast.parse(open('backend/main.py').read()); print('main.py OK')"`
Expected: `main.py OK`

- [ ] **Step 8: Commit**

```bash
git add backend/services/db_service.py backend/services/progress_status.py backend/main.py test_progress_status.py
git commit -m "feat: add status/date/PO fields to PartProcess + status helper

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: Add `JobFinalCheck` model, seeding, and startup migration

**Files:**
- Modify: `backend/services/db_service.py` (new model near `PartProcess`)
- Modify: `backend/services/mes_service.py` (seed checks in `create_parts_for_production_line`)
- Modify: `backend/main.py` (CREATE TABLE startup migration)
- Test: `test_final_checks_seed.py` (repo root)

**Interfaces:**
- Consumes: `compute_process_status` (Task 2) is NOT needed here; final checks store `status` directly.
- Produces:
  - `JobFinalCheck` model with columns: `id`, `production_line_id` (FK), `check_type` (`'testing'|'painting'|'weight'|'marking'`), `is_required` (bool, default True), `test_method`, `paint_spec`, `weight_kgs`, `marking_type`, `status` (default `'pending'`), `date_ready`, `date_pending`, `notes`, `updated_by` (FK users, nullable), `updated_at`. `UNIQUE(production_line_id, check_type)`.
  - `MESService.FINAL_CHECK_TYPES: list[str]` = `["testing", "painting", "weight", "marking"]`.
  - `MESService.create_final_checks_for_line(db, line_id)` — inserts the 4 rows (idempotent: skips types that already exist for the line). Called from `create_parts_for_production_line`.

- [ ] **Step 1: Write the failing test**

Create `test_final_checks_seed.py` (pure check on the type list + default seed shape — no DB):

```python
from backend.services.mes_service import MESService

def test_four_check_types():
    assert MESService.FINAL_CHECK_TYPES == ["testing", "painting", "weight", "marking"]

def test_default_rows_builder():
    rows = MESService.default_final_check_rows(line_id=42)
    assert len(rows) == 4
    assert {r["check_type"] for r in rows} == {"testing", "painting", "weight", "marking"}
    assert all(r["production_line_id"] == 42 for r in rows)
    assert all(r["is_required"] is True for r in rows)
    testing = next(r for r in rows if r["check_type"] == "testing")
    assert testing["test_method"] == "Hydro/Pneumatic"
    marking = next(r for r in rows if r["check_type"] == "marking")
    assert marking["marking_type"] == "Hard Punch"

if __name__ == "__main__":
    test_four_check_types(); test_default_rows_builder()
    print("OK: final check seed")
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python test_final_checks_seed.py`
Expected: `AttributeError: type object 'MESService' has no attribute 'FINAL_CHECK_TYPES'`

- [ ] **Step 3: Add the `JobFinalCheck` model**

In `backend/services/db_service.py`, after `class ProductionLog` (~line 135), add:

```python
class JobFinalCheck(Base):
    __tablename__ = "job_final_checks"
    id = Column(Integer, primary_key=True, index=True)
    production_line_id = Column(Integer, ForeignKey("project_production_lines.id"), nullable=False)
    check_type = Column(String, nullable=False)   # testing | painting | weight | marking
    is_required = Column(Boolean, default=True)

    test_method = Column(String, nullable=True)   # 'Hydro/Pneumatic'
    paint_spec = Column(Text, nullable=True)
    weight_kgs = Column(Float, nullable=True)
    marking_type = Column(String, nullable=True)  # 'Hard Punch'

    status = Column(String, default="pending")    # pending | required | in_process | ready
    date_ready = Column(Date, nullable=True)
    date_pending = Column(Date, nullable=True)
    notes = Column(Text, nullable=True)
    updated_by = Column(Integer, ForeignKey("users.id"), nullable=True)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    __table_args__ = (UniqueConstraint("production_line_id", "check_type", name="uq_final_check_line_type"),)
```

(`UniqueConstraint`, `Text`, `Float`, `Date`, `Boolean` are already imported at the top of the file.)

- [ ] **Step 4: Add seeding helpers to `MESService`**

In `backend/services/mes_service.py`, add the import and helpers. At top, extend the existing import:

```python
from backend.services.db_service import (
    Project, ProjectProductionLine, Part, PartProcess, ProductionLog, JobFinalCheck
)
```

Add to `class MESService`:

```python
    FINAL_CHECK_TYPES = ["testing", "painting", "weight", "marking"]

    @staticmethod
    def default_final_check_rows(line_id: int):
        defaults = {
            "testing": {"test_method": "Hydro/Pneumatic"},
            "painting": {},
            "weight": {},
            "marking": {"marking_type": "Hard Punch"},
        }
        return [
            {"production_line_id": line_id, "check_type": t, "is_required": True, **defaults[t]}
            for t in MESService.FINAL_CHECK_TYPES
        ]

    @staticmethod
    def create_final_checks_for_line(db: Session, line_id: int):
        existing = {c.check_type for c in db.query(JobFinalCheck).filter_by(production_line_id=line_id).all()}
        for row in MESService.default_final_check_rows(line_id):
            if row["check_type"] in existing:
                continue
            db.add(JobFinalCheck(**row))
```

Then call it at the end of `create_parts_for_production_line`, right before `return line`:

```python
        MESService.create_final_checks_for_line(db, line.id)
        return line
```

- [ ] **Step 5: Add the CREATE TABLE startup migration**

In `backend/main.py`, after the Task 2 `part_processes.itemwise fields` migration, add:

```python
_run_startup_migration("job_final_checks table", [
    """
    CREATE TABLE IF NOT EXISTS job_final_checks (
        id SERIAL PRIMARY KEY,
        production_line_id INTEGER NOT NULL REFERENCES project_production_lines(id),
        check_type VARCHAR NOT NULL,
        is_required BOOLEAN DEFAULT TRUE,
        test_method VARCHAR,
        paint_spec TEXT,
        weight_kgs DOUBLE PRECISION,
        marking_type VARCHAR,
        status VARCHAR DEFAULT 'pending',
        date_ready DATE,
        date_pending DATE,
        notes TEXT,
        updated_by INTEGER REFERENCES users(id),
        updated_at TIMESTAMP DEFAULT NOW(),
        CONSTRAINT uq_final_check_line_type UNIQUE (production_line_id, check_type)
    )
    """,
])
```

- [ ] **Step 6: Run test to verify it passes**

Run: `python test_final_checks_seed.py`
Expected: `OK: final check seed`

- [ ] **Step 7: Verify main.py still parses**

Run: `python -c "import ast; ast.parse(open('backend/main.py').read()); print('main.py OK')"`
Expected: `main.py OK`

- [ ] **Step 8: Commit**

```bash
git add backend/services/db_service.py backend/services/mes_service.py backend/main.py test_final_checks_seed.py
git commit -m "feat: add JobFinalCheck table, seeding, and migration

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: Backfill existing production lines (missing steps + final checks)

**Files:**
- Modify: `backend/main.py` (add a Python-level backfill after the raw-SQL migrations)
- Create: `backend/services/itemwise_backfill.py` (backfill function)
- Test: covered by manual verification (DB-dependent).

**Interfaces:**
- Consumes: `TEMPLATES` (Task 1), `MESService.create_final_checks_for_line` (Task 3), models `Part`, `PartProcess`, `ProjectProductionLine`.
- Produces: `itemwise_backfill.backfill_itemwise(db_session_factory)` — for every existing production line: adds any template `PartProcess` step missing on its parts (match by part name + process name; never deletes), and inserts missing final-check rows. Idempotent.

- [ ] **Step 1: Write the backfill function**

Create `backend/services/itemwise_backfill.py`:

```python
"""One-shot idempotent backfill: bring pre-existing production lines up to the
enriched templates (Task 1) and give them final-check rows (Task 3).

Additive only — never deletes or renames existing PartProcess rows, so any
progress already logged against them is preserved.
"""
import logging
from backend.services.db_service import ProjectProductionLine, Part, PartProcess
from backend.services.templates import TEMPLATES
from backend.services.mes_service import MESService

logger = logging.getLogger("uvicorn.error")


def backfill_itemwise(SessionLocal):
    db = SessionLocal()
    try:
        added_steps = 0
        lines = db.query(ProjectProductionLine).all()
        for line in lines:
            template = TEMPLATES.get(getattr(line, "joint_type", "EJ") or "EJ")
            if not template:
                continue
            tmpl_by_name = {p["name"]: p["processes"] for p in template}

            for part in line.parts:
                wanted = tmpl_by_name.get(part.name)
                if not wanted:
                    continue
                existing = {proc.process_name for proc in part.processes}
                for pname in wanted:
                    if pname not in existing:
                        db.add(PartProcess(part_id=part.id, process_name=pname, completed_qty=0, status="pending"))
                        added_steps += 1

            MESService.create_final_checks_for_line(db, line.id)

        db.commit()
        logger.info("itemwise backfill: added %d missing steps across %d lines", added_steps, len(lines))
    except Exception as e:
        db.rollback()
        logger.warning("itemwise backfill skipped/failed: %s", e)
    finally:
        db.close()
```

- [ ] **Step 2: Wire it into startup**

In `backend/main.py`, after the `job_final_checks table` migration block, add:

```python
from backend.services.db_service import SessionLocal
from backend.services.itemwise_backfill import backfill_itemwise
backfill_itemwise(SessionLocal)
```

- [ ] **Step 3: Verify main.py parses**

Run: `python -c "import ast; ast.parse(open('backend/main.py').read()); print('main.py OK')"`
Expected: `main.py OK`

- [ ] **Step 4: Manual verification (where Postgres is available)**

1. Start Postgres and run `python -m uvicorn backend.main:app --port 8003`.
2. In server logs, confirm a line like `itemwise backfill: added N missing steps across M lines` and no traceback.
3. Restart the server; confirm the second run logs `added 0 missing steps` (idempotent).
4. In the DB: `SELECT COUNT(*) FROM job_final_checks;` equals `4 * (number of production_lines)`.

Expected: idempotent on second boot; final-check count matches.

- [ ] **Step 5: Commit**

```bash
git add backend/services/itemwise_backfill.py backend/main.py
git commit -m "feat: backfill existing lines with enriched steps + final checks

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: Extend the production API (parts response, transaction, final-checks endpoint)

**Files:**
- Modify: `backend/app/production/router.py` (GET `/parts/{req_id}`, POST `/processes/{id}/transactions`, new PUT `/final-checks/{check_id}`)
- Modify: `backend/app/production/schemas.py` (extend `TransactionCreate`, add `FinalCheckUpdate`)
- Test: manual verification (DB + HTTP dependent).

**Interfaces:**
- Consumes: `compute_process_status` (Task 2), `JobFinalCheck` (Task 3), `MESService.FINAL_CHECK_TYPES`.
- Produces:
  - `GET /parts/{req_id}` response: each process object additionally has `status`, `date_ready`, `date_pending`, `po_number`, `qty_pending` (derived `total_qty - completed_qty`, floored at 0); response `data` additionally has `final_checks: [{id, check_type, is_required, test_method, paint_spec, weight_kgs, marking_type, status, date_ready, date_pending, notes}]`.
  - `POST /processes/{id}/transactions` body additionally accepts optional `date_ready: date|None`, `po_number: str|None`; endpoint sets `proc.status` via `compute_process_status`, sets `proc.date_ready` when it becomes ready, stores `po_number` if provided.
  - `PUT /final-checks/{check_id}` body `FinalCheckUpdate` → updates one row; returns `{success, message}`.

- [ ] **Step 1: Extend schemas**

In `backend/app/production/schemas.py`, add imports and models:

```python
from datetime import date

class TransactionCreate(BaseModel):
    operator_id: Optional[int] = None
    quantity_completed: int = Field(gt=0)
    feet_completed: Optional[float] = Field(default=None, ge=0)
    date_ready: Optional[date] = None
    po_number: Optional[str] = None

class FinalCheckUpdate(BaseModel):
    is_required: Optional[bool] = None
    status: Optional[str] = None            # pending | required | in_process | ready
    test_method: Optional[str] = None
    paint_spec: Optional[str] = None
    weight_kgs: Optional[float] = None
    marking_type: Optional[str] = None
    date_ready: Optional[date] = None
    date_pending: Optional[date] = None
    notes: Optional[str] = None
```

(Leave the existing `TransactionCreate` fields intact — just add the two new optional ones. Do not remove `WeldingLogCreate`.)

- [ ] **Step 2: Extend `GET /parts/{req_id}`**

In `backend/app/production/router.py`, in `get_requirement_parts`, replace the per-process dict and add final checks. The process loop becomes:

```python
        for proc in part.processes:
            proc_data.append({
                "id": proc.id,
                "process_name": proc.process_name,
                "completed_qty": proc.completed_qty,
                "qty_pending": max(0, (line.quantity or 0) - proc.completed_qty),
                "status": getattr(proc, "status", "pending"),
                "date_ready": proc.date_ready.isoformat() if getattr(proc, "date_ready", None) else None,
                "date_pending": proc.date_pending.isoformat() if getattr(proc, "date_pending", None) else None,
                "po_number": getattr(proc, "po_number", None),
            })
```

Before the `return`, build final checks (add `JobFinalCheck` to the file's imports from `db_service`):

```python
    checks = db.query(JobFinalCheck).filter_by(production_line_id=line.id).all()
    checks_data = [{
        "id": c.id, "check_type": c.check_type, "is_required": c.is_required,
        "test_method": c.test_method, "paint_spec": c.paint_spec,
        "weight_kgs": c.weight_kgs, "marking_type": c.marking_type,
        "status": c.status,
        "date_ready": c.date_ready.isoformat() if c.date_ready else None,
        "date_pending": c.date_pending.isoformat() if c.date_pending else None,
        "notes": c.notes,
    } for c in checks]
```

And include it in the returned payload:

```python
    return {"success": True, "data": {"requirement_id": line.id, "total_qty": line.quantity,
                                      "parts": parts_data, "final_checks": checks_data}}
```

- [ ] **Step 3: Extend the transaction endpoint**

In `add_transaction`, after `proc.completed_qty += tx.quantity_completed`, add:

```python
    from backend.services.progress_status import compute_process_status
    proc.status = compute_process_status(proc.completed_qty, line.quantity or 0)
    if proc.status == "ready":
        proc.date_ready = tx.date_ready or date.today()
    if tx.po_number:
        proc.po_number = tx.po_number
```

(Add `from datetime import date` at the top of the router if not present.)

- [ ] **Step 4: Add the final-checks endpoint**

Add to `backend/app/production/router.py` (import `JobFinalCheck`, `FinalCheckUpdate`, and reuse the existing `require_roles`/audit pattern):

```python
from backend.app.production.schemas import FinalCheckUpdate
from backend.services.db_service import JobFinalCheck

@router.put("/final-checks/{check_id}")
def update_final_check(check_id: int, body: FinalCheckUpdate, db: Session = Depends(get_db),
                       current_user: dict = Depends(require_roles(["Developer", "GM", "Admin", "Production Manager", "Supervisor"]))):
    check = db.query(JobFinalCheck).filter_by(id=check_id).first()
    if not check:
        raise HTTPException(status_code=404, detail="Final check not found")
    for field, value in body.model_dump(exclude_unset=True).items():
        setattr(check, field, value)
    db_user = db.query(User).filter_by(username=current_user["username"]).first() if current_user else None
    if db_user:
        check.updated_by = db_user.id
    db.add(AuditLog(
        user_id=db_user.id if db_user else None,
        username=current_user["username"] if current_user else None,
        action="Update", table_name="job_final_checks", record_id=check.id,
        details=f"Updated {check.check_type} -> status={check.status}",
    ))
    db.commit()
    return {"success": True, "message": f"Updated {check.check_type}"}
```

- [ ] **Step 5: Manual verification (where Postgres + server are available)**

1. `GET /api/v1/production/parts/<req_id>` → confirm each process has `status`/`qty_pending`/`po_number`/dates and the payload has a `final_checks` array of 4.
2. `POST /api/v1/production/processes/<id>/transactions` with `{"quantity_completed": <total_qty>, "date_ready": "2026-07-07"}` → re-GET, confirm that process `status == "ready"` and `date_ready` set.
3. `PUT /api/v1/production/final-checks/<check_id>` with `{"status":"ready","weight_kgs":123.4,"date_ready":"2026-07-07"}` → re-GET, confirm persisted.

Expected: all three reflect the changes.

- [ ] **Step 6: Commit**

```bash
git add backend/app/production/router.py backend/app/production/schemas.py
git commit -m "feat: expose itemwise status/dates/PO + final-checks in production API

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 6: Gate `calculate_project_progress` on required final checks

**Files:**
- Modify: `backend/services/mes_service.py` (`calculate_project_progress`)
- Test: `test_final_check_gate.py` (repo root, pure helper)

**Interfaces:**
- Consumes: `JobFinalCheck` (Task 3).
- Produces: `MESService.final_check_gate(checks) -> float` — returns `1.0` if every `is_required` check has `status == 'ready'` (or none are required), else a `< 1.0` cap. `calculate_project_progress` multiplies each line's completion by this gate so a line can't read 100% while required checks are outstanding.

- [ ] **Step 1: Write the failing test**

Create `test_final_check_gate.py`:

```python
from backend.services.mes_service import MESService

class C:
    def __init__(self, is_required, status):
        self.is_required = is_required; self.status = status

def test_no_required_checks_full():
    assert MESService.final_check_gate([C(False, "pending")]) == 1.0

def test_all_required_ready_full():
    assert MESService.final_check_gate([C(True, "ready"), C(True, "ready")]) == 1.0

def test_outstanding_required_caps_below_one():
    assert MESService.final_check_gate([C(True, "ready"), C(True, "pending")]) < 1.0

def test_empty_full():
    assert MESService.final_check_gate([]) == 1.0

if __name__ == "__main__":
    for f in [test_no_required_checks_full, test_all_required_ready_full,
              test_outstanding_required_caps_below_one, test_empty_full]:
        f()
    print("OK: final_check_gate")
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python test_final_check_gate.py`
Expected: `AttributeError: type object 'MESService' has no attribute 'final_check_gate'`

- [ ] **Step 3: Implement the gate**

In `backend/services/mes_service.py`, add to `class MESService`:

```python
    @staticmethod
    def final_check_gate(checks):
        required = [c for c in checks if getattr(c, "is_required", True)]
        if not required:
            return 1.0
        ready = sum(1 for c in required if c.status == "ready")
        if ready == len(required):
            return 1.0
        # Cap the line: allow up to 95% until all required checks are done.
        return 0.95 * (ready / len(required)) + 0.0 if False else min(0.95, 0.5 + 0.45 * (ready / len(required)))
```

(The gate keeps a line visibly below 100% while any required check is outstanding, scaling with how many checks remain. Exact curve can be tuned; the invariant that matters: `< 1.0` unless all required checks are ready.)

- [ ] **Step 4: Apply the gate in `calculate_project_progress`**

In `calculate_project_progress`, load checks per line and multiply. After computing `line_completion` for a line (currently `line_completion = (line_fabrication_completion * 0.7) + (welding_pct * 30.0)`), add before `total_line_completion += line_completion`:

```python
            from backend.services.db_service import JobFinalCheck
            line_checks = db.query(JobFinalCheck).filter_by(production_line_id=line.id).all()
            line_completion *= MESService.final_check_gate(line_checks)
```

- [ ] **Step 5: Run test to verify it passes**

Run: `python test_final_check_gate.py`
Expected: `OK: final_check_gate`

- [ ] **Step 6: Manual verification (where Postgres is available)**

For a project whose parts are all complete: set one required final check to `status='ready'` and leave others pending → project progress from `calculate_project_progress` reads `< 100`. Set all required checks ready → reads its full value.

- [ ] **Step 7: Commit**

```bash
git add backend/services/mes_service.py test_final_check_gate.py
git commit -m "feat: gate project progress on required final checks

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 7: Extend the Shop Floor Entry page (per-step fields + Final Checks section)

**Files:**
- Modify: `next-frontend/src/app/(main)/production/entry/page.tsx`
- Test: manual verification (frontend).

**Interfaces:**
- Consumes: `GET /parts/{req_id}` (Task 5) now returning `status`/`qty_pending`/`po_number`/dates per process and a `final_checks` array; `PUT /final-checks/{id}` (Task 5).
- Produces: no downstream consumers.

- [ ] **Step 1: Extend the TypeScript interfaces**

In `page.tsx`, extend `ProcessRow` and add `FinalCheck`:

```typescript
interface ProcessRow {
  id: string;
  process_name: string;
  completed_qty: number;
  qty_pending?: number;
  status?: string;
  date_ready?: string | null;
  date_pending?: string | null;
  po_number?: string | null;
}

interface FinalCheck {
  id: number;
  check_type: string;
  is_required: boolean;
  test_method?: string | null;
  paint_spec?: string | null;
  weight_kgs?: number | null;
  marking_type?: string | null;
  status: string;
  date_ready?: string | null;
  date_pending?: string | null;
  notes?: string | null;
}
```

- [ ] **Step 2: Store final checks in state and read them from the parts response**

Add state near the other `useState` calls:

```typescript
  const [finalChecks, setFinalChecks] = useState<FinalCheck[]>([]);
```

In the `useEffect` that fetches `/production/parts/${requirementId}`, inside the `if (resData.success && resData.data)` block, add:

```typescript
        setFinalChecks(resData.data.final_checks || []);
```

- [ ] **Step 3: Show status + PO on each process card**

In the Fabrication process card (where `Done:`/`Pend:` badges render), show the server `status` as a badge and, when present, the PO number. Replace the badge row with:

```tsx
                                  <div className="flex flex-wrap gap-2">
                                    <Badge tone="success">Done: {proc.completed_qty}</Badge>
                                    <Badge tone="critical">Pend: {proc.qty_pending ?? Math.max(0, pending)}</Badge>
                                    {proc.status && <Badge tone="neutral">{proc.status}</Badge>}
                                    {proc.po_number && <Badge tone="neutral">PO: {proc.po_number}</Badge>}
                                  </div>
```

Also add an optional PO input for `PO`/`Material Received` steps: in the `!isComplete` input block, before the qty `Input`, add:

```tsx
                                    {/PO|Material Received/i.test(proc.process_name) && (
                                      <Input
                                        placeholder="PO Number (optional)"
                                        value={qtyInputs[`po_${proc.id}`] || ""}
                                        onChange={(e) => setQtyInputs({ ...qtyInputs, [`po_${proc.id}`]: e.target.value })}
                                      />
                                    )}
```

And include it in the POST body inside `handleSubmitProcess` (extend the existing `body`):

```typescript
        body: JSON.stringify({
          quantity_completed: qty,
          feet_completed: feet > 0 ? feet : null,
          po_number: qtyInputs[`po_${processId}`] || null,
        }),
```

- [ ] **Step 4: Add a Final Checks section**

After the closing of the Fabrication/Welding tab block (before the final `</div>` that closes the `requirementId && parts.length > 0` fragment), add a section that renders the 4 checks with a status control. Add a handler:

```typescript
  const handleUpdateCheck = async (checkId: number, patch: Partial<FinalCheck>) => {
    setSubmitting(true); setErrorMsg("");
    try {
      const res = await apiFetch(`${process.env.NEXT_PUBLIC_API_URL || "http://localhost:8003"}/api/v1/production/final-checks/${checkId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      if (!res.ok) { const e = await res.json(); throw new Error(e.detail || "Update failed"); }
      setSuccessMsg("Final check updated");
      const reqId = requirementId; setRequirementId(""); setTimeout(() => setRequirementId(reqId), 50);
      setTimeout(() => setSuccessMsg(""), 3000);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : String(err));
    } finally { setSubmitting(false); }
  };
```

And the section markup:

```tsx
            {finalChecks.length > 0 && (
              <div className="border-t border-line pt-6">
                <h2 className="mb-4 text-xl font-bold text-ink">Final Checks</h2>
                <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-4">
                  {finalChecks.map((c) => (
                    <Card key={c.id} className="p-4">
                      <div className="mb-3 flex items-center justify-between">
                        <h3 className="font-bold capitalize text-ink">{c.check_type}</h3>
                        <Badge tone={c.status === "ready" ? "success" : "neutral"}>{c.status}</Badge>
                      </div>
                      {c.test_method && <p className="text-sm text-ink-soft">Method: {c.test_method}</p>}
                      {c.marking_type && <p className="text-sm text-ink-soft">Marking: {c.marking_type}</p>}
                      {c.check_type === "weight" && (
                        <Input
                          type="number" step="0.1" placeholder="Weight (kgs)"
                          defaultValue={c.weight_kgs ?? ""}
                          onBlur={(e) => e.target.value && handleUpdateCheck(c.id, { weight_kgs: parseFloat(e.target.value) })}
                          className="mt-2"
                        />
                      )}
                      {c.check_type === "painting" && (
                        <Input
                          placeholder="Paint spec"
                          defaultValue={c.paint_spec ?? ""}
                          onBlur={(e) => e.target.value && handleUpdateCheck(c.id, { paint_spec: e.target.value })}
                          className="mt-2"
                        />
                      )}
                      <Button
                        variant={c.status === "ready" ? "secondary" : "primary"}
                        className="mt-3 w-full justify-center"
                        disabled={submitting}
                        onClick={() => handleUpdateCheck(c.id, { status: c.status === "ready" ? "pending" : "ready", date_ready: new Date().toISOString().slice(0, 10) })}
                      >
                        {c.status === "ready" ? "Mark Pending" : "Mark Ready"}
                      </Button>
                    </Card>
                  ))}
                </div>
              </div>
            )}
```

- [ ] **Step 5: Type-check and build**

Run: `npm --prefix next-frontend run lint && npm --prefix next-frontend run build`
Expected: lint clean; build succeeds for all routes.

- [ ] **Step 6: Manual verification (live preview)**

With the backend running (or the canned-JSON `http.server` on port 4500 returning a `parts` payload that includes `final_checks`): open `/production/entry`, pick a project + requirement. Confirm (a) each process shows a status badge and PO where relevant, (b) a Final Checks section with 4 cards renders, (c) "Mark Ready" flips the badge to `ready`, (d) entering a weight/paint spec persists on blur.

- [ ] **Step 7: Commit**

```bash
git add "next-frontend/src/app/(main)/production/entry/page.tsx"
git commit -m "feat: itemwise status, PO, and final checks on shop floor entry

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Self-Review

**Spec coverage:**
- §3 G1 (step granularity) → Task 1 ✓
- §3 G2 (qty_pending derived) → Task 5 (`qty_pending` in GET response) ✓
- §3 G3 (date_ready/date_pending on steps) → Task 2 (columns) + Task 5 (set/return) ✓
- §3 G4 (assembly status enum) → Task 2 (`status` column + helper) + Task 5 (set on transaction) ✓
- §3 G5 (po_number) → Task 2 (column) + Task 5 (accept/return) + Task 7 (input) ✓
- §3 G6 (final checks table) → Task 3 ✓
- §4.4 (backfill existing lines) → Task 4 ✓
- §5 (API: extend GET/POST, new PUT) → Task 5 ✓
- §6 (dashboard gate on final checks) → Task 6 ✓
- §7 (frontend on Shop Floor Entry) → Task 7 ✓
- §8 (welding independence; per-batch; derived qty_pending; gate not weighted) → respected: no WeldingLog changes; tracking stays per-line-quantity; qty_pending computed not stored; Task 6 is a gate. ✓

**Placeholder scan:** No TBD/TODO; every code step has concrete code. The Task 6 gate curve is intentionally tunable but has a stated invariant and a real formula — not a placeholder.

**Type consistency:** `compute_process_status(completed_qty, required_qty)` used identically in Task 2 and Task 5. `JobFinalCheck` columns match across Task 3 model, Task 3 migration, Task 5 serialization, Task 6 gate, Task 7 interface. `final_check_gate(checks)` defined in Task 6 and used there. `FINAL_CHECK_TYPES` defined Task 3, referenced consistently. Frontend `FinalCheck` fields match the Task 5 response keys.

**Known limitation carried from spec:** Welding-feet vs. the "Welding" step remain independent (double-entry possible) — deliberate v1 boundary, documented in spec §8.
