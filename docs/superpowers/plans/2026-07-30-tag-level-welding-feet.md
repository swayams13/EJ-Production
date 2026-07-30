# Tag-Level Welding Feet (TIG/MIG/Grinding) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the current one-size-fits-all `(size, joint_type)` welding-feet lookup with a tag-aware lookup that uses the GM's exact per-tag TIG/MIG/Grinding numbers for 10 of the 12 catalog tags, falling back to today's generic numbers wherever tag-specific data doesn't exist yet.

**Architecture:** Add a nullable `tag_no` column to the existing `WeldingMaster` table for tag-specific rows (generic rows keep `tag_no=NULL`, untouched). A new `canonical_weld_tag()` helper aliases the 6 "Matching Flange" variants to their base tag so they need no separate data. A new `resolve_master_row()` pure function centralizes the tag-first/generic-fallback resolution used by both places that sync welding feet. A one-off script seeds the 4 GM Excel files' values; the existing "Custom Size" frontend flow is extended to save tag-specific gap-fills directly.

**Tech Stack:** FastAPI + SQLAlchemy (backend), Next.js/TSX (frontend), Postgres, openpyxl for Excel parsing, this repo's plain-`assert`-function test convention (no pytest framework).

## Global Constraints

- Strictly PostgreSQL — no SQLite, all migrations Postgres-compatible.
- New Python dependencies (none needed here — `openpyxl` and `pandas` are already used elsewhere in this codebase) go in the root `requirements.txt`, not `backend/requirements.txt`.
- All work happens on the `demo` branch; never merge to `main` without explicit human approval.
- Update `projectprogress.md` at the end of the session; consult `docs/EJ_DJ_CALCULATION_LOGIC.md` before touching welding-feet calculations (this plan updates that doc too, since its "same feet per size for Simple and Universal" claim becomes outdated).
- Tests in this repo are plain `assert`-based `test_*.py` scripts run directly with `python test_x.py`, not a pytest suite — follow that convention, not pytest fixtures/classes.
- Spec: `docs/superpowers/specs/2026-07-30-tag-level-welding-feet-design.md` — read it for full background/rationale; this plan implements it task-by-task.

---

### Task 1: Add the GM's 4 welding-feet Excel files to the repo

The GM's source files live at `~/Downloads` on the developer's machine. This codebase's existing convention is to commit master-data Excel files at the project root (see `BELLOWS WELDING FEETS PER SIZE - 20.6.2026.xlsx` and `ANALYSIS DISMANTLING JOINT WELDING FEETS PER SIZE 27.06.2026.xlsx`, both already committed there) — the seed import script in Task 8 needs a stable, repo-relative path, not a path specific to one developer's machine.

**Files:**
- Create (copy): `Feet - S-EJ-F.xlsx`, `Feet - S-EJ-F-S-L.xlsx`, `Feet - U-EJ-F-S-L.xlsx`, `Feet - DEJ-F.xlsx` (project root)

**Interfaces:**
- Produces: 4 files at these exact repo-root paths, consumed by Task 8's import script.

- [ ] **Step 1: Copy the files into the project root**

```bash
cp "$HOME/Downloads/Feet - S-EJ-F.xlsx" "$HOME/Downloads/Feet - S-EJ-F-S-L.xlsx" "$HOME/Downloads/Feet - U-EJ-F-S-L.xlsx" "$HOME/Downloads/Feet - DEJ-F.xlsx" .
```

- [ ] **Step 2: Verify all 4 are present and non-empty**

Run: `ls -la "Feet - S-EJ-F.xlsx" "Feet - S-EJ-F-S-L.xlsx" "Feet - U-EJ-F-S-L.xlsx" "Feet - DEJ-F.xlsx"`
Expected: 4 files listed, each with a non-zero size (roughly 12–17 KB).

- [ ] **Step 3: Commit**

```bash
git add "Feet - S-EJ-F.xlsx" "Feet - S-EJ-F-S-L.xlsx" "Feet - U-EJ-F-S-L.xlsx" "Feet - DEJ-F.xlsx"
git commit -m "chore: add GM's 4 tag-specific welding-feet reference files"
```

---

### Task 2: Add `tag_no` column to `WeldingMaster` + idempotent migration

**Files:**
- Modify: `backend/services/db_service.py:83-97` (the `WeldingMaster` model) and `init_db()` (currently starts at line 483)

**Interfaces:**
- Produces: `WeldingMaster.tag_no` (nullable string column, indexed). `NULL` = generic weld-family row (today's data, unchanged meaning). Non-null = tag-specific row for that exact `tag_no`.

- [ ] **Step 1: Add the column to the model**

In `backend/services/db_service.py`, find:

```python
class WeldingMaster(Base):
    __tablename__ = "welding_master"
    id = Column(Integer, primary_key=True, index=True)
    size = Column(Integer, index=True)
    tig_inches = Column(Float, default=0.0)
    tig_feet = Column(Float, default=0.0)
    mig_inches = Column(Float, default=0.0)
    mig_feet = Column(Float, default=0.0)
    total_welding_inches = Column(Float, default=0.0)
    total_welding_feet = Column(Float, default=0.0)
    grinding_feet = Column(Float, default=0.0)
    joint_type = Column(String, default="EJ")
    version = Column(Integer, default=1)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
```

Replace with:

```python
class WeldingMaster(Base):
    __tablename__ = "welding_master"
    id = Column(Integer, primary_key=True, index=True)
    size = Column(Integer, index=True)
    tig_inches = Column(Float, default=0.0)
    tig_feet = Column(Float, default=0.0)
    mig_inches = Column(Float, default=0.0)
    mig_feet = Column(Float, default=0.0)
    total_welding_inches = Column(Float, default=0.0)
    total_welding_feet = Column(Float, default=0.0)
    grinding_feet = Column(Float, default=0.0)
    joint_type = Column(String, default="EJ")
    tag_no = Column(String, nullable=True, index=True)  # NULL = generic weld-family row; set = tag-specific row
    version = Column(Integer, default=1)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
```

- [ ] **Step 2: Add the idempotent migration + index for existing databases**

In `init_db()`, find the last `try/except` `ALTER TABLE ADD COLUMN` block (search for `hold_type VARCHAR` to locate it) and add a new block immediately after it, following the exact same pattern:

```python
    try:
        with engine.begin() as conn:
            conn.execute(text("ALTER TABLE welding_master ADD COLUMN tag_no VARCHAR;"))
    except Exception:
        pass  # Column might already exist
```

Then find the `indexes = [...]` list (search for `ix_welding_logs_date`) and add one entry to it, matching the existing `CREATE INDEX IF NOT EXISTS` style:

```python
        "CREATE INDEX IF NOT EXISTS ix_welding_master_tag_no_size ON welding_master (tag_no, size);",
```

- [ ] **Step 3: Verify the migration runs cleanly against the local dev DB**

Run: `python -c "from backend.services.db_service import init_db; init_db()"` (run it twice in a row to confirm the `ALTER TABLE`/`CREATE INDEX` are truly idempotent — second run must not error)
Expected: no exceptions either time.

Run: `psql "$DATABASE_URL" -c "\d welding_master"` (or equivalent — confirm via `information_schema.columns` if `psql` isn't available: `python -c "from backend.services.db_service import engine; import sqlalchemy as sa; insp = sa.inspect(engine); print([c['name'] for c in insp.get_columns('welding_master')])"`)
Expected: `tag_no` present in the column list.

- [ ] **Step 4: Commit**

```bash
git add backend/services/db_service.py
git commit -m "feat: add tag_no column to WeldingMaster for tag-specific welding-feet data"
```

---

### Task 3: `canonical_weld_tag` — MF-variant alias resolution (TDD)

**Files:**
- Modify: `backend/services/joint_catalog.py` (add near the other lookup helpers, after `category_for` at line 331-333)
- Test: `test_weld_tag_resolution.py` (new file, project root, following this repo's plain-`assert` convention — see `test_briefing_service.py` for the pattern)

**Interfaces:**
- Produces: `joint_catalog.canonical_weld_tag(tag_no) -> str` — resolves an MF-variant tag to its base tag; returns any other tag (including the 2 not-yet-seeded Weldend variants) unchanged.

- [ ] **Step 1: Write the failing test**

Create `test_weld_tag_resolution.py`:

```python
from backend.services.joint_catalog import canonical_weld_tag


def test_canonical_weld_tag_aliases_simple_mf_variants():
    assert canonical_weld_tag("S-EJ-F-1MF-S-L") == "S-EJ-F-S-L"
    assert canonical_weld_tag("S-EJ-F-2MF-S-L") == "S-EJ-F-S-L"


def test_canonical_weld_tag_aliases_universal_mf_variants():
    assert canonical_weld_tag("U-EJ-F-1MF-S-L") == "U-EJ-F-S-L"
    assert canonical_weld_tag("U-EJ-F-2MF-S-L") == "U-EJ-F-S-L"


def test_canonical_weld_tag_aliases_dj_mf_variants():
    assert canonical_weld_tag("DEJ-F-1MF") == "DEJ-F"
    assert canonical_weld_tag("DEJ-F-2MF") == "DEJ-F"


def test_canonical_weld_tag_passes_through_unaliased_tags():
    assert canonical_weld_tag("S-EJ-F") == "S-EJ-F"
    assert canonical_weld_tag("S-EJ-F-S-L") == "S-EJ-F-S-L"
    assert canonical_weld_tag("U-EJ-F-S-L") == "U-EJ-F-S-L"
    assert canonical_weld_tag("DEJ-F") == "DEJ-F"
    # The 2 Weldend variants have no GM data yet - they resolve to
    # themselves, so lookup falls through to the generic fallback.
    assert canonical_weld_tag("S-EJ-W-S-L") == "S-EJ-W-S-L"
    assert canonical_weld_tag("U-EJ-W-S-L") == "U-EJ-W-S-L"


def test_canonical_weld_tag_handles_unknown_tag():
    assert canonical_weld_tag("NOT-A-REAL-TAG") == "NOT-A-REAL-TAG"


if __name__ == "__main__":
    test_canonical_weld_tag_aliases_simple_mf_variants()
    test_canonical_weld_tag_aliases_universal_mf_variants()
    test_canonical_weld_tag_aliases_dj_mf_variants()
    test_canonical_weld_tag_passes_through_unaliased_tags()
    test_canonical_weld_tag_handles_unknown_tag()
    print("OK")
```

- [ ] **Step 2: Run it to verify it fails**

Run: `python test_weld_tag_resolution.py`
Expected: `ImportError: cannot import name 'canonical_weld_tag'`

- [ ] **Step 3: Implement `canonical_weld_tag`**

In `backend/services/joint_catalog.py`, after `category_for` (the function ending at line 333):

```python
# MF ("Matching Flange") variants add only a bolted-on Matching Flange
# (see their `components` lists: Matching Flanges + Bolts, Nuts + Gaskets -
# a bolted joint, not a weld) - no welded component differs from their base
# tag, so they use the base tag's welding-feet data rather than needing
# their own.
WELD_TAG_ALIAS = {
    "S-EJ-F-1MF-S-L": "S-EJ-F-S-L",
    "S-EJ-F-2MF-S-L": "S-EJ-F-S-L",
    "U-EJ-F-1MF-S-L": "U-EJ-F-S-L",
    "U-EJ-F-2MF-S-L": "U-EJ-F-S-L",
    "DEJ-F-1MF": "DEJ-F",
    "DEJ-F-2MF": "DEJ-F",
}


def canonical_weld_tag(tag_no):
    """Resolve a tag to the tag whose WeldingMaster row it should use.
    MF variants alias to their base tag. Unaliased tags (including the 2
    Weldend variants with no GM data yet) resolve to themselves."""
    return WELD_TAG_ALIAS.get(tag_no, tag_no)
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `python test_weld_tag_resolution.py`
Expected: `OK`

- [ ] **Step 5: Commit**

```bash
git add backend/services/joint_catalog.py test_weld_tag_resolution.py
git commit -m "feat: add canonical_weld_tag MF-variant alias resolution"
```

---

### Task 4: `resolve_master_row` — centralized tag-first/generic-fallback lookup (TDD)

**Files:**
- Modify: `backend/services/production_service.py` (add after `aggregate_line_feet`, which currently ends at line 94)
- Test: `test_weld_tag_resolution.py` (extend the file from Task 3)

**Interfaces:**
- Consumes: `joint_catalog.canonical_weld_tag(tag_no) -> str` (Task 3).
- Produces: `resolve_master_row(lookup, tag, weld_family, size) -> WeldingMaster | None`. `lookup` is a dict keyed by `(size, tag_no_or_joint_type)` (built by `get_weld_master_lookup`, Task 5). Used by both `sync_project_production_lines` (Task 5) and `auto_sync_all_projects_with_master` (Task 5).

- [ ] **Step 1: Write the failing tests**

Append to `test_weld_tag_resolution.py` (add the import at the top and the new tests before the `if __name__` block):

```python
from types import SimpleNamespace
from backend.services.production_service import resolve_master_row


def _row(**kwargs):
    return SimpleNamespace(**kwargs)


def test_resolve_master_row_prefers_tag_specific_row():
    lookup = {
        (50, "S-EJ-F-S-L"): _row(id=1, tig_feet=4.81),
        (50, "EJ"): _row(id=2, tig_feet=999.0),
    }
    result = resolve_master_row(lookup, "S-EJ-F-S-L", "EJ", 50)
    assert result.id == 1


def test_resolve_master_row_resolves_mf_alias_to_base_tag_row():
    lookup = {(50, "S-EJ-F-S-L"): _row(id=1, tig_feet=4.81)}
    result = resolve_master_row(lookup, "S-EJ-F-1MF-S-L", "EJ", 50)
    assert result.id == 1


def test_resolve_master_row_falls_back_to_generic_when_no_tag_row():
    lookup = {(125, "EJ"): _row(id=3, tig_feet=1.0)}
    # size 125 has no tag-specific data in any GM file yet
    result = resolve_master_row(lookup, "S-EJ-F-S-L", "EJ", 125)
    assert result.id == 3


def test_resolve_master_row_falls_back_to_generic_for_unresolved_weldend_tag():
    lookup = {(50, "EJ"): _row(id=4, tig_feet=1.0)}
    result = resolve_master_row(lookup, "S-EJ-W-S-L", "EJ", 50)
    assert result.id == 4


def test_resolve_master_row_dj_falls_back_to_ej_same_size_when_no_dj_data():
    lookup = {(50, "EJ"): _row(id=5, tig_feet=6.69)}
    result = resolve_master_row(lookup, None, "DJ", 50)
    assert result.id == 5


def test_resolve_master_row_returns_none_when_nothing_matches():
    assert resolve_master_row({}, "S-EJ-F-S-L", "EJ", 50) is None
```

And extend the `if __name__ == "__main__":` block at the bottom of `test_weld_tag_resolution.py`:

```python
    test_resolve_master_row_prefers_tag_specific_row()
    test_resolve_master_row_resolves_mf_alias_to_base_tag_row()
    test_resolve_master_row_falls_back_to_generic_when_no_tag_row()
    test_resolve_master_row_falls_back_to_generic_for_unresolved_weldend_tag()
    test_resolve_master_row_dj_falls_back_to_ej_same_size_when_no_dj_data()
    test_resolve_master_row_returns_none_when_nothing_matches()
    print("OK")
```

- [ ] **Step 2: Run it to verify it fails**

Run: `python test_weld_tag_resolution.py`
Expected: `ImportError: cannot import name 'resolve_master_row'`

- [ ] **Step 3: Implement `resolve_master_row`**

In `backend/services/production_service.py`, after `aggregate_line_feet` (ends at line 94):

```python
def resolve_master_row(lookup, tag, weld_family, size):
    """
    Resolve which WeldingMaster row a production line should use. Single
    source of truth for this resolution, used by both
    sync_project_production_lines and auto_sync_all_projects_with_master.

    Resolution order:
    1. Tag-specific row for (size, canonical_weld_tag(tag)) - exact
       GM-sourced numbers for that tag; MF variants alias to their base tag.
    2. Generic row for (size, weld_family) - today's EJ/DJ-only fallback,
       used when no tag-specific data exists yet (unresolved tags, or a
       size gap in the tag-specific data).
    3. DJ-only same-size EJ fallback (pre-existing behavior, unchanged): if
       there is no DJ data at all for this size, an EJ record is used as a
       same-size approximation - compute_master_feet folds its footage
       entirely into MIG since DJ has no TIG process.
    """
    canonical = joint_catalog.canonical_weld_tag(tag) if tag else None
    m = lookup.get((size, canonical)) if canonical else None
    if m:
        return m

    m = lookup.get((size, weld_family))
    if m:
        return m

    if weld_family == 'DJ':
        m = lookup.get((size, 'EJ'))
        if m:
            logger.warning(
                "No DJ master data for size=%s (tag=%s); falling back to EJ master record.",
                size, tag
            )
        return m

    return None
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `python test_weld_tag_resolution.py`
Expected: `OK`

- [ ] **Step 5: Commit**

```bash
git add backend/services/production_service.py test_weld_tag_resolution.py
git commit -m "feat: add resolve_master_row centralized tag-first/generic-fallback lookup"
```

---

### Task 5: Wire tag-aware lookup into both sync call sites

**Files:**
- Modify: `backend/services/production_service.py:297-388` (`sync_project_production_lines`)
- Modify: `backend/app/master/router.py` (`auto_sync_all_projects_with_master`, currently lines ~68-116)

**Interfaces:**
- Consumes: `resolve_master_row` (Task 4), `joint_catalog.canonical_weld_tag` (Task 3, used transitively).
- Produces: `get_weld_master_lookup() -> dict[(int, str), WeldingMaster]` — merges generic rows (keyed by `(size, joint_type)`) with tag-specific rows (keyed by `(size, tag_no)`), used by both call sites below and by Task 6/8.

- [ ] **Step 1: Add `get_weld_master_lookup`**

In `backend/services/production_service.py`, immediately after `resolve_master_row` (added in Task 4):

```python
def get_weld_master_lookup():
    """
    Build the (size, key) -> WeldingMaster row dict consumed by
    resolve_master_row. Merges the existing generic "latest version per weld
    family" rows (keyed by (size, joint_type)) with any tag-specific rows
    (keyed by (size, tag_no)).
    """
    lookup = {(m.size, m.joint_type): m for m in get_welding_master_latest()}

    session = SessionLocal()
    try:
        tag_rows = session.query(WeldingMaster).filter(WeldingMaster.tag_no.isnot(None)).all()
    finally:
        session.close()
    for m in tag_rows:
        lookup[(m.size, m.tag_no)] = m

    return lookup
```

- [ ] **Step 2: Use it in `sync_project_production_lines`**

In `backend/services/production_service.py`, find (inside `sync_project_production_lines`):

```python
        master_data = {(m.size, m.joint_type): m for m in get_welding_master_latest()}
```

Replace with:

```python
        master_data = get_weld_master_lookup()
```

Then find:

```python
            # Welding-feet master (EJ for Simple+Universal, DJ for Dismantling)
            m = master_data.get((size, weld_family))
            if not m and weld_family == 'DJ':
                m_ej = master_data.get((size, 'EJ'))
                if m_ej:
                    logger.warning("No DJ master data for size=%s; falling back to EJ master record.", size)
                    m = m_ej

            tig, mig, grind = compute_master_feet(m, weld_family, qty)
```

Replace with:

```python
            # Welding-feet master: tag-specific GM data first, generic
            # weld-family data as fallback (see resolve_master_row).
            m = resolve_master_row(master_data, tag, weld_family, size)

            tig, mig, grind = compute_master_feet(m, weld_family, qty)
```

- [ ] **Step 3: Use it in `auto_sync_all_projects_with_master`**

In `backend/app/master/router.py`, find:

```python
def auto_sync_all_projects_with_master():
    from backend.services.db_service import SessionLocal, ProjectProductionLine, Project, ProjectResourceAssignment
    from backend.services.production_service import get_welding_master_latest, calculate_required_resources_for_deadline, compute_master_feet
    from datetime import date

    db = SessionLocal()
    try:
        master_records = get_welding_master_latest()
        master_data = {(m.size, m.joint_type): m for m in master_records}

        lines = db.query(ProjectProductionLine).all()
        for line in lines:
            size = line.size
            qty = line.quantity
            j_type = getattr(line, 'joint_type', 'EJ')

            m = master_data.get((size, j_type))
            if not m and j_type == 'DJ':
                m = master_data.get((size, 'EJ'))

            if m:
```

Replace with:

```python
def auto_sync_all_projects_with_master():
    from backend.services.db_service import SessionLocal, ProjectProductionLine, Project, ProjectResourceAssignment
    from backend.services.production_service import get_weld_master_lookup, resolve_master_row, calculate_required_resources_for_deadline, compute_master_feet
    from datetime import date

    db = SessionLocal()
    try:
        master_data = get_weld_master_lookup()

        lines = db.query(ProjectProductionLine).all()
        for line in lines:
            size = line.size
            qty = line.quantity
            j_type = getattr(line, 'joint_type', 'EJ')
            tag = getattr(line, 'joint_type_code', None)

            m = resolve_master_row(master_data, tag, j_type, size)

            if m:
```

- [ ] **Step 4: Verify the backend still boots and existing behavior is unchanged**

Run: `python -m uvicorn backend.main:app --port 8003 --reload` (start it, confirm no import/startup errors, then stop it)
Expected: server starts cleanly (no tag-specific rows exist yet at this point, so every lookup still falls through to the generic path exactly as before — this step should produce zero behavior change).

- [ ] **Step 5: Commit**

```bash
git add backend/services/production_service.py backend/app/master/router.py
git commit -m "feat: use tag-aware welding-feet lookup in both project-sync call sites"
```

---

### Task 6: `POST /master/welding-size` accepts an optional `tag_no`

**Files:**
- Modify: `backend/app/master/schemas.py`
- Modify: `backend/app/master/router.py:35-70` (`create_custom_welding_size`)

**Interfaces:**
- Consumes: none new (uses `WeldingMaster` model from Task 2).
- Produces: `upsert_tag_welding_master(tag_no, size, tig_feet, mig_feet, grinding_feet) -> WeldingMaster` in `backend/services/production_service.py`, reused by Task 8's seed script.

- [ ] **Step 1: Add `tag_no` to the request schema**

In `backend/app/master/schemas.py`, find:

```python
class WeldingSizeCreate(BaseModel):
    size: int
    tig_feet: float
    mig_feet: float
    grinding_feet: float
    joint_type: str
```

Replace with:

```python
class WeldingSizeCreate(BaseModel):
    size: int
    tig_feet: float
    mig_feet: float
    grinding_feet: float
    joint_type: str
    tag_no: str | None = None
```

- [ ] **Step 2: Add `upsert_tag_welding_master`**

In `backend/services/production_service.py`, after `get_weld_master_lookup` (added in Task 5):

```python
def upsert_tag_welding_master(tag_no, size, tig_feet, mig_feet, grinding_feet):
    """
    Insert-or-update the tag-specific WeldingMaster row for (tag_no, size).
    Used by scripts/import_tag_welding_master.py (the one-off GM-file seed
    import) and by the Custom Size frontend flow when a PM/GM fills a
    tag+size gap. There is always exactly one row per (tag_no, size),
    updated in place - tag-specific rows are not part of the joint_type
    version-history lineage that generic rows use.
    """
    session = SessionLocal()
    try:
        row = session.query(WeldingMaster).filter(
            WeldingMaster.tag_no == tag_no, WeldingMaster.size == size
        ).first()
        weld_family = joint_catalog.weld_family_for(tag_no)
        if row:
            row.tig_feet = tig_feet
            row.mig_feet = mig_feet
            row.grinding_feet = grinding_feet
            row.total_welding_feet = tig_feet + mig_feet
            row.joint_type = weld_family
        else:
            row = WeldingMaster(
                size=size,
                tag_no=tag_no,
                joint_type=weld_family,
                tig_feet=tig_feet,
                mig_feet=mig_feet,
                total_welding_feet=tig_feet + mig_feet,
                grinding_feet=grinding_feet,
                version=1,
            )
            session.add(row)
        session.commit()
        session.refresh(row)
        return row
    finally:
        session.close()
```

- [ ] **Step 3: Use it in the endpoint when `tag_no` is provided**

In `backend/app/master/router.py`, find:

```python
@router.post("/welding-size")
def create_custom_welding_size(req: WeldingSizeCreate, db = Depends(get_db), current_user: dict = Depends(require_roles(MANAGEMENT))):
    from backend.services.db_service import WeldingMaster
    
    latest = db.query(WeldingMaster).filter(
```

Replace with:

```python
@router.post("/welding-size")
def create_custom_welding_size(req: WeldingSizeCreate, db = Depends(get_db), current_user: dict = Depends(require_roles(MANAGEMENT))):
    from backend.services.db_service import WeldingMaster

    if req.tag_no:
        from backend.services.production_service import upsert_tag_welding_master
        wm = upsert_tag_welding_master(req.tag_no, req.size, req.tig_feet, req.mig_feet, req.grinding_feet)
        return {
            "success": True,
            "message": f"Custom size saved for tag {req.tag_no}",
            "data": {
                "size": wm.size,
                "type": wm.joint_type,
                "tag_no": wm.tag_no,
                "tig_feet": round(wm.tig_feet, 2) if wm.tig_feet else 0,
                "mig_feet": round(wm.mig_feet, 2) if wm.mig_feet else 0,
                "grinding_feet": round(wm.grinding_feet, 2) if wm.grinding_feet else 0,
            }
        }

    latest = db.query(WeldingMaster).filter(
```

(everything below that line in the function is unchanged — the existing generic-row path still runs exactly as today when `tag_no` is omitted.)

- [ ] **Step 4: Verify manually with curl**

Start the backend (`python -m uvicorn backend.main:app --port 8003 --reload`), log in to get a management-role token, then:

```bash
curl -s -X POST http://localhost:8003/api/v1/master/welding-size \
  -H "Content-Type: application/json" -H "Authorization: Bearer $TOKEN" \
  -d '{"size": 125, "tig_feet": 1.1, "mig_feet": 2.2, "grinding_feet": 0.3, "joint_type": "EJ", "tag_no": "S-EJ-F-S-L"}'
```

Expected: `{"success": true, ...}` with `"tag_no": "S-EJ-F-S-L"` in `data`. Then confirm a second POST with the same `size`/`tag_no` updates the same row rather than creating a duplicate (query the DB: `SELECT count(*) FROM welding_master WHERE tag_no='S-EJ-F-S-L' AND size=125;` should be `1`).

- [ ] **Step 5: Commit**

```bash
git add backend/app/master/schemas.py backend/app/master/router.py backend/services/production_service.py
git commit -m "feat: accept tag_no in POST /master/welding-size for tag-specific gap fills"
```

---

### Task 7: Frontend Custom Size modal passes `tag_no`

**Files:**
- Modify: `next-frontend/src/app/(main)/projects/add/page.tsx` (`saveCustomSize`, ~line 229-260)
- Modify: `next-frontend/src/app/(main)/projects/edit/page.tsx` (`saveCustomSize`, ~line 380-410)

**Interfaces:**
- Consumes: `POST /api/v1/master/welding-size` with optional `tag_no` (Task 6).

- [ ] **Step 1: Pass `tag_no` from the add page**

In `next-frontend/src/app/(main)/projects/add/page.tsx`, find (inside `saveCustomSize`):

```tsx
        body: JSON.stringify({
          size: Number(customSizeData.size),
          tig_feet: Number(customSizeData.tig_feet),
          mig_feet: Number(customSizeData.mig_feet),
          grinding_feet: Number(customSizeData.grinding_feet),
          joint_type: customSizeData.joint_type,
        }),
```

Replace with:

```tsx
        body: JSON.stringify({
          size: Number(customSizeData.size),
          tig_feet: Number(customSizeData.tig_feet),
          mig_feet: Number(customSizeData.mig_feet),
          grinding_feet: Number(customSizeData.grinding_feet),
          joint_type: customSizeData.joint_type,
          tag_no: bellows[customSizeRowIndex]?.joint_type_code || null,
        }),
```

- [ ] **Step 2: Pass `tag_no` from the edit page**

In `next-frontend/src/app/(main)/projects/edit/page.tsx`, find the identical `saveCustomSize` body block and apply the same replacement (add `tag_no: bellows[customSizeRowIndex]?.joint_type_code || null,` as the last field in the `JSON.stringify({...})` call).

- [ ] **Step 3: Build to verify no type errors**

Run: `npm --prefix next-frontend run build`
Expected: build succeeds with no TypeScript errors.

- [ ] **Step 4: Manual browser check**

Start both servers (`python -m uvicorn backend.main:app --port 8003 --reload` and `npm --prefix next-frontend run dev`), open the Add Project page, add a bellows row with joint type `S-EJ-F-S-L`, pick size "CUSTOM", fill in the modal, save — confirm in the network tab that the request body includes `"tag_no": "S-EJ-F-S-L"` and the response succeeds.

- [ ] **Step 5: Commit**

```bash
git add "next-frontend/src/app/(main)/projects/add/page.tsx" "next-frontend/src/app/(main)/projects/edit/page.tsx"
git commit -m "feat: pass tag_no when saving a Custom Size gap fill"
```

---

### Task 8: Seed import script for the 4 GM files (TDD on parsing)

The GM's files have two distinct column layouts. The 3 EJ-family files (`S-EJ-F`, `S-EJ-F-S-L`, `U-EJ-F-S-L`) share a "Bellows Total welding details" summary block at columns V (Size), X (TIG feet), Z (MIG feet), AC (Grinding sq.ft), data rows 4-41. `S-EJ-F-S-L` and `U-EJ-F-S-L` have a single blank divider row at row 26 before data resumes at size 1600 — **the parser must skip blank rows, not stop at the first one**, or it will silently drop the entire 1600-3000mm range for those two tags. `S-EJ-F` itself has no data past row 25 (size 1500) — confirmed by direct inspection, not a divider. `DEJ-F.xlsx` uses its main table directly: column B (Size), R (Feet/Size, stored as `mig_feet` since DJ has no TIG), S (Grinding), data rows 4-40, no blank rows.

**Files:**
- Create: `scripts/import_tag_welding_master.py`
- Test: `test_import_tag_welding_master.py` (new file, project root)

**Interfaces:**
- Consumes: `upsert_tag_welding_master` (Task 6), the 4 files from Task 1.
- Produces: `parse_ej_tag_sheet(path) -> list[dict]`, `parse_dj_tag_sheet(path) -> list[dict]` — each dict has keys `size` (int), `tig_feet`, `mig_feet`, `grinding_feet` (floats).

- [ ] **Step 1: Write the failing test**

Create `test_import_tag_welding_master.py`:

```python
from scripts.import_tag_welding_master import parse_ej_tag_sheet, parse_dj_tag_sheet


def test_parse_ej_tag_sheet_s_ej_f_size_50():
    rows = parse_ej_tag_sheet("Feet - S-EJ-F.xlsx")
    row = next(r for r in rows if r["size"] == 50)
    assert abs(row["tig_feet"] - 5.299025096128609) < 1e-6
    assert row["mig_feet"] == 0
    assert abs(row["grinding_feet"] - 0.016595765503808865) < 1e-6


def test_parse_ej_tag_sheet_s_ej_f_stops_at_1500():
    rows = parse_ej_tag_sheet("Feet - S-EJ-F.xlsx")
    sizes = sorted(r["size"] for r in rows)
    assert sizes[-1] == 1500
    assert len(sizes) == 22


def test_parse_ej_tag_sheet_s_ej_f_s_l_size_50():
    rows = parse_ej_tag_sheet("Feet - S-EJ-F-S-L.xlsx")
    row = next(r for r in rows if r["size"] == 50)
    assert abs(row["tig_feet"] - 4.806899111876641) < 1e-6
    assert abs(row["mig_feet"] - 5.114360670603674) < 1e-6
    assert abs(row["grinding_feet"] - 0.5601070857535493) < 1e-6


def test_parse_ej_tag_sheet_s_ej_f_s_l_covers_full_range_past_blank_divider_row():
    # Row 26 is a blank divider row in this file, before data resumes at
    # 1600mm - the parser must not treat it as end-of-data.
    rows = parse_ej_tag_sheet("Feet - S-EJ-F-S-L.xlsx")
    sizes = sorted(r["size"] for r in rows)
    assert sizes[-1] == 3000
    assert len(sizes) == 37
    row_1600 = next(r for r in rows if r["size"] == 1600)
    assert abs(row_1600["tig_feet"] - 56.115016192913394) < 1e-6
    assert abs(row_1600["mig_feet"] - 75.67632080314962) < 1e-6
    assert abs(row_1600["grinding_feet"] - 18.501897996613142) < 1e-6


def test_parse_ej_tag_sheet_u_ej_f_s_l_size_50():
    rows = parse_ej_tag_sheet("Feet - U-EJ-F-S-L.xlsx")
    row = next(r for r in rows if r["size"] == 50)
    assert abs(row["tig_feet"] - 9.613798223753282) < 1e-6
    assert abs(row["mig_feet"] - 5.114360670603674) < 1e-6
    assert abs(row["grinding_feet"] - 1.5558530159820814) < 1e-6


def test_parse_ej_tag_sheet_u_ej_f_s_l_covers_full_range():
    rows = parse_ej_tag_sheet("Feet - U-EJ-F-S-L.xlsx")
    sizes = sorted(r["size"] for r in rows)
    assert sizes[-1] == 3000
    assert len(sizes) == 37


def test_parse_dj_tag_sheet_dej_f_size_50():
    rows = parse_dj_tag_sheet("Feet - DEJ-F.xlsx")
    row = next(r for r in rows if r["size"] == 50)
    assert row["tig_feet"] == 0
    assert abs(row["mig_feet"] - 5.029527496062993) < 1e-6
    assert abs(row["grinding_feet"] - 0.95221605349723) < 1e-6


def test_parse_dj_tag_sheet_dej_f_covers_full_range():
    rows = parse_dj_tag_sheet("Feet - DEJ-F.xlsx")
    sizes = sorted(r["size"] for r in rows)
    assert sizes[-1] == 3000
    assert len(sizes) == 37


if __name__ == "__main__":
    test_parse_ej_tag_sheet_s_ej_f_size_50()
    test_parse_ej_tag_sheet_s_ej_f_stops_at_1500()
    test_parse_ej_tag_sheet_s_ej_f_s_l_size_50()
    test_parse_ej_tag_sheet_s_ej_f_s_l_covers_full_range_past_blank_divider_row()
    test_parse_ej_tag_sheet_u_ej_f_s_l_size_50()
    test_parse_ej_tag_sheet_u_ej_f_s_l_covers_full_range()
    test_parse_dj_tag_sheet_dej_f_size_50()
    test_parse_dj_tag_sheet_dej_f_covers_full_range()
    print("OK")
```

- [ ] **Step 2: Run it to verify it fails**

Run: `python test_import_tag_welding_master.py`
Expected: `ModuleNotFoundError: No module named 'scripts.import_tag_welding_master'` (or similar — the module doesn't exist yet)

- [ ] **Step 3: Write the parsing + import script**

Create `scripts/import_tag_welding_master.py`:

```python
"""
One-off seed import for the GM's 4 tag-specific welding-feet reference files
into WeldingMaster's tag-specific rows (tag_no set). Run manually:

    python scripts/import_tag_welding_master.py

Safe to re-run (upsert_tag_welding_master overwrites existing rows for the
same (tag_no, size) rather than duplicating them) - re-run this after the GM
sends a corrected file, or once W-variant files arrive for S-EJ-W-S-L /
U-EJ-W-S-L (add their filenames to DJ_TAG_FILES/EJ_TAG_FILES as appropriate).
"""
import openpyxl

EJ_TAG_FILES = {
    "S-EJ-F": "Feet - S-EJ-F.xlsx",
    "S-EJ-F-S-L": "Feet - S-EJ-F-S-L.xlsx",
    "U-EJ-F-S-L": "Feet - U-EJ-F-S-L.xlsx",
}
DJ_TAG_FILES = {
    "DEJ-F": "Feet - DEJ-F.xlsx",
}

# Data rows start at 4 in every file; 42 is past the known max (row 41) with
# one row of headroom. Rows are scanned rather than stopped-at-first-blank
# because S-EJ-F-S-L and U-EJ-F-S-L have a blank divider row at 26 before
# data resumes at 1600mm.
_FIRST_DATA_ROW = 4
_LAST_ROW_EXCLUSIVE = 42


def parse_ej_tag_sheet(path):
    """
    Parse an EJ-family tag file (S-EJ-F / S-EJ-F-S-L / U-EJ-F-S-L layout):
    the "Bellows Total welding details" summary block, columns V (Size),
    X (TIG feet), Z (MIG feet), AC (Grinding sq.ft).
    """
    wb = openpyxl.load_workbook(path, data_only=True)
    ws = wb["Sheet1"]
    rows = []
    for r in range(_FIRST_DATA_ROW, _LAST_ROW_EXCLUSIVE):
        size = ws.cell(row=r, column=22).value  # V
        if size is None:
            continue
        rows.append({
            "size": int(size),
            "tig_feet": float(ws.cell(row=r, column=24).value or 0),  # X
            "mig_feet": float(ws.cell(row=r, column=26).value or 0),  # Z
            "grinding_feet": float(ws.cell(row=r, column=29).value or 0),  # AC
        })
    return rows


def parse_dj_tag_sheet(path):
    """
    Parse a DJ-family tag file (DEJ-F layout): main table columns B (Size),
    R (Feet/Size -> mig_feet, DJ has no TIG process), S (Grinding).
    """
    wb = openpyxl.load_workbook(path, data_only=True)
    ws = wb["Sheet1"]
    rows = []
    for r in range(_FIRST_DATA_ROW, _LAST_ROW_EXCLUSIVE):
        size = ws.cell(row=r, column=2).value  # B
        if size is None:
            continue
        rows.append({
            "size": int(size),
            "tig_feet": 0.0,
            "mig_feet": float(ws.cell(row=r, column=18).value or 0),  # R
            "grinding_feet": float(ws.cell(row=r, column=19).value or 0),  # S
        })
    return rows


def import_all_tag_welding_masters():
    from backend.services.production_service import upsert_tag_welding_master

    results = {}
    for tag_no, filename in EJ_TAG_FILES.items():
        rows = parse_ej_tag_sheet(filename)
        for row in rows:
            upsert_tag_welding_master(tag_no, row["size"], row["tig_feet"], row["mig_feet"], row["grinding_feet"])
        results[tag_no] = len(rows)
    for tag_no, filename in DJ_TAG_FILES.items():
        rows = parse_dj_tag_sheet(filename)
        for row in rows:
            upsert_tag_welding_master(tag_no, row["size"], row["tig_feet"], row["mig_feet"], row["grinding_feet"])
        results[tag_no] = len(rows)
    return results


if __name__ == "__main__":
    for tag_no, count in import_all_tag_welding_masters().items():
        print(f"{tag_no}: {count} sizes imported")
```

- [ ] **Step 4: Create `scripts/__init__.py` if it doesn't already exist**

Run: `test -f scripts/__init__.py || touch scripts/__init__.py`
(needed so `from scripts.import_tag_welding_master import ...` resolves as a package import, matching how `scripts/send_daily_briefing.py` is already imported elsewhere in this repo)

- [ ] **Step 5: Run the test to verify it passes**

Run: `python test_import_tag_welding_master.py`
Expected: `OK`

- [ ] **Step 6: Run the import against the local dev DB**

Run: `python scripts/import_tag_welding_master.py`
Expected output: 4 lines, e.g. `S-EJ-F: 22 sizes imported`, `S-EJ-F-S-L: 37 sizes imported`, `U-EJ-F-S-L: 37 sizes imported`, `DEJ-F: 37 sizes imported`.

Then spot-check the DB directly:

```bash
python -c "
from backend.services.db_service import SessionLocal, WeldingMaster
s = SessionLocal()
for row in s.query(WeldingMaster).filter(WeldingMaster.tag_no=='S-EJ-F-S-L', WeldingMaster.size.in_([50,1600,3000])).all():
    print(row.size, row.tig_feet, row.mig_feet, row.grinding_feet)
s.close()
"
```

Expected: size 50 → tig≈4.807, mig≈5.114; size 1600 → tig≈56.115, mig≈75.676; size 3000 present (no gap).

- [ ] **Step 7: Commit**

```bash
git add scripts/import_tag_welding_master.py scripts/__init__.py test_import_tag_welding_master.py
git commit -m "feat: seed-import the GM's 4 tag-specific welding-feet files"
```

---

### Task 9: End-to-end verification + docs update

**Files:**
- Modify: `docs/EJ_DJ_CALCULATION_LOGIC.md` (update the outdated "Simple and Universal both use the same EJ master" claim)
- Modify: `projectprogress.md` (session log entry, per this repo's required workflow)

**Interfaces:** none (verification + documentation only).

- [ ] **Step 1: Full manual verification against the local dev DB**

With the backend running and the seed import from Task 8 already applied, create or edit a project with production lines for: `S-EJ-F`, `S-EJ-F-S-L`, `U-EJ-F-S-L`, `DEJ-F`, and one MF-aliased tag (`S-EJ-F-1MF-S-L`), all at size 50. Sync the project (save it) and confirm via the API (`GET` the project or its production lines) that:
- `S-EJ-F` line: tig_feet ≈ 5.299 × qty, mig_feet = 0
- `S-EJ-F-S-L` line: tig_feet ≈ 4.807 × qty, mig_feet ≈ 5.114 × qty
- `U-EJ-F-S-L` line: tig_feet ≈ 9.614 × qty, mig_feet ≈ 5.114 × qty
- `DEJ-F` line: tig_feet = 0, mig_feet ≈ 5.030 × qty (folded from the DJ MIG+Grinding-only rule)
- `S-EJ-F-1MF-S-L` line: tig_feet/mig_feet **identical** to the `S-EJ-F-S-L` line (confirms the alias resolution works end-to-end, not just in the unit test)

Also add one production line at size 125 for `S-EJ-F-S-L` (a size with no tag-specific data) and confirm it falls back to today's generic EJ master numbers rather than erroring or returning zero.

- [ ] **Step 2: Update `docs/EJ_DJ_CALCULATION_LOGIC.md`**

Read the file first, then update the section describing the "Simple and Universal EJ share the same welding master" rule to reflect the new tag-aware lookup: tag-specific data (from the GM's files) is used first when available for a tag (10 of 12 catalog tags now have it, directly or via MF-alias), falling back to the old generic EJ/DJ-only master for the 2 not-yet-supplied Weldend tags and any size gaps. Reference `resolve_master_row` and `canonical_weld_tag` as the functions implementing this, and link to `docs/superpowers/specs/2026-07-30-tag-level-welding-feet-design.md` for full rationale.

- [ ] **Step 3: Update `projectprogress.md`**

Add a new session entry at the top (above the most recent dated entry) following this file's existing format (see prior entries for the exact structure: `## Date: YYYY-MM-DD (Session NN — <title>)`, `### What was done:`, `### What's still pending:`, `### Commits this session:`). Cover: the GM's 4 files, the 10-of-12-tags coverage via MF-aliasing, the 2 Weldend tags still pending exact GM data, and the size-125/gap-fill frontend flow. List the commits from Tasks 1-8.

- [ ] **Step 4: Commit**

```bash
git add docs/EJ_DJ_CALCULATION_LOGIC.md projectprogress.md
git commit -m "docs: log tag-level welding feet session and update calculation-logic doc"
```

- [ ] **Step 5: Push to `demo`**

```bash
git push origin demo
```

(Per this repo's workflow: verify on the `demo` Railway deployment before asking the user for permission to merge to `main`. Do not merge without explicit approval.)

---

## Self-Review Notes

- **Spec coverage:** all 6 design sections have a task — data model (Task 2), MF-alias resolution (Task 3), seed import (Task 8), lookup/fallback (Tasks 4-5), frontend entry (Tasks 6-7), testing (Tasks 3, 4, 8 each have TDD coverage; Task 9 covers the spec's manual-verification requirement).
- **Column mapping accuracy:** all column letters/indices (V/X/Z/AC for the 3 EJ-family files, B/R/S for DEJ-F) and every hardcoded expected value in Task 8's tests were confirmed by direct inspection of the actual files (`data_only=True` cell reads), not inferred from formulas — including the blank-divider-row discovery for `S-EJ-F-S-L`/`U-EJ-F-S-L`, which a naive "stop at first blank row" parser would have gotten wrong (silently dropping the entire 1600-3000mm range for 2 of the 4 tags).
- **No DB-level unique constraint on `(tag_no, size)`** was added, matching the spec's stated app-level-only enforcement decision — `upsert_tag_welding_master`'s query-then-insert-or-update is the only thing preventing duplicates.
