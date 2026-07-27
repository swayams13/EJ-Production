# Executive Morning Briefing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extend `/dashboard/executive` into a 3-tab CEO/MD morning briefing (Briefing / People & KPIs / Projects) backed by one new aggregation endpoint and two hand-rolled chart components, with zero new dependencies.

**Architecture:** One new pure-function module (`briefing_service.py`) does all date-bucketing/ranking logic and is unit-tested without a DB. One new FastAPI endpoint (`GET /api/v1/dashboard/executive-briefing`) runs the DB queries and delegates to that module. The frontend adds two small chart components and restructures the existing executive page into three tabs, reusing existing UI primitives (`MetricCard`, `Table`, `ProgressBar`, `Badge`) and the existing `/executive` and `/scheduler/productivity` endpoints unchanged.

**Tech Stack:** FastAPI + SQLAlchemy + PostgreSQL (backend), Next.js 16 / React 19 / Tailwind v4 (frontend), no new npm dependency.

## Global Constraints

- Database is strictly PostgreSQL — no SQLite anywhere, including tests (per project `CLAUDE.md`). Do not replicate the `test_client.py` precedent of `DATABASE_URL=sqlite:///./test.db` — that file is pre-existing tech debt, not a pattern to extend.
- New Python dependencies: none. New npm dependencies: none.
- All new endpoints gated with `require_roles(EXECUTIVES + ["Developer"])` matching the existing `/executive` endpoint (`backend/app/dashboard/router.py:143-147`).
- Schema changes use this codebase's existing idempotent-migration convention: an `ALTER TABLE ... ADD COLUMN` string appended to the `columns` list in `backend/services/db_service.py:init_db()` (`:502-518`), wrapped in try/except so re-running is a no-op. No Alembic in this repo.
- Frontend: never interpolate Tailwind class names at runtime; chart colors use inline `style={{ backgroundColor: "#hex" }}`, which is a different (safe) mechanism, not a Tailwind class string build — consistent with `docs/UI_DESIGN_SYSTEM.md`.
- Categorical chart colors (validated via the `dataviz` skill's `scripts/validate_palette.js` against this app's `--surface #fbfcfb`): TIG `#2a78d6` (blue), MIG `#008300` (green), Grinding `#eda100` (yellow — passes CVD/normal-vision floors with a contrast WARN, mitigated by always-visible direct labels/legend, never hover-only).
- Status donut (project status) reuses this app's *existing* status tokens already used by `BADGE_TONE` in `executive/page.tsx`: Active `#5c6864` (ink-soft), Delayed `#b2594a` (critical), Hold `#bd8a52` (warning), Completed `#5c8a6c` (success) — do not invent new status colors.
- `ProjectHoldHistory` has no actor column (confirmed in `backend/services/db_service.py:361-368`) and the hold/resume endpoint (`PUT /api/v1/projects/{id}`) is open to all of `MANAGEMENT`, not GM-exclusive. The GM KPI's `holds_total`/`resumes_total` are therefore company-wide counts, not GM-attributed — this is a deliberate, documented limitation, not a bug.
- `ProjectCompletionRequest.requested_by` / `.reviewed_by` are **username strings**, not user IDs (`backend/services/db_service.py:573,576`). `PurchaseOrder.raised_by` and `GoodsReceipt.received_by` **are** integer FKs to `users.id` (`:251,297`). Joins must use the correct key per table — don't mix these up.
- Workers do not log in (`backend/app/auth/rbac.py:36-39`) — there is no "worker entries" concept. Worker KPIs come exclusively from `/scheduler/productivity` (target vs actual feet, already implemented, reused as-is).

---

### Task 1: `Project.created_by` migration

**Files:**
- Modify: `backend/services/db_service.py:77` (Project model), `backend/services/db_service.py:502-518` (init_db columns list)
- Modify: `backend/app/projects/router.py:9` (import), `backend/app/projects/router.py:105-125` (create_project)

**Interfaces:**
- Produces: `Project.created_by` (Integer, nullable, FK `users.id`) — consumed by Task 3's activity-feed query as `Project.created_by.isnot(None)`.

- [ ] **Step 1: Add the column to the `Project` model**

In `backend/services/db_service.py`, in the `Project` class, add a line right after `committed_dispatch_date`:

```python
class Project(Base):
    __tablename__ = "projects"
    id = Column(Integer, primary_key=True, index=True)
    quotation_no = Column(String, unique=True, index=True, nullable=False)
    project_name = Column(String)
    client_name = Column(String)
    contact_person = Column(String)
    phone = Column(String, index=True)
    email = Column(String, index=True)
    client_address = Column(Text)
    status = Column(String, default="Active")
    status_note = Column(Text, nullable=True)
    hold_type = Column(String, nullable=True)
    hold_until_date = Column(Date, nullable=True)
    target_date = Column(Date, nullable=True)
    payroll = Column(String, default="Company", nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    priority = Column(String, nullable=True)                   # P1|P2|P3 — null = auto-compute from deadline
    order_value = Column(Float, nullable=True)                 # quotation value ₹
    advance_received = Column(Float, default=0.0)              # % advance paid
    committed_dispatch_date = Column(Date, nullable=True)      # client-committed date
    created_by = Column(Integer, ForeignKey("users.id"), nullable=True)  # who created this project; NULL for pre-migration rows

    production_lines = relationship("ProjectProductionLine", back_populates="project", cascade="all, delete-orphan")
    resource_assignment = relationship("ProjectResourceAssignment", uselist=False, back_populates="project", cascade="all, delete-orphan")
```

- [ ] **Step 2: Add the idempotent ALTER TABLE to `init_db()`**

In `backend/services/db_service.py`, add a new entry to the `columns` list (around line 517, right after the `parts` entries):

```python
    columns = [
        "ALTER TABLE users ADD COLUMN experience VARCHAR;",
        "ALTER TABLE users ADD COLUMN skill VARCHAR;",
        "ALTER TABLE users ADD COLUMN department VARCHAR;",
        "ALTER TABLE users ADD COLUMN base_productivity FLOAT;",
        "ALTER TABLE welding_master ADD COLUMN joint_type VARCHAR DEFAULT 'EJ';",
        "ALTER TABLE project_production_lines ADD COLUMN joint_type VARCHAR DEFAULT 'EJ';",
        "ALTER TABLE audit_logs ADD COLUMN username VARCHAR;",
        "ALTER TABLE projects ADD COLUMN payroll VARCHAR DEFAULT 'Company';",
        # --- joint tag system ---
        "ALTER TABLE project_production_lines ADD COLUMN joint_category VARCHAR;",
        "ALTER TABLE project_production_lines ADD COLUMN joint_type_code VARCHAR;",
        "ALTER TABLE project_production_lines ADD COLUMN paint_status VARCHAR DEFAULT 'Yet to start';",
        "ALTER TABLE project_production_lines ADD COLUMN variable_qtys_json TEXT;",
        "ALTER TABLE parts ADD COLUMN qty_per_unit DOUBLE PRECISION DEFAULT 1.0;",
        "ALTER TABLE parts ADD COLUMN total_qty INTEGER DEFAULT 0;",
        # --- executive morning briefing ---
        "ALTER TABLE projects ADD COLUMN created_by INTEGER;",
    ]
```

- [ ] **Step 3: Set `created_by` on project creation**

In `backend/app/projects/router.py`, add `User` to the existing import (line 9):

```python
from backend.services.db_service import get_db, Project, ProjectResourceAssignment, ProjectProductionLine, ProjectHoldHistory, MaterialHold, PurchaseOrder, PurchaseOrderLine, ProjectCompletionRequest, User
```

Then in `create_project` (starting at line 107), look up the creator and pass it into the `Project(...)` constructor:

```python
def create_project(req: ProjectCreate, db: Session = Depends(get_db), current_user: dict = Depends(require_roles(MANAGEMENT))):
    existing = db.query(Project).filter(Project.quotation_no == req.quotation_no).first()
    if existing:
        raise HTTPException(status_code=400, detail="Project Code already exists")

    creator = db.query(User).filter_by(username=current_user["username"]).first()

    new_proj = Project(
        quotation_no=req.quotation_no,
        client_name="",
        project_name=req.project_name or req.quotation_no,
        contact_person="Production User",
        target_date=req.target_date,
        payroll=req.payroll,
        created_at=datetime.utcnow(),
        status="Active",
        priority=req.priority,
        order_value=req.order_value,
        advance_received=req.advance_received or 0.0,
        committed_dispatch_date=req.committed_dispatch_date,
        created_by=creator.id if creator else None,
    )
```

(Everything below this in `create_project` is unchanged.)

- [ ] **Step 4: Verify — import check + manual DB check**

There is no dedicated migration test in this codebase (none of the existing `ALTER TABLE` columns have one either) — verify by import and, once the dev server is run against the real Postgres dev DB (Task 6), confirm the column exists:

```bash
python -c "from backend.services.db_service import Project; assert 'created_by' in Project.__table__.columns; print('OK')"
python -m py_compile backend/services/db_service.py backend/app/projects/router.py
```

Expected: `OK` printed, no syntax errors.

- [ ] **Step 5: Commit**

```bash
git add backend/services/db_service.py backend/app/projects/router.py
git commit -m "feat: add Project.created_by for executive activity feed attribution"
```

---

### Task 2: `briefing_service.py` — pure aggregation functions (TDD)

**Files:**
- Create: `backend/services/briefing_service.py`
- Test: `test_briefing_service.py` (repo root, matching this project's existing flat `test_*.py` convention, e.g. `test_notification_service.py`)

**Interfaces:**
- Produces (consumed by Task 3):
  - `summarize_production(rows, today: date) -> dict` — `rows` is an iterable of objects with `.date` (date), `.process_type` (str), `.feet` (float), `.entries` (int). Returns `{"yesterday": {...}, "last_7d": {...}, "trend_14d": [...]}` where each bucket is `{tig_feet, mig_feet, grinding_feet, total_feet, entries}`.
  - `on_time_pct(projects, today: date) -> int` — `projects` is an iterable of objects with `.status` and `.committed_dispatch_date`. Returns rounded percentage (100 if no active dated projects).
  - `build_leaderboard(yesterday_counts: dict[int,int], week_counts: dict[int,int], users_by_id: dict[int, Any]) -> list[dict]` — `users_by_id` values need `.full_name` and `.role`. Returns list of `{user_id, full_name, role, entries_yesterday, entries_7d}` sorted by `entries_7d` descending.
  - `resolve_and_rank_activity(raw_events: list[dict], users_by_id: dict[int, Any], users_by_username: dict[str, Any], limit: int = 50) -> list[dict]` — each `raw_event` has `timestamp` (datetime), `action` (str), `detail` (str), `project_ref` (str|None), and either `user_id` (int|None) or `username` (str|None). Returns newest-first list capped at `limit`, each `{timestamp: iso str, actor_name, actor_role, action, detail, project_ref}`.

- [ ] **Step 1: Write failing tests for `summarize_production`**

Create `test_briefing_service.py`:

```python
from types import SimpleNamespace
from datetime import date, datetime, timedelta
from backend.services.briefing_service import summarize_production, on_time_pct, build_leaderboard, resolve_and_rank_activity


def _row(d, process_type, feet, entries):
    return SimpleNamespace(date=d, process_type=process_type, feet=feet, entries=entries)


def test_summarize_production_buckets_yesterday_and_week():
    today = date(2026, 7, 27)
    yesterday = today - timedelta(days=1)
    two_days_ago = today - timedelta(days=2)
    rows = [
        _row(yesterday, "TIG", 100.0, 2),
        _row(yesterday, "MIG", 50.0, 1),
        _row(two_days_ago, "Grinding", 30.0, 1),
    ]
    result = summarize_production(rows, today)
    assert result["yesterday"]["tig_feet"] == 100.0
    assert result["yesterday"]["mig_feet"] == 50.0
    assert result["yesterday"]["total_feet"] == 150.0
    assert result["yesterday"]["entries"] == 3
    assert result["last_7d"]["grinding_feet"] == 30.0
    assert result["last_7d"]["total_feet"] == 180.0
    assert len(result["trend_14d"]) == 2


def test_summarize_production_ignores_unknown_process_type():
    today = date(2026, 7, 27)
    rows = [_row(today - timedelta(days=1), "Unknown", 10.0, 1)]
    result = summarize_production(rows, today)
    assert result["yesterday"]["total_feet"] == 0.0


if __name__ == "__main__":
    test_summarize_production_buckets_yesterday_and_week()
    test_summarize_production_ignores_unknown_process_type()
    print("OK")
```

- [ ] **Step 2: Run and verify it fails**

```bash
python test_briefing_service.py
```

Expected: `ModuleNotFoundError: No module named 'backend.services.briefing_service'`

- [ ] **Step 3: Implement `summarize_production`**

Create `backend/services/briefing_service.py`:

```python
from datetime import timedelta

_PROCESS_KEY = {"TIG": "tig_feet", "MIG": "mig_feet", "Grinding": "grinding_feet"}


def _empty_bucket():
    return {"tig_feet": 0.0, "mig_feet": 0.0, "grinding_feet": 0.0, "total_feet": 0.0, "entries": 0}


def summarize_production(rows, today):
    """
    rows: iterable of objects with .date, .process_type ("TIG"|"MIG"|"Grinding"),
          .feet (float), .entries (int) — one row per (date, process_type),
          already grouped/summed by the caller's DB query, spanning the last 14 days.
    Returns {"yesterday": bucket, "last_7d": bucket, "trend_14d": [day, ...]} where
    bucket = {tig_feet, mig_feet, grinding_feet, total_feet, entries}.
    "last_7d" covers the 7 completed days ending yesterday (today is still in progress).
    """
    yesterday = today - timedelta(days=1)
    week_start = today - timedelta(days=7)

    y_bucket = _empty_bucket()
    w_bucket = _empty_bucket()
    by_date = {}

    for r in rows:
        key = _PROCESS_KEY.get(r.process_type)
        if key is None:
            continue
        feet = r.feet or 0.0
        day_entry = by_date.setdefault(r.date, {"date": r.date, "tig_feet": 0.0, "mig_feet": 0.0, "grinding_feet": 0.0})
        day_entry[key] += feet

        if r.date == yesterday:
            y_bucket[key] += feet
            y_bucket["total_feet"] += feet
            y_bucket["entries"] += r.entries or 0
        if week_start <= r.date < today:
            w_bucket[key] += feet
            w_bucket["total_feet"] += feet
            w_bucket["entries"] += r.entries or 0

    for bucket in (y_bucket, w_bucket):
        for k in ("tig_feet", "mig_feet", "grinding_feet", "total_feet"):
            bucket[k] = round(bucket[k], 1)

    trend_14d = [{**by_date[d], "date": d.isoformat()} for d in sorted(by_date.keys())]

    return {"yesterday": y_bucket, "last_7d": w_bucket, "trend_14d": trend_14d}
```

- [ ] **Step 4: Run and verify it passes**

```bash
python test_briefing_service.py
```

Expected: `OK`

- [ ] **Step 5: Commit**

```bash
git add backend/services/briefing_service.py test_briefing_service.py
git commit -m "feat: add summarize_production for executive briefing feet aggregation"
```

- [ ] **Step 6: Write failing tests for `on_time_pct`**

Append to `test_briefing_service.py` (before the `if __name__` block):

```python
def test_on_time_pct_all_on_time():
    today = date(2026, 7, 27)
    projects = [
        SimpleNamespace(status="Active", committed_dispatch_date=today + timedelta(days=5)),
        SimpleNamespace(status="Completed", committed_dispatch_date=today - timedelta(days=5)),
    ]
    assert on_time_pct(projects, today) == 100


def test_on_time_pct_mixed():
    today = date(2026, 7, 27)
    projects = [
        SimpleNamespace(status="Active", committed_dispatch_date=today + timedelta(days=5)),
        SimpleNamespace(status="Active", committed_dispatch_date=today - timedelta(days=5)),
    ]
    assert on_time_pct(projects, today) == 50


def test_on_time_pct_no_active_projects_returns_100():
    assert on_time_pct([], date(2026, 7, 27)) == 100
```

And update the `if __name__ == "__main__":` block to also call these three, followed by `print("OK")`.

- [ ] **Step 7: Run and verify it fails**

```bash
python test_briefing_service.py
```

Expected: `AttributeError` / `NameError` — `on_time_pct` not defined.

- [ ] **Step 8: Implement `on_time_pct`**

Append to `backend/services/briefing_service.py`:

```python
def on_time_pct(projects, today):
    """
    projects: iterable of objects with .status and .committed_dispatch_date.
    Returns the rounded percentage of Active, dated projects whose
    committed_dispatch_date is today or later. 100 if there are none
    (nothing to be late on).
    """
    active_with_date = [p for p in projects if p.status == "Active" and p.committed_dispatch_date]
    if not active_with_date:
        return 100
    on_time = sum(1 for p in active_with_date if p.committed_dispatch_date >= today)
    return round(on_time / len(active_with_date) * 100)
```

- [ ] **Step 9: Run and verify it passes**

```bash
python test_briefing_service.py
```

Expected: `OK`

- [ ] **Step 10: Commit**

```bash
git add backend/services/briefing_service.py test_briefing_service.py
git commit -m "feat: add on_time_pct helper for executive briefing role KPIs"
```

- [ ] **Step 11: Write failing tests for `build_leaderboard`**

Append to `test_briefing_service.py`:

```python
def test_build_leaderboard_sorts_by_week_desc():
    users = {1: SimpleNamespace(full_name="Alice", role="Supervisor"), 2: SimpleNamespace(full_name="Bob", role="Supervisor")}
    result = build_leaderboard({1: 2}, {1: 10, 2: 15}, users)
    assert result[0]["full_name"] == "Bob"
    assert result[0]["entries_7d"] == 15
    assert result[1]["entries_yesterday"] == 2


def test_build_leaderboard_unknown_user_falls_back_to_id():
    result = build_leaderboard({}, {99: 5}, {})
    assert result[0]["full_name"] == "User #99"
    assert result[0]["role"] == "—"
```

Update the `__main__` block to call these too.

- [ ] **Step 12: Run and verify it fails, then implement**

```bash
python test_briefing_service.py
```

Expected: `NameError` — `build_leaderboard` not defined. Then append to `backend/services/briefing_service.py`:

```python
def build_leaderboard(yesterday_counts, week_counts, users_by_id):
    """
    yesterday_counts, week_counts: dict[int user_id, int count].
    users_by_id: dict[int user_id, object with .full_name and .role].
    Returns list sorted by entries_7d descending:
      {user_id, full_name, role, entries_yesterday, entries_7d}
    """
    all_ids = set(yesterday_counts) | set(week_counts)
    rows = []
    for uid in all_ids:
        u = users_by_id.get(uid)
        rows.append({
            "user_id": uid,
            "full_name": (u.full_name if u and u.full_name else f"User #{uid}"),
            "role": u.role if u else "—",
            "entries_yesterday": yesterday_counts.get(uid, 0),
            "entries_7d": week_counts.get(uid, 0),
        })
    rows.sort(key=lambda r: r["entries_7d"], reverse=True)
    return rows
```

- [ ] **Step 13: Run and verify it passes, then commit**

```bash
python test_briefing_service.py
```

Expected: `OK`

```bash
git add backend/services/briefing_service.py test_briefing_service.py
git commit -m "feat: add build_leaderboard helper for executive briefing entry counts"
```

- [ ] **Step 14: Write failing tests for `resolve_and_rank_activity`**

Append to `test_briefing_service.py`:

```python
def test_resolve_and_rank_activity_sorts_and_caps():
    users_by_id = {1: SimpleNamespace(full_name="Alice", role="Supervisor")}
    events = [
        {"timestamp": datetime(2026, 7, 27, 9, 0), "user_id": 1, "action": "Update", "detail": "d1", "project_ref": None},
        {"timestamp": datetime(2026, 7, 27, 10, 0), "user_id": 1, "action": "Update", "detail": "d2", "project_ref": None},
    ]
    result = resolve_and_rank_activity(events, users_by_id, {}, limit=1)
    assert len(result) == 1
    assert result[0]["detail"] == "d2"
    assert result[0]["actor_name"] == "Alice"


def test_resolve_and_rank_activity_falls_back_to_username():
    events = [{"timestamp": datetime(2026, 7, 27, 9, 0), "username": "pm_user", "action": "Completion requested", "detail": "d", "project_ref": "Q1"}]
    result = resolve_and_rank_activity(events, {}, {}, limit=10)
    assert result[0]["actor_name"] == "pm_user"
    assert result[0]["actor_role"] == "—"
```

Update the `__main__` block to call these too, keeping the final `print("OK")` last.

- [ ] **Step 15: Run and verify it fails, then implement**

```bash
python test_briefing_service.py
```

Expected: `NameError` — `resolve_and_rank_activity` not defined. Then append to `backend/services/briefing_service.py`:

```python
def resolve_and_rank_activity(raw_events, users_by_id, users_by_username, limit=50):
    """
    raw_events: list of dicts with 'timestamp' (datetime), 'action' (str),
      'detail' (str), 'project_ref' (str|None), and either 'user_id' (int|None)
      or 'username' (str|None) identifying the actor.
    users_by_id / users_by_username: dict of id/username -> object with
      .full_name and .role.
    Returns newest-first list capped at `limit`:
      {timestamp: iso str, actor_name, actor_role, action, detail, project_ref}
    """
    resolved = []
    for e in raw_events:
        user = None
        if e.get("user_id") is not None:
            user = users_by_id.get(e["user_id"])
        if user is None and e.get("username"):
            user = users_by_username.get(e["username"])
        actor_name = user.full_name if (user and user.full_name) else (e.get("username") or "Unknown")
        actor_role = user.role if user else "—"
        resolved.append({
            "timestamp": e["timestamp"],
            "actor_name": actor_name,
            "actor_role": actor_role,
            "action": e["action"],
            "detail": e["detail"],
            "project_ref": e.get("project_ref"),
        })
    resolved.sort(key=lambda r: r["timestamp"], reverse=True)
    top = resolved[:limit]
    for r in top:
        r["timestamp"] = r["timestamp"].isoformat()
    return top
```

- [ ] **Step 16: Run and verify it passes, then commit**

```bash
python test_briefing_service.py
```

Expected: `OK`

```bash
git add backend/services/briefing_service.py test_briefing_service.py
git commit -m "feat: add resolve_and_rank_activity helper for executive activity feed"
```

---

### Task 3: `GET /api/v1/dashboard/executive-briefing` endpoint

**Files:**
- Modify: `backend/app/dashboard/router.py` (append new endpoint after `executive_dashboard`, i.e. after line 211)

**Interfaces:**
- Consumes: `summarize_production`, `on_time_pct`, `build_leaderboard`, `resolve_and_rank_activity` from `backend.services.briefing_service` (Task 2). `Project.created_by` (Task 1).
- Produces: `GET /api/v1/dashboard/executive-briefing` returning the JSON shape consumed by the frontend in Task 5 — see spec §5.2 for the full shape; exact query code below.

- [ ] **Step 1: Add the endpoint**

Append to `backend/app/dashboard/router.py`, directly after the `executive_dashboard` function (after line 211):

```python
@router.get("/executive-briefing")
def executive_briefing(
    db: Session = Depends(get_db),
    user=Depends(require_roles(EXECUTIVES + ["Developer"])),
):
    from datetime import date as _date, timedelta
    from backend.services.db_service import (
        User, WeldingLog, WorkOrder, AuditLog, GoodsReceipt,
        ProjectHoldHistory, ProjectCompletionRequest,
    )
    from backend.services.briefing_service import (
        summarize_production, resolve_and_rank_activity, build_leaderboard, on_time_pct,
    )

    today = _date.today()
    window_start = today - timedelta(days=14)

    # --- production feet: one 14-day query, yesterday/7d derived in Python ---
    feet_rows = (
        db.query(
            WeldingLog.date.label("date"),
            WeldingLog.process_type.label("process_type"),
            sqlfunc.sum(WeldingLog.feet_done).label("feet"),
            sqlfunc.count(WeldingLog.id).label("entries"),
        )
        .filter(WeldingLog.date >= window_start, WeldingLog.date <= today)
        .group_by(WeldingLog.date, WeldingLog.process_type)
        .all()
    )
    production = summarize_production(feet_rows, today)

    # --- today's allotted work ---
    today_wo_rows = (
        db.query(WorkOrder, Project.quotation_no, Project.project_name)
        .join(Project, Project.id == WorkOrder.project_id)
        .filter(WorkOrder.date == today)
        .all()
    )
    today_allotted = [
        {
            "project_id": wo.project_id,
            "quotation_no": quotation_no,
            "project_name": project_name,
            "process_type": wo.process_type,
            "target_feet": wo.target_feet,
            "actual_feet": wo.actual_feet or 0.0,
            "pct": round((wo.actual_feet or 0.0) / wo.target_feet * 100) if wo.target_feet else 0,
            "status": wo.status,
        }
        for wo, quotation_no, project_name in today_wo_rows
    ]

    # --- activity feed: union of 5 sources, normalized then ranked ---
    raw_events = []

    audit_rows = (
        db.query(AuditLog)
        .filter(AuditLog.timestamp >= window_start)
        .order_by(AuditLog.timestamp.desc())
        .limit(200)
        .all()
    )
    for a in audit_rows:
        raw_events.append({
            "timestamp": a.timestamp, "user_id": a.user_id, "username": a.username,
            "action": a.action, "detail": a.details, "project_ref": None,
        })

    po_rows = (
        db.query(PurchaseOrder)
        .filter(PurchaseOrder.raised_by.isnot(None), PurchaseOrder.created_at >= window_start)
        .all()
    )
    for po in po_rows:
        raw_events.append({
            "timestamp": po.created_at, "user_id": po.raised_by, "username": None,
            "action": "PO raised", "detail": f"Raised PO {po.po_number}", "project_ref": None,
        })

    gr_rows = (
        db.query(GoodsReceipt)
        .filter(GoodsReceipt.received_by.isnot(None), GoodsReceipt.created_at >= window_start)
        .all()
    )
    for gr in gr_rows:
        raw_events.append({
            "timestamp": gr.created_at, "user_id": gr.received_by, "username": None,
            "action": "Goods receipt recorded", "detail": f"Recorded receipt for PO #{gr.purchase_order_id}", "project_ref": None,
        })

    completion_rows = (
        db.query(ProjectCompletionRequest, Project.quotation_no)
        .join(Project, Project.id == ProjectCompletionRequest.project_id)
        .filter(ProjectCompletionRequest.requested_at >= window_start)
        .all()
    )
    for req, quotation_no in completion_rows:
        raw_events.append({
            "timestamp": req.requested_at, "user_id": None, "username": req.requested_by,
            "action": "Completion requested", "detail": f"Submitted completion for {quotation_no}", "project_ref": quotation_no,
        })
        if req.reviewed_at and req.reviewed_by:
            detail = f"{req.status.capitalize()} completion for {quotation_no}"
            if req.rejection_reason:
                detail += f" — {req.rejection_reason}"
            raw_events.append({
                "timestamp": req.reviewed_at, "user_id": None, "username": req.reviewed_by,
                "action": f"Completion {req.status}", "detail": detail, "project_ref": quotation_no,
            })

    created_rows = (
        db.query(Project)
        .filter(Project.created_by.isnot(None), Project.created_at >= window_start)
        .all()
    )
    for p in created_rows:
        raw_events.append({
            "timestamp": p.created_at, "user_id": p.created_by, "username": None,
            "action": "Project created", "detail": f"Created project {p.quotation_no}", "project_ref": p.quotation_no,
        })

    event_user_ids = {e["user_id"] for e in raw_events if e.get("user_id")}
    event_usernames = {e["username"] for e in raw_events if e.get("username")}
    users_by_id = {u.id: u for u in db.query(User).filter(User.id.in_(event_user_ids)).all()} if event_user_ids else {}
    users_by_username = {u.username: u for u in db.query(User).filter(User.username.in_(event_usernames)).all()} if event_usernames else {}

    activity = resolve_and_rank_activity(raw_events, users_by_id, users_by_username, limit=50)

    # --- leaderboard: AuditLog entry counts per user ---
    yesterday = today - timedelta(days=1)
    week_start = today - timedelta(days=7)
    y_counts = dict(
        db.query(AuditLog.user_id, sqlfunc.count(AuditLog.id))
        .filter(sqlfunc.date(AuditLog.timestamp) == yesterday, AuditLog.user_id.isnot(None))
        .group_by(AuditLog.user_id).all()
    )
    w_counts = dict(
        db.query(AuditLog.user_id, sqlfunc.count(AuditLog.id))
        .filter(sqlfunc.date(AuditLog.timestamp) >= week_start, sqlfunc.date(AuditLog.timestamp) < today, AuditLog.user_id.isnot(None))
        .group_by(AuditLog.user_id).all()
    )
    leaderboard_ids = set(y_counts) | set(w_counts)
    leaderboard_users = {u.id: u for u in db.query(User).filter(User.id.in_(leaderboard_ids)).all()} if leaderboard_ids else {}
    leaderboard = build_leaderboard(y_counts, w_counts, leaderboard_users)

    # --- by_role rollups ---
    all_projects = db.query(Project).all()
    company_on_time_pct = on_time_pct(all_projects, today)

    pm_pos = db.query(PurchaseOrder).join(User, User.id == PurchaseOrder.raised_by).filter(User.role == "Production Manager").count()
    pm_grs = db.query(GoodsReceipt).join(User, User.id == GoodsReceipt.received_by).filter(User.role == "Production Manager").count()
    pm_completions = (
        db.query(ProjectCompletionRequest)
        .join(User, User.username == ProjectCompletionRequest.requested_by)
        .filter(User.role == "Production Manager")
        .count()
    )

    gm_approved = (
        db.query(ProjectCompletionRequest)
        .join(User, User.username == ProjectCompletionRequest.reviewed_by)
        .filter(User.role == "GM", ProjectCompletionRequest.status == "approved")
        .count()
    )
    gm_rejected = (
        db.query(ProjectCompletionRequest)
        .join(User, User.username == ProjectCompletionRequest.reviewed_by)
        .filter(User.role == "GM", ProjectCompletionRequest.status == "rejected")
        .count()
    )
    holds_total = db.query(ProjectHoldHistory).count()
    resumes_total = db.query(ProjectHoldHistory).filter(ProjectHoldHistory.resume_date.isnot(None)).count()

    return {
        "production": production,
        "today_allotted": today_allotted,
        "activity": activity,
        "people": {
            "leaderboard": leaderboard,
            "by_role": {
                "pm": {
                    "pos_raised": pm_pos,
                    "goods_receipts": pm_grs,
                    "completion_requests_submitted": pm_completions,
                    "projects_on_time_pct": company_on_time_pct,
                },
                "gm": {
                    "completions_approved": gm_approved,
                    "completions_rejected": gm_rejected,
                    "holds_total": holds_total,
                    "resumes_total": resumes_total,
                    "projects_on_time_pct": company_on_time_pct,
                },
            },
        },
    }
```

- [ ] **Step 2: Syntax check**

```bash
python -m py_compile backend/app/dashboard/router.py
```

Expected: no output (success).

- [ ] **Step 3: Manual verification against the real dev Postgres DB**

This endpoint runs many DB queries against real tables — following this codebase's existing precedent (`/executive`, `/planning`, `/wip` also have no automated tests), verify manually once the dev server is running (done together with Task 6's end-to-end check):

```bash
curl -s http://localhost:8003/api/v1/dashboard/executive-briefing -H "Authorization: Bearer $TOKEN" | python -m json.tool
```

Expected: valid JSON matching the shape above, no 500 error. Note this step here; actually run it in Task 6 once the frontend needs real data anyway.

- [ ] **Step 4: Commit**

```bash
git add backend/app/dashboard/router.py
git commit -m "feat: add GET /api/v1/dashboard/executive-briefing endpoint"
```

---

### Task 4: Frontend chart components (no new dependency)

**Files:**
- Create: `next-frontend/src/components/charts/BarChart.tsx`
- Create: `next-frontend/src/components/charts/Donut.tsx`

**Interfaces:**
- Produces: `HorizontalBarChart({ bars, maxValue?, valueFormat? })`, `StackedTrendChart({ days })` from `BarChart.tsx`; default-exported `Donut({ slices, size? })` from `Donut.tsx`. Consumed by Task 5.

- [ ] **Step 1: Create `BarChart.tsx`**

```tsx
type Bar = { label: string; value: number; color?: string };

export function HorizontalBarChart({
  bars,
  maxValue,
  valueFormat = (v: number) => String(v),
}: {
  bars: Bar[];
  maxValue?: number;
  valueFormat?: (v: number) => string;
}) {
  const max = maxValue ?? Math.max(1, ...bars.map((b) => b.value));
  return (
    <div className="flex flex-col gap-2">
      {bars.map((b) => (
        <div key={b.label} className="flex items-center gap-3">
          <span className="w-36 shrink-0 truncate text-sm text-ink-soft">{b.label}</span>
          <div className="h-3 flex-1 rounded-full bg-line">
            <div
              className="h-3 rounded-full transition-all duration-700"
              style={{
                width: `${Math.max(0, Math.min(100, (b.value / max) * 100))}%`,
                backgroundColor: b.color ?? "#3e7c77",
              }}
            />
          </div>
          <span className="w-16 shrink-0 text-right font-data text-xs tabular-nums text-ink">
            {valueFormat(b.value)}
          </span>
        </div>
      ))}
    </div>
  );
}

export interface StackedDay {
  date: string;
  tig_feet: number;
  mig_feet: number;
  grinding_feet: number;
}

const SERIES: { key: keyof Omit<StackedDay, "date">; label: string; color: string }[] = [
  { key: "tig_feet", label: "TIG", color: "#2a78d6" },
  { key: "mig_feet", label: "MIG", color: "#008300" },
  { key: "grinding_feet", label: "Grinding", color: "#eda100" },
];

export function StackedTrendChart({ days }: { days: StackedDay[] }) {
  const max = Math.max(1, ...days.map((d) => d.tig_feet + d.mig_feet + d.grinding_feet));
  return (
    <div>
      <div className="mb-3 flex gap-4 text-xs">
        {SERIES.map((s) => (
          <span key={s.key} className="flex items-center gap-1.5 text-ink-soft">
            <span className="h-2 w-2 rounded-full" style={{ backgroundColor: s.color }} />
            {s.label}
          </span>
        ))}
      </div>
      {days.length === 0 ? (
        <p className="text-sm text-ink-soft">No production data in this window.</p>
      ) : (
        <>
          <div className="flex h-40 items-end gap-1">
            {days.map((d) => {
              const total = d.tig_feet + d.mig_feet + d.grinding_feet;
              return (
                <div
                  key={d.date}
                  className="flex flex-1 flex-col justify-end"
                  title={`${d.date}: ${Math.round(total)} ft`}
                >
                  <div
                    className="flex flex-col-reverse overflow-hidden rounded-t"
                    style={{ height: `${(total / max) * 100}%`, minHeight: total > 0 ? "2px" : 0 }}
                  >
                    {SERIES.map((s) => {
                      const v = d[s.key];
                      if (!v) return null;
                      return (
                        <div
                          key={s.key}
                          style={{ height: total ? `${(v / total) * 100}%` : 0, backgroundColor: s.color }}
                          className="w-full"
                        />
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
          <div className="mt-1 flex justify-between text-[10px] text-ink-soft">
            <span>{days[0]?.date}</span>
            <span>{days[days.length - 1]?.date}</span>
          </div>
        </>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Create `Donut.tsx`**

```tsx
export interface DonutSlice {
  label: string;
  value: number;
  color: string;
}

export default function Donut({ slices, size = 140 }: { slices: DonutSlice[]; size?: number }) {
  const total = slices.reduce((s, x) => s + x.value, 0) || 1;
  const radius = size / 2;
  const stroke = size * 0.22;
  const r = radius - stroke / 2;
  const circumference = 2 * Math.PI * r;
  let offset = 0;

  return (
    <div className="flex items-center gap-4">
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        <circle cx={radius} cy={radius} r={r} fill="none" stroke="#dce3e0" strokeWidth={stroke} />
        {slices.map((s) => {
          const frac = s.value / total;
          const dash = frac * circumference;
          const circle = (
            <circle
              key={s.label}
              cx={radius}
              cy={radius}
              r={r}
              fill="none"
              stroke={s.color}
              strokeWidth={stroke}
              strokeDasharray={`${dash} ${circumference - dash}`}
              strokeDashoffset={-offset}
              transform={`rotate(-90 ${radius} ${radius})`}
            />
          );
          offset += dash;
          return circle;
        })}
      </svg>
      <ul className="flex flex-col gap-1.5 text-xs">
        {slices.map((s) => (
          <li key={s.label} className="flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-full" style={{ backgroundColor: s.color }} />
            <span className="text-ink-soft">{s.label}</span>
            <span className="font-data tabular-nums text-ink">{s.value}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
```

- [ ] **Step 3: Verify TypeScript compiles**

These components aren't imported anywhere yet, so `next build` wouldn't actually type-check them (Next only compiles what's reachable from a route). Run the TypeScript compiler directly instead — `tsconfig.json`'s `include: ["**/*.tsx", ...]` covers the whole `src/` tree regardless of imports:

```bash
npx --prefix next-frontend tsc --noEmit
```

Expected: no type errors.

- [ ] **Step 4: Commit**

```bash
git add next-frontend/src/components/charts/BarChart.tsx next-frontend/src/components/charts/Donut.tsx
git commit -m "feat: add hand-rolled BarChart and Donut components (no new dependency)"
```

---

### Task 5: Rebuild `dashboard/executive/page.tsx` as a 3-tab page

**Files:**
- Modify: `next-frontend/src/app/(main)/dashboard/executive/page.tsx` (full rewrite)

**Interfaces:**
- Consumes: `GET /api/v1/dashboard/executive` (existing, unchanged), `GET /api/v1/dashboard/executive-briefing` (Task 3), `GET /api/v1/scheduler/productivity?from_date=&to_date=` (existing, unchanged — response shape `{user_id, worker_name, process_type, target_feet, actual_feet, efficiency_pct, days_worked}[]`), `HorizontalBarChart`/`StackedTrendChart` (Task 4), `Donut` (Task 4).

- [ ] **Step 1: Replace the full file**

Replace the entire contents of `next-frontend/src/app/(main)/dashboard/executive/page.tsx` with:

```tsx
"use client";
import { apiFetch } from "@/lib/api";
import { useState, useEffect } from "react";
import { MetricCard, ProgressBar, Badge, Spinner, Table, THead, TBody, Tr, Th, Td } from "@/components/ui";
import MailButton from "@/components/MailButton";
import Donut from "@/components/charts/Donut";
import { HorizontalBarChart, StackedTrendChart } from "@/components/charts/BarChart";

const API = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8003";

interface Kpis {
  total_active: number;
  total_on_hold: number;
  total_completed: number;
  pipeline_value: number;
  on_time: number;
  delayed: number;
}

interface ProjectRow {
  id: number;
  quotation_no: string;
  project_name: string | null;
  client_name: string | null;
  status: string;
  order_value: number | null;
  advance_received: number | null;
  committed_dispatch_date: string | null;
  target_date: string | null;
  progress_pct: number;
  completion_request_status: string | null;
}

interface ProductionBucket {
  tig_feet: number;
  mig_feet: number;
  grinding_feet: number;
  total_feet: number;
  entries: number;
}

interface TrendDay {
  date: string;
  tig_feet: number;
  mig_feet: number;
  grinding_feet: number;
}

interface TodayAllotted {
  project_id: number;
  quotation_no: string;
  project_name: string | null;
  process_type: string;
  target_feet: number;
  actual_feet: number;
  pct: number;
  status: string;
}

interface ActivityItem {
  timestamp: string;
  actor_name: string;
  actor_role: string;
  action: string;
  detail: string;
  project_ref: string | null;
}

interface LeaderboardRow {
  user_id: number;
  full_name: string;
  role: string;
  entries_yesterday: number;
  entries_7d: number;
}

interface RoleKpis {
  pm: {
    pos_raised: number;
    goods_receipts: number;
    completion_requests_submitted: number;
    projects_on_time_pct: number;
  };
  gm: {
    completions_approved: number;
    completions_rejected: number;
    holds_total: number;
    resumes_total: number;
    projects_on_time_pct: number;
  };
}

interface Briefing {
  production: { yesterday: ProductionBucket; last_7d: ProductionBucket; trend_14d: TrendDay[] };
  today_allotted: TodayAllotted[];
  activity: ActivityItem[];
  people: { leaderboard: LeaderboardRow[]; by_role: RoleKpis };
}

interface ProductivityRow {
  user_id: number;
  worker_name: string;
  process_type: string;
  target_feet: number;
  actual_feet: number;
  efficiency_pct: number;
  days_worked: number;
}

function fmt(n: number | null): string {
  if (n == null) return "—";
  return "₹" + n.toLocaleString("en-IN");
}

// ponytail: static lookup — no runtime Tailwind interpolation
const BADGE_TONE: Record<string, "success" | "warning" | "critical" | "neutral"> = {
  Completed: "success",
  Hold: "warning",
  Delayed: "critical",
  Active: "neutral",
};

const STATUS_DONUT_COLOR: Record<string, string> = {
  Active: "#5c6864",
  Delayed: "#b2594a",
  Hold: "#bd8a52",
  Completed: "#5c8a6c",
};

const PROGRESS_TONE: (pct: number) => "success" | "warning" | "critical" = (pct) =>
  pct >= 80 ? "success" : pct >= 40 ? "warning" : "critical";

const TABS = ["briefing", "people", "projects"] as const;
type Tab = (typeof TABS)[number];
const TAB_LABELS: Record<Tab, string> = {
  briefing: "📋 Briefing",
  people: "👥 People & KPIs",
  projects: "📊 Projects",
};

function toISODate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export default function ExecutiveDashboard() {
  const [tab, setTab] = useState<Tab>("briefing");
  const [kpis, setKpis] = useState<Kpis | null>(null);
  const [projects, setProjects] = useState<ProjectRow[]>([]);
  const [briefing, setBriefing] = useState<Briefing | null>(null);
  const [productivity, setProductivity] = useState<ProductivityRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<"all" | "active" | "delayed" | "completed">("all");

  useEffect(() => {
    const today = new Date();
    const weekAgo = new Date(today);
    weekAgo.setDate(weekAgo.getDate() - 7);

    Promise.all([
      apiFetch(`${API}/api/v1/dashboard/executive`).then((r) => r.json()),
      apiFetch(`${API}/api/v1/dashboard/executive-briefing`).then((r) => r.json()),
      apiFetch(
        `${API}/api/v1/scheduler/productivity?from_date=${toISODate(weekAgo)}&to_date=${toISODate(today)}`
      ).then((r) => r.json()),
    ])
      .then(([execData, briefingData, productivityData]) => {
        setKpis(execData.kpis);
        setProjects(execData.projects);
        setBriefing(briefingData);
        setProductivity(productivityData);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  if (loading) return <Spinner label="Loading executive view…" />;
  if (!kpis || !briefing) return <p className="text-ink-soft text-sm">Failed to load data.</p>;

  const today = new Date();

  const filtered = projects.filter((p) => {
    const isDelayed =
      p.status === "Active" && p.committed_dispatch_date && new Date(p.committed_dispatch_date) < today;
    if (filter === "active") return p.status === "Active";
    if (filter === "delayed") return Boolean(isDelayed);
    if (filter === "completed") return p.status === "Completed";
    return true;
  });

  const FILTER_LABELS: Record<string, string> = {
    all: `All (${projects.length})`,
    active: `Active (${kpis.total_active})`,
    delayed: `Delayed (${kpis.delayed})`,
    completed: `Completed (${kpis.total_completed})`,
  };

  const statusSlices = [
    { label: "Active", value: kpis.total_active - kpis.delayed, color: STATUS_DONUT_COLOR.Active },
    { label: "Delayed", value: kpis.delayed, color: STATUS_DONUT_COLOR.Delayed },
    { label: "Hold", value: kpis.total_on_hold, color: STATUS_DONUT_COLOR.Hold },
    { label: "Completed", value: kpis.total_completed, color: STATUS_DONUT_COLOR.Completed },
  ].filter((s) => s.value > 0);

  const processSlices = [
    { label: "TIG", value: briefing.production.last_7d.tig_feet, color: "#2a78d6" },
    { label: "MIG", value: briefing.production.last_7d.mig_feet, color: "#008300" },
    { label: "Grinding", value: briefing.production.last_7d.grinding_feet, color: "#eda100" },
  ].filter((s) => s.value > 0);

  return (
    <div className="flex flex-col gap-8">
      <div>
        <h1 className="font-display text-3xl font-extrabold uppercase tracking-wide text-ink">
          Executive Dashboard
        </h1>
        <p className="text-ink-soft">
          Good morning — {today.toLocaleDateString("en-IN", { weekday: "long", day: "numeric", month: "long" })}
        </p>
      </div>

      <div className="flex gap-2 border-b border-line">
        {TABS.map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={
              tab === t
                ? "border-b-2 border-brand px-4 py-2 text-sm font-semibold text-brand"
                : "border-b-2 border-transparent px-4 py-2 text-sm font-semibold text-ink-soft hover:text-ink"
            }
          >
            {TAB_LABELS[t]}
          </button>
        ))}
      </div>

      {tab === "briefing" && (
        <div className="flex flex-col gap-8">
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            <MetricCard label="Feet Yesterday" value={Math.round(briefing.production.yesterday.total_feet)} tone="neutral" />
            <MetricCard label="Feet Last 7 Days" value={Math.round(briefing.production.last_7d.total_feet)} tone="neutral" />
            <MetricCard label="Entries Yesterday" value={briefing.production.yesterday.entries} tone="neutral" />
            <MetricCard
              label="Today's Target Feet"
              value={Math.round(briefing.today_allotted.reduce((s, w) => s + w.target_feet, 0))}
              tone="neutral"
            />
          </div>

          <div>
            <h2 className="mb-3 font-display text-lg font-bold uppercase tracking-wide text-ink">
              Today&apos;s Allotted Work
            </h2>
            <Table>
              <THead>
                <Tr>
                  <Th>Project</Th>
                  <Th>Process</Th>
                  <Th numeric>Target Feet</Th>
                  <Th numeric>Actual Feet</Th>
                  <Th numeric>Progress</Th>
                  <Th>Status</Th>
                </Tr>
              </THead>
              <TBody>
                {briefing.today_allotted.length === 0 && (
                  <Tr>
                    <Td colSpan={6}>
                      <p className="py-4 text-center text-sm text-ink-soft">No work orders scheduled today.</p>
                    </Td>
                  </Tr>
                )}
                {briefing.today_allotted.map((w, i) => (
                  <Tr key={i}>
                    <Td>{w.quotation_no}</Td>
                    <Td>{w.process_type}</Td>
                    <Td numeric>{w.target_feet}</Td>
                    <Td numeric>{w.actual_feet}</Td>
                    <Td numeric>{w.pct}%</Td>
                    <Td>
                      <Badge tone={w.status === "Completed" ? "success" : w.status === "Blocked" ? "critical" : "neutral"}>
                        {w.status}
                      </Badge>
                    </Td>
                  </Tr>
                ))}
              </TBody>
            </Table>
          </div>

          <div className="grid grid-cols-1 gap-8 lg:grid-cols-2">
            <div>
              <h2 className="mb-3 font-display text-lg font-bold uppercase tracking-wide text-ink">
                14-Day Production Trend
              </h2>
              <StackedTrendChart days={briefing.production.trend_14d} />
            </div>
            <div>
              <h2 className="mb-3 font-display text-lg font-bold uppercase tracking-wide text-ink">
                Process Split (7d)
              </h2>
              {processSlices.length > 0 ? (
                <Donut slices={processSlices} />
              ) : (
                <p className="text-sm text-ink-soft">No production logged in the last 7 days.</p>
              )}
            </div>
          </div>

          <div>
            <h2 className="mb-3 font-display text-lg font-bold uppercase tracking-wide text-ink">Activity Feed</h2>
            <div className="flex flex-col divide-y divide-line">
              {briefing.activity.length === 0 && <p className="py-4 text-sm text-ink-soft">No recent activity.</p>}
              {briefing.activity.map((a, i) => (
                <div key={i} className="flex items-start justify-between gap-4 py-2.5">
                  <div>
                    <span className="font-semibold text-ink">{a.actor_name}</span>
                    <span className="ml-1.5 text-xs uppercase tracking-wide text-ink-soft">{a.actor_role}</span>
                    <p className="text-sm text-ink-soft">{a.detail}</p>
                  </div>
                  <span className="shrink-0 whitespace-nowrap text-xs text-ink-soft">
                    {new Date(a.timestamp).toLocaleString("en-IN", {
                      day: "numeric",
                      month: "short",
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {tab === "people" && (
        <div className="flex flex-col gap-8">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="rounded-xl border border-line bg-paper-raised p-5">
              <h3 className="mb-3 font-display text-sm font-bold uppercase tracking-wide text-ink-soft">
                Production Manager
              </h3>
              <div className="grid grid-cols-2 gap-3 text-sm">
                <span className="text-ink-soft">POs Raised</span>
                <span className="text-right font-data tabular-nums text-ink">{briefing.people.by_role.pm.pos_raised}</span>
                <span className="text-ink-soft">Goods Receipts</span>
                <span className="text-right font-data tabular-nums text-ink">{briefing.people.by_role.pm.goods_receipts}</span>
                <span className="text-ink-soft">Completions Submitted</span>
                <span className="text-right font-data tabular-nums text-ink">
                  {briefing.people.by_role.pm.completion_requests_submitted}
                </span>
                <span className="text-ink-soft">Projects On-Time %</span>
                <span className="text-right font-data tabular-nums text-ink">{briefing.people.by_role.pm.projects_on_time_pct}%</span>
              </div>
            </div>
            <div className="rounded-xl border border-line bg-paper-raised p-5">
              <h3 className="mb-3 font-display text-sm font-bold uppercase tracking-wide text-ink-soft">GM (SJM)</h3>
              <div className="grid grid-cols-2 gap-3 text-sm">
                <span className="text-ink-soft">Completions Approved</span>
                <span className="text-right font-data tabular-nums text-ink">{briefing.people.by_role.gm.completions_approved}</span>
                <span className="text-ink-soft">Completions Rejected</span>
                <span className="text-right font-data tabular-nums text-ink">{briefing.people.by_role.gm.completions_rejected}</span>
                <span className="text-ink-soft">Projects Held / Resumed</span>
                <span className="text-right font-data tabular-nums text-ink">
                  {briefing.people.by_role.gm.holds_total} / {briefing.people.by_role.gm.resumes_total}
                </span>
                <span className="text-ink-soft">Projects On-Time %</span>
                <span className="text-right font-data tabular-nums text-ink">{briefing.people.by_role.gm.projects_on_time_pct}%</span>
              </div>
            </div>
          </div>

          <div>
            <h2 className="mb-3 font-display text-lg font-bold uppercase tracking-wide text-ink">
              Entry Leaderboard (Last 7 Days)
            </h2>
            {briefing.people.leaderboard.length > 0 ? (
              <HorizontalBarChart
                bars={briefing.people.leaderboard.slice(0, 10).map((r) => ({ label: r.full_name, value: r.entries_7d }))}
              />
            ) : (
              <p className="text-sm text-ink-soft">No entries logged in the last 7 days.</p>
            )}
          </div>

          <div>
            <h2 className="mb-3 font-display text-lg font-bold uppercase tracking-wide text-ink">
              Worker Efficiency (Last 7 Days)
            </h2>
            {productivity.length > 0 ? (
              <HorizontalBarChart
                bars={productivity
                  .slice()
                  .sort((a, b) => b.efficiency_pct - a.efficiency_pct)
                  .map((r) => ({
                    label: `${r.worker_name} (${r.process_type})`,
                    value: r.efficiency_pct,
                    color: r.efficiency_pct >= 80 ? "#5c8a6c" : r.efficiency_pct >= 40 ? "#bd8a52" : "#b2594a",
                  }))}
                maxValue={100}
                valueFormat={(v) => `${Math.round(v)}%`}
              />
            ) : (
              <p className="text-sm text-ink-soft">No productivity data for the last 7 days.</p>
            )}
          </div>
        </div>
      )}

      {tab === "projects" && (
        <div className="flex flex-col gap-8">
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6">
            <MetricCard label="Active Projects" value={String(kpis.total_active)} tone="neutral" />
            <MetricCard label="Pipeline Value" value={fmt(kpis.pipeline_value)} tone="neutral" />
            <MetricCard label="On Time" value={String(kpis.on_time)} tone="success" />
            <MetricCard label="Delayed" value={String(kpis.delayed)} tone="critical" />
            <MetricCard label="On Hold" value={String(kpis.total_on_hold)} tone="warning" />
            <MetricCard label="Completed" value={String(kpis.total_completed)} tone="neutral" />
          </div>

          <div className="max-w-xs">
            <Donut slices={statusSlices} size={120} />
          </div>

          <div className="flex gap-2 flex-wrap">
            {(["all", "active", "delayed", "completed"] as const).map((f) => (
              <button
                key={f}
                onClick={() => setFilter(f)}
                className={
                  filter === f
                    ? "rounded-full border border-brand bg-brand/10 px-3 py-1 text-xs font-semibold capitalize text-brand transition-colors"
                    : "rounded-full border border-line bg-paper-raised px-3 py-1 text-xs font-semibold capitalize text-ink-soft transition-colors hover:text-ink"
                }
              >
                {FILTER_LABELS[f]}
              </button>
            ))}
          </div>

          <Table>
            <THead>
              <Tr>
                <Th>Quotation</Th>
                <Th>Project</Th>
                <Th>Client</Th>
                <Th>Status</Th>
                <Th numeric>Order Value</Th>
                <Th numeric>Advance</Th>
                <Th>Dispatch Date</Th>
                <Th numeric>Progress</Th>
                <Th>Mail</Th>
              </Tr>
            </THead>
            <TBody>
              {filtered.length === 0 && (
                <Tr>
                  <Td colSpan={9}>
                    <p className="py-4 text-center text-sm text-ink-soft">No projects found.</p>
                  </Td>
                </Tr>
              )}
              {filtered.map((p) => {
                const isDelayed =
                  p.status === "Active" &&
                  p.committed_dispatch_date &&
                  new Date(p.committed_dispatch_date) < today;

                const displayStatus = p.status === "Active" && isDelayed ? "Delayed" : p.status;
                const badgeTone = BADGE_TONE[displayStatus] ?? "neutral";

                return (
                  <Tr key={p.id}>
                    <Td>
                      <span className="font-mono text-xs">{p.quotation_no}</span>
                    </Td>
                    <Td>{p.project_name || "—"}</Td>
                    <Td>{p.client_name || "—"}</Td>
                    <Td>
                      <Badge tone={badgeTone}>{displayStatus}</Badge>
                    </Td>
                    <Td numeric>{fmt(p.order_value)}</Td>
                    <Td numeric>{p.advance_received != null ? `${p.advance_received}%` : "—"}</Td>
                    <Td>
                      {p.committed_dispatch_date ? (
                        <span className={isDelayed ? "font-medium text-rose-600" : ""}>
                          {new Date(p.committed_dispatch_date).toLocaleDateString("en-IN")}
                        </span>
                      ) : (
                        "—"
                      )}
                    </Td>
                    <Td numeric>
                      <div className="flex items-center gap-2">
                        <div className="w-20">
                          <ProgressBar
                            label=""
                            showLabel={false}
                            percent={p.progress_pct}
                            tone={PROGRESS_TONE(p.progress_pct)}
                          />
                        </div>
                        <span className="w-8 text-right text-xs text-ink-soft">{p.progress_pct}%</span>
                      </div>
                    </Td>
                    <Td>
                      <MailButton
                        projectContext={{
                          quotation_no: p.quotation_no,
                          project_name: p.project_name || "",
                          client_name: p.client_name,
                          status: p.status,
                          target_date: p.target_date,
                        }}
                      />
                    </Td>
                  </Tr>
                );
              })}
            </TBody>
          </Table>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Build and typecheck**

```bash
npm --prefix next-frontend run build
```

Expected: build succeeds, 0 TS errors (same route count as before, this is the same route).

- [ ] **Step 3: Lint**

```bash
npm --prefix next-frontend run lint
```

Expected: no new lint errors.

- [ ] **Step 4: Commit**

```bash
git add "next-frontend/src/app/(main)/dashboard/executive/page.tsx"
git commit -m "feat: rebuild executive dashboard as 3-tab morning briefing (Briefing/People/Projects)"
```

---

### Task 6: End-to-end manual verification + progress log

**Files:**
- Modify: `projectprogress.md` (append session entry)
- Modify: `problemsresolved.md` (append entry if any non-trivial problem was solved during implementation, per project convention)

**Interfaces:** None — this task only verifies and documents.

- [ ] **Step 1: Start the backend against the real dev Postgres DB**

```bash
python -m uvicorn backend.main:app --port 8003 --reload
```

Expected: server starts, `init_db()` runs the new `ALTER TABLE projects ADD COLUMN created_by INTEGER;` without error (idempotent — harmless if it already ran).

- [ ] **Step 2: Start the frontend**

```bash
npm --prefix next-frontend run dev
```

- [ ] **Step 3: Manual browser walkthrough**

Log in as CEO or MD (env-var login per `projectprogress.md` Session 29/30 — `CEO_USER`/`CEO_PASS` or `MD_USER`/`MD_PASS`), navigate to `/dashboard/executive`, and verify:
- **Briefing tab**: KPI strip loads, today's allotted work table shows current work orders (or the empty state), the 14-day trend bar chart and process-split donut render without console errors, activity feed shows recent entries with actor name/role (or "No recent activity" if the DB is fresh).
- **People & KPIs tab**: PM and GM KPI cards render, entry leaderboard and worker efficiency bars render (or their empty states).
- **Projects tab**: identical to the old page's content (6 KPIs, status donut, filter chips, project table with MailButton) — confirm nothing regressed from before this change.
- Create a test project, log a welding entry as a Supervisor, and confirm both appear in the Briefing tab's activity feed and leaderboard after a refresh (validates Task 1's `created_by` and Task 3's endpoint end-to-end against real data).

- [ ] **Step 4: Update `projectprogress.md`**

Append a new dated session section (per `CLAUDE.md` rule: read at start, update at end of every session) summarizing: what was built (3-tab executive briefing, new endpoint, chart components, `created_by` migration), what was verified, and any issues hit during manual testing.

- [ ] **Step 5: Update `problemsresolved.md`**

If any non-trivial problem came up during implementation (e.g. a query bug found during manual verification), append it here in the same commit as the progress log update, per this repo's established convention.

- [ ] **Step 6: Commit and push to `demo`**

```bash
git add projectprogress.md problemsresolved.md
git commit -m "docs: update projectprogress for executive morning briefing session"
git push origin demo
```

Per `CLAUDE.md`: push to `demo` only, do not merge to `main` without explicit user approval after they verify on the Railway demo deployment.

---

## Spec coverage check

- Problem statement (§1) → Tasks 5, 6 (tab restructure preserves existing content).
- Data reality / SJM=GM / worker attribution (§2) → reflected in Global Constraints and Task 3's GM/PM queries.
- 3-tab structure (§3) → Task 5.
- Per-role KPI definitions (§4) → Task 3 (`by_role` in the endpoint) + Task 5 (People tab) + reused `/scheduler/productivity` for Worker.
- `Project.created_by` migration (§5.1) → Task 1.
- `GET /executive-briefing` shape (§5.2) → Task 3.
- Reused endpoints (§5.3) → Task 5 (both fetched as-is).
- Frontend changes (§6) → Tasks 4, 5.
- Error handling (§7) → empty-array/zero defaults built into Task 3's queries and Task 5's empty-state JSX; feed capped at 50 in `resolve_and_rank_activity`.
- Testing (§8) → Task 2 (pure-function unit tests), Task 6 (manual verification, matching existing precedent for DB-heavy endpoints).
- Out of scope (§9) → not built: drill-down pages, feed pagination, backfilling `created_by`, new SJM role.
