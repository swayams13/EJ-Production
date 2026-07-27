# Briefing v2 — Material Risk Digest + Daily Email Digest Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Surface material-shortage risk on the executive Briefing tab, and email a condensed version of the same briefing to CEO/MD every morning via a Railway Cron Job.

**Architecture:** Extract the already-working materials RAG computation and the executive-briefing orchestration into reusable functions (no duplicated business logic), add two new pure/testable formatting functions, wire one new response field into the existing `/executive-briefing` endpoint, add one small UI section, and add one thin standalone script that the Railway Cron Job runs.

**Tech Stack:** FastAPI + SQLAlchemy (Python), Next.js/TSX frontend, existing Brevo email HTTP API. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-07-27-briefing-v2-material-risk-and-email-digest-design.md`

## Global Constraints

- PostgreSQL only — no SQLite, no new DB engine.
- No new Python packages. If one becomes unavoidable, it goes in the **root** `requirements.txt`, not `backend/requirements.txt`.
- Commit and push to the `demo` branch only. Never merge to `main` without explicit user approval.
- Update `projectprogress.md` and `problemsresolved.md` at the end of the session (last task in this plan).
- Frontend: reuse existing components from `next-frontend/src/components/ui/` (`MetricCard`, `Badge`) — never interpolate Tailwind class names at runtime (`docs/UI_DESIGN_SYSTEM.md`).
- This repo has no pytest/test framework — tests are plain `assert`-based functions run via `python test_briefing_service.py`, with each new test function also added to the `if __name__ == "__main__":` block at the bottom of that file.
- No automated API-level tests exist anywhere in this repo — endpoint changes are verified manually via `curl` against a locally running `uvicorn` instance, matching how every prior session in `problemsresolved.md` verified backend changes.

## Deviation from the spec (found during planning, not a behavior change)

The spec suggested putting the new `get_executive_briefing_data` function in `backend/services/briefing_service.py`. Tracing the actual code: `executive_briefing()`'s body uses SQLAlchemy models (`WeldingLog`, `WorkOrder`, `AuditLog`, `GoodsReceipt`, `ProjectHoldHistory`, `ProjectCompletionRequest`, `User`) that are only ever imported locally inside that function, inside `backend/app/dashboard/router.py`. The materials RAG computation (`_compute_material_rows`, needed by the new `materials` field) also only exists in that same file, using its own set of models (`WarehouseStock`, `PurchaseOrder`, `PurchaseOrderLine`, `Part`, `PartProcess`) plus the `MaterialRow`/`MaterialProjectItem` pydantic response models defined there.

Moving `get_executive_briefing_data` into `briefing_service.py` would require `briefing_service.py` (a service-layer module) to import from `backend/app/dashboard/router.py` (an app/route module) — backwards from how every other file in this codebase is layered (routers import from services, never the reverse). Keeping both `_compute_material_rows` and `get_executive_briefing_data` in `router.py` avoids that inversion entirely and requires zero import changes, since all their dependencies are already local to that file. Only the two genuinely new **pure, side-effect-free** formatting functions (`summarize_material_risk`, `format_briefing_email`) go into `briefing_service.py`, matching its existing role as the home for small testable aggregation functions (`summarize_production`, `build_leaderboard`, etc.) that take plain data in and return plain data out.

The standalone cron script imports `get_executive_briefing_data` and `_compute_material_rows`-derived data straight from `backend.app.dashboard.router` — this is fine; it's a plain importable module, and `scripts/sync_employees_to_users.py` / `scripts/import_employees.py` already establish the pattern of standalone scripts importing directly from `backend.services.db_service`.

---

## Part 1 — Material Risk Digest

### Task 1: Extract `_compute_material_rows` from `get_materials_dashboard`

**Files:**
- Modify: `backend/app/dashboard/router.py:646-807`

**Interfaces:**
- Produces: `_compute_material_rows(db: Session) -> List[MaterialRow]` — pure computation, no side effects (no notification writes). Used by Task 3 (`executive_briefing`) and unchanged by `get_materials_dashboard`.

This is a pure refactor — the notification side-effect block (currently lines 782-805) must stay in `get_materials_dashboard`, NOT move into the extracted function, so calling `_compute_material_rows` from the briefing endpoint never creates duplicate GM/PM notifications or runs the notification-dedup query needlessly.

- [ ] **Step 1: Replace the `get_materials_dashboard` function body**

Find this in `backend/app/dashboard/router.py` (currently lines 646-807):

```python
@router.get("/materials", response_model=List[MaterialRow])
def get_materials_dashboard(
    db: Session = Depends(get_db),
    current_user: dict = Depends(require_roles(SUPERVISORS)),
):
    # Pre-fetch A: all warehouse stock rows
    stock_rows = db.query(WarehouseStock).all()
    stock_map: dict = {(r.material_name, r.size, r.joint_type): r for r in stock_rows}

    # Pre-fetch B: open PO lines (status not received/cancelled)
    open_lines = (
        db.query(PurchaseOrderLine, PurchaseOrder.expected_delivery_date)
        .join(PurchaseOrder, PurchaseOrderLine.purchase_order_id == PurchaseOrder.id)
        .filter(PurchaseOrder.status.notin_(["received", "cancelled"]))
        .all()
    )
    # {spec -> {incoming_qty, expected_delivery_date}}
    po_map: dict = {}
    for line, po_edd in open_lines:
        remaining = (line.ordered_qty or 0) - (line.received_qty or 0)
        if remaining <= 0:
            continue
        key = (line.material_name, line.size, line.joint_type)
        if key not in po_map:
            po_map[key] = {"incoming_qty": 0, "expected_delivery_date": None}
        po_map[key]["incoming_qty"] += remaining
        if po_edd is not None:
            cur = po_map[key]["expected_delivery_date"]
            if cur is None or po_edd < cur:
                po_map[key]["expected_delivery_date"] = po_edd

    # Pre-fetch C: parts from active projects, with their processes and parent line/project
    # Single query: Part JOIN ProjectProductionLine JOIN Project + all PartProcesses bulk-loaded
    from sqlalchemy.orm import selectinload

    active_project_ids = [
        row[0]
        for row in db.query(Project.id).filter(Project.status != "Completed").all()
    ]

    if active_project_ids:
        parts_with_line = (
            db.query(Part, ProjectProductionLine, Project)
            .join(ProjectProductionLine, Part.production_line_id == ProjectProductionLine.id)
            .join(Project, ProjectProductionLine.project_id == Project.id)
            .filter(Project.id.in_(active_project_ids))
            .all()
        )

        # Bulk-fetch all PartProcess rows for these parts in one query
        part_ids = [p.id for p, _, _ in parts_with_line]
        all_processes = db.query(PartProcess).filter(PartProcess.part_id.in_(part_ids)).all()
        procs_by_part: dict = {}
        for proc in all_processes:
            procs_by_part.setdefault(proc.part_id, []).append(proc)
    else:
        parts_with_line = []
        procs_by_part = {}

    # {spec -> {total_demand, projects: [{id, name, qty_needed, delivery_date}]}}
    demand_map: dict = {}
    for part, line, project in parts_with_line:
        processes = procs_by_part.get(part.id, [])
        mr_proc = next((p for p in processes if p.process_name == "Material Received"), None)
        unmet_qty = (part.total_qty or 0) - (mr_proc.completed_qty if mr_proc else 0)
        if unmet_qty <= 0:
            continue
        key = (part.name, line.size, line.joint_type)
        if key not in demand_map:
            demand_map[key] = {"total_demand": 0, "projects": []}
        demand_map[key]["total_demand"] += unmet_qty
        demand_map[key]["projects"].append({
            "id": project.id,
            "name": project.project_name or project.quotation_no,
            "qty_needed": unmet_qty,
            "delivery_date": project.target_date.isoformat() if project.target_date else None,
        })

    # Union all specs and compute coverage
    all_specs = set(stock_map) | set(po_map) | set(demand_map)

    rows: List[MaterialRow] = []
    for spec in all_specs:
        material_name, size, joint_type = spec
        stock = stock_map.get(spec)
        qty_on_hand = stock.qty_on_hand if stock else 0
        reserved_qty = stock.reserved_qty if stock else 0
        minimum_stock = stock.minimum_stock if stock else 0

        po_entry = po_map.get(spec, {})
        incoming_qty = po_entry.get("incoming_qty", 0)
        edd = po_entry.get("expected_delivery_date")

        dem_entry = demand_map.get(spec, {})
        total_demand = dem_entry.get("total_demand", 0)
        projects_raw = dem_entry.get("projects", [])

        # Only include specs that have some demand (specs with only stock/PO but no demand are noise)
        if total_demand == 0:
            continue

        available_stock = qty_on_hand - reserved_qty
        net_gap = total_demand - available_stock - incoming_qty

        if net_gap > 0:
            status = "red"
        elif available_stock < minimum_stock:
            status = "amber"
        else:
            status = "green"

        # Sort projects by delivery_date ascending (None last)
        projects_sorted = sorted(
            projects_raw,
            key=lambda p: (p["delivery_date"] is None, p["delivery_date"] or ""),
        )

        rows.append(MaterialRow(
            material_name=material_name,
            size=size,
            joint_type=joint_type,
            qty_on_hand=qty_on_hand,
            reserved_qty=reserved_qty,
            minimum_stock=minimum_stock,
            incoming_qty=incoming_qty,
            expected_delivery_date=edd.isoformat() if edd else None,
            total_demand=total_demand,
            net_gap=net_gap,
            status=status,
            projects=[MaterialProjectItem(**p) for p in projects_sorted],
        ))

    # Sort: red (highest net_gap first) → amber → green
    _order = {"red": 0, "amber": 1, "green": 2}
    rows.sort(key=lambda r: (_order[r.status], -r.net_gap))

    from datetime import timedelta
    from backend.services.db_service import Notification as NotifModel
    red_specs = [r for r in rows if r.status == "red"]
    if red_specs:
        cutoff = datetime.utcnow() - timedelta(hours=24)
        for spec in red_specs[:5]:
            spec_key = f"{spec.material_name}/{spec.size}/{spec.joint_type}"
            already = (
                db.query(NotifModel)
                .filter(
                    NotifModel.event_type == "material_red",
                    NotifModel.body.like(f"%{spec_key}%"),
                    NotifModel.created_at > cutoff,
                )
                .first()
            )
            if not already:
                for role in ["GM", "Production Manager"]:
                    create_notification(
                        db, role, "material_red",
                        f"Material shortage: {spec.material_name} {spec.size}",
                        f"Stock gap for {spec_key}. Net gap: {spec.net_gap} units.",
                        "/dashboard/materials",
                    )

    return rows
```

Replace it with this (identical logic, split into a pure computation function plus a thin route that keeps the notification side effect):

```python
def _compute_material_rows(db: Session) -> List[MaterialRow]:
    # Pre-fetch A: all warehouse stock rows
    stock_rows = db.query(WarehouseStock).all()
    stock_map: dict = {(r.material_name, r.size, r.joint_type): r for r in stock_rows}

    # Pre-fetch B: open PO lines (status not received/cancelled)
    open_lines = (
        db.query(PurchaseOrderLine, PurchaseOrder.expected_delivery_date)
        .join(PurchaseOrder, PurchaseOrderLine.purchase_order_id == PurchaseOrder.id)
        .filter(PurchaseOrder.status.notin_(["received", "cancelled"]))
        .all()
    )
    # {spec -> {incoming_qty, expected_delivery_date}}
    po_map: dict = {}
    for line, po_edd in open_lines:
        remaining = (line.ordered_qty or 0) - (line.received_qty or 0)
        if remaining <= 0:
            continue
        key = (line.material_name, line.size, line.joint_type)
        if key not in po_map:
            po_map[key] = {"incoming_qty": 0, "expected_delivery_date": None}
        po_map[key]["incoming_qty"] += remaining
        if po_edd is not None:
            cur = po_map[key]["expected_delivery_date"]
            if cur is None or po_edd < cur:
                po_map[key]["expected_delivery_date"] = po_edd

    # Pre-fetch C: parts from active projects, with their processes and parent line/project
    # Single query: Part JOIN ProjectProductionLine JOIN Project + all PartProcesses bulk-loaded
    from sqlalchemy.orm import selectinload

    active_project_ids = [
        row[0]
        for row in db.query(Project.id).filter(Project.status != "Completed").all()
    ]

    if active_project_ids:
        parts_with_line = (
            db.query(Part, ProjectProductionLine, Project)
            .join(ProjectProductionLine, Part.production_line_id == ProjectProductionLine.id)
            .join(Project, ProjectProductionLine.project_id == Project.id)
            .filter(Project.id.in_(active_project_ids))
            .all()
        )

        # Bulk-fetch all PartProcess rows for these parts in one query
        part_ids = [p.id for p, _, _ in parts_with_line]
        all_processes = db.query(PartProcess).filter(PartProcess.part_id.in_(part_ids)).all()
        procs_by_part: dict = {}
        for proc in all_processes:
            procs_by_part.setdefault(proc.part_id, []).append(proc)
    else:
        parts_with_line = []
        procs_by_part = {}

    # {spec -> {total_demand, projects: [{id, name, qty_needed, delivery_date}]}}
    demand_map: dict = {}
    for part, line, project in parts_with_line:
        processes = procs_by_part.get(part.id, [])
        mr_proc = next((p for p in processes if p.process_name == "Material Received"), None)
        unmet_qty = (part.total_qty or 0) - (mr_proc.completed_qty if mr_proc else 0)
        if unmet_qty <= 0:
            continue
        key = (part.name, line.size, line.joint_type)
        if key not in demand_map:
            demand_map[key] = {"total_demand": 0, "projects": []}
        demand_map[key]["total_demand"] += unmet_qty
        demand_map[key]["projects"].append({
            "id": project.id,
            "name": project.project_name or project.quotation_no,
            "qty_needed": unmet_qty,
            "delivery_date": project.target_date.isoformat() if project.target_date else None,
        })

    # Union all specs and compute coverage
    all_specs = set(stock_map) | set(po_map) | set(demand_map)

    rows: List[MaterialRow] = []
    for spec in all_specs:
        material_name, size, joint_type = spec
        stock = stock_map.get(spec)
        qty_on_hand = stock.qty_on_hand if stock else 0
        reserved_qty = stock.reserved_qty if stock else 0
        minimum_stock = stock.minimum_stock if stock else 0

        po_entry = po_map.get(spec, {})
        incoming_qty = po_entry.get("incoming_qty", 0)
        edd = po_entry.get("expected_delivery_date")

        dem_entry = demand_map.get(spec, {})
        total_demand = dem_entry.get("total_demand", 0)
        projects_raw = dem_entry.get("projects", [])

        # Only include specs that have some demand (specs with only stock/PO but no demand are noise)
        if total_demand == 0:
            continue

        available_stock = qty_on_hand - reserved_qty
        net_gap = total_demand - available_stock - incoming_qty

        if net_gap > 0:
            status = "red"
        elif available_stock < minimum_stock:
            status = "amber"
        else:
            status = "green"

        # Sort projects by delivery_date ascending (None last)
        projects_sorted = sorted(
            projects_raw,
            key=lambda p: (p["delivery_date"] is None, p["delivery_date"] or ""),
        )

        rows.append(MaterialRow(
            material_name=material_name,
            size=size,
            joint_type=joint_type,
            qty_on_hand=qty_on_hand,
            reserved_qty=reserved_qty,
            minimum_stock=minimum_stock,
            incoming_qty=incoming_qty,
            expected_delivery_date=edd.isoformat() if edd else None,
            total_demand=total_demand,
            net_gap=net_gap,
            status=status,
            projects=[MaterialProjectItem(**p) for p in projects_sorted],
        ))

    # Sort: red (highest net_gap first) → amber → green
    _order = {"red": 0, "amber": 1, "green": 2}
    rows.sort(key=lambda r: (_order[r.status], -r.net_gap))

    return rows


@router.get("/materials", response_model=List[MaterialRow])
def get_materials_dashboard(
    db: Session = Depends(get_db),
    current_user: dict = Depends(require_roles(SUPERVISORS)),
):
    rows = _compute_material_rows(db)

    from datetime import timedelta
    from backend.services.db_service import Notification as NotifModel
    red_specs = [r for r in rows if r.status == "red"]
    if red_specs:
        cutoff = datetime.utcnow() - timedelta(hours=24)
        for spec in red_specs[:5]:
            spec_key = f"{spec.material_name}/{spec.size}/{spec.joint_type}"
            already = (
                db.query(NotifModel)
                .filter(
                    NotifModel.event_type == "material_red",
                    NotifModel.body.like(f"%{spec_key}%"),
                    NotifModel.created_at > cutoff,
                )
                .first()
            )
            if not already:
                for role in ["GM", "Production Manager"]:
                    create_notification(
                        db, role, "material_red",
                        f"Material shortage: {spec.material_name} {spec.size}",
                        f"Stock gap for {spec_key}. Net gap: {spec.net_gap} units.",
                        "/dashboard/materials",
                    )

    return rows
```

- [ ] **Step 2: Manually verify no behavior change**

With the local dev backend running (`python -m uvicorn backend.main:app --port 8003 --reload`) and a valid JWT (e.g. log in as `GM_USER`/`GM_PASS` from local `.env`):

```bash
curl -s http://localhost:8003/api/v1/dashboard/materials -H "Authorization: Bearer $JWT" | python3 -m json.tool | head -30
```

Expected: HTTP 200, a JSON array of material rows shaped exactly as before (`material_name`, `size`, `joint_type`, `qty_on_hand`, ..., `status`, `projects`) — this is a pure refactor, the response must be byte-identical to before the change for the same DB state.

- [ ] **Step 3: Commit**

```bash
git add backend/app/dashboard/router.py
git commit -m "refactor: extract _compute_material_rows from get_materials_dashboard"
```

---

### Task 2: Add `summarize_material_risk` to `briefing_service.py` (TDD)

**Files:**
- Modify: `backend/services/briefing_service.py` (append new function)
- Test: `test_briefing_service.py`

**Interfaces:**
- Consumes: nothing from other tasks (pure function, takes duck-typed row objects).
- Produces: `summarize_material_risk(rows, top_n=5) -> dict` with shape `{"projects_blocked": int, "top_risks": [{"material_name", "size", "joint_type", "net_gap", "projects": [str]}]}`. Used by Task 3.

- [ ] **Step 1: Write the failing tests**

Add to `test_briefing_service.py`, after the existing imports (line 3) — extend the import line and add two small fixture helpers plus three test functions:

```python
from backend.services.briefing_service import (
    summarize_production, on_time_pct, build_leaderboard, resolve_and_rank_activity,
    resolve_role, summarize_material_risk,
)
```

Add these helpers and tests anywhere after `_row` (existing helper, line 6-7) and before the `if __name__ == "__main__":` block:

```python
def _material_row(status, net_gap, material_name="Pipe", size=6, joint_type="Butt", projects=None):
    return SimpleNamespace(
        status=status, net_gap=net_gap, material_name=material_name, size=size,
        joint_type=joint_type, projects=projects or [],
    )


def _project(id, name):
    return SimpleNamespace(id=id, name=name)


def test_summarize_material_risk_counts_distinct_blocked_projects():
    rows = [
        _material_row("red", 10, projects=[_project(1, "P1"), _project(2, "P2")]),
        _material_row("red", 5, projects=[_project(2, "P2")]),  # P2 in both rows — counted once
        _material_row("green", 0, projects=[_project(3, "P3")]),
    ]
    result = summarize_material_risk(rows)
    assert result["projects_blocked"] == 2


def test_summarize_material_risk_sorts_top_n_by_net_gap_desc():
    rows = [_material_row("red", g, material_name=f"M{g}") for g in [3, 9, 1, 7, 5, 2]]
    result = summarize_material_risk(rows, top_n=3)
    assert [r["material_name"] for r in result["top_risks"]] == ["M9", "M7", "M5"]


def test_summarize_material_risk_ignores_amber_and_green():
    rows = [_material_row("green", 0), _material_row("amber", 0)]
    result = summarize_material_risk(rows)
    assert result == {"projects_blocked": 0, "top_risks": []}
```

Add the three new test names to the `if __name__ == "__main__":` block at the bottom of the file, before `print("OK")`:

```python
    test_summarize_material_risk_counts_distinct_blocked_projects()
    test_summarize_material_risk_sorts_top_n_by_net_gap_desc()
    test_summarize_material_risk_ignores_amber_and_green()
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
python test_briefing_service.py
```

Expected: `ImportError: cannot import name 'summarize_material_risk'`.

- [ ] **Step 3: Implement `summarize_material_risk`**

Append to `backend/services/briefing_service.py` (end of file, after `resolve_and_rank_activity`):

```python
def summarize_material_risk(rows, top_n=5):
    """
    rows: iterable of objects with .status ("red"|"amber"|"green"), .net_gap (int),
      .material_name, .size, .joint_type, and .projects (iterable of objects with
      .id and .name) — the MaterialRow list from
      backend.app.dashboard.router._compute_material_rows.
    "Blocked" = touching at least one red-status spec (net_gap > 0, a hard
    shortfall). Amber (stock below minimum but no hard gap yet) doesn't count.
    Returns {"projects_blocked": int, "top_risks": [...]} — the top_n red
    specs sorted by net_gap descending.
    """
    red_rows = [r for r in rows if r.status == "red"]
    blocked_project_ids = {p.id for r in red_rows for p in r.projects}
    top = sorted(red_rows, key=lambda r: r.net_gap, reverse=True)[:top_n]
    return {
        "projects_blocked": len(blocked_project_ids),
        "top_risks": [
            {
                "material_name": r.material_name,
                "size": r.size,
                "joint_type": r.joint_type,
                "net_gap": r.net_gap,
                "projects": [p.name for p in r.projects],
            }
            for r in top
        ],
    }
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
python test_briefing_service.py
```

Expected: `OK` printed, no assertion errors.

- [ ] **Step 5: Commit**

```bash
git add backend/services/briefing_service.py test_briefing_service.py
git commit -m "feat: add summarize_material_risk aggregation function"
```

---

### Task 3: Wire `materials` into the `/executive-briefing` response

**Files:**
- Modify: `backend/app/dashboard/router.py:224-226` (imports), `:383-405` (return statement)

**Interfaces:**
- Consumes: `_compute_material_rows(db)` (Task 1), `summarize_material_risk(rows)` (Task 2).
- Produces: `executive_briefing()`'s JSON response gains a `"materials"` key: `{"projects_blocked": int, "top_risks": [...]}`. Consumed by Task 4 (frontend) and Task 6 (email formatter).

- [ ] **Step 1: Add the import**

In `backend/app/dashboard/router.py`, find (around line 224-226):

```python
    from backend.services.briefing_service import (
        summarize_production, resolve_and_rank_activity, build_leaderboard, on_time_pct, resolve_role,
    )
```

Replace with:

```python
    from backend.services.briefing_service import (
        summarize_production, resolve_and_rank_activity, build_leaderboard, on_time_pct, resolve_role,
        summarize_material_risk,
    )
```

- [ ] **Step 2: Compute and add the `materials` field**

Find the `return` statement at the end of `executive_briefing()` (around line 383-405):

```python
    return {
        "production": production,
        "today_allotted": today_allotted,
        "activity": activity,
        "people": {
```

Immediately above that `return`, add:

```python
    materials = summarize_material_risk(_compute_material_rows(db))

```

And change the `return` dict to include it:

```python
    return {
        "production": production,
        "today_allotted": today_allotted,
        "activity": activity,
        "materials": materials,
        "people": {
```

(Everything else in the dict — `"people": {...}"` through the closing `}` — stays exactly as it is.)

- [ ] **Step 3: Manually verify**

With the backend running and a valid CEO/MD/Developer JWT:

```bash
curl -s http://localhost:8003/api/v1/dashboard/executive-briefing -H "Authorization: Bearer $JWT" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d['materials'])"
```

Expected: `{'projects_blocked': <int>, 'top_risks': [...]}` — no error, no missing key.

- [ ] **Step 4: Commit**

```bash
git add backend/app/dashboard/router.py
git commit -m "feat: add materials risk digest to executive-briefing endpoint"
```

---

### Task 4: Frontend — Material Risk tile + section on the Briefing tab

**Files:**
- Modify: `next-frontend/src/app/(main)/dashboard/executive/page.tsx`

**Interfaces:**
- Consumes: `briefing.materials.{projects_blocked, top_risks}` from the `/executive-briefing` response (Task 3).

- [ ] **Step 1: Add the TypeScript interface field**

Find (around line 93-98):

```typescript
interface Briefing {
  production: { yesterday: ProductionBucket; last_7d: ProductionBucket; trend_14d: TrendDay[] };
  today_allotted: TodayAllotted[];
  activity: ActivityItem[];
  people: { leaderboard: LeaderboardRow[]; by_role: RoleKpis };
}
```

Replace with:

```typescript
interface MaterialRisk {
  material_name: string;
  size: number | null;
  joint_type: string | null;
  net_gap: number;
  projects: string[];
}

interface Briefing {
  production: { yesterday: ProductionBucket; last_7d: ProductionBucket; trend_14d: TrendDay[] };
  today_allotted: TodayAllotted[];
  activity: ActivityItem[];
  materials: { projects_blocked: number; top_risks: MaterialRisk[] };
  people: { leaderboard: LeaderboardRow[]; by_role: RoleKpis };
}
```

- [ ] **Step 2: Add the MetricCard to the KPI strip**

Find (around line 239-248):

```tsx
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
```

Replace with:

```tsx
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-5">
            <MetricCard label="Feet Yesterday" value={Math.round(briefing.production.yesterday.total_feet)} tone="neutral" />
            <MetricCard label="Feet Last 7 Days" value={Math.round(briefing.production.last_7d.total_feet)} tone="neutral" />
            <MetricCard label="Entries Yesterday" value={briefing.production.yesterday.entries} tone="neutral" />
            <MetricCard
              label="Today's Target Feet"
              value={Math.round(briefing.today_allotted.reduce((s, w) => s + w.target_feet, 0))}
              tone="neutral"
            />
            <MetricCard
              label="Projects Blocked on Material"
              value={briefing.materials.projects_blocked}
              tone={briefing.materials.projects_blocked > 0 ? "critical" : "neutral"}
            />
          </div>
```

- [ ] **Step 3: Add the Material Risk section**

Find the closing of the "Today's Allotted Work" section (around line 289-290):

```tsx
            </Table>
          </div>

          <div className="grid grid-cols-1 gap-8 lg:grid-cols-2">
            <div>
              <h2 className="mb-3 font-display text-lg font-bold uppercase tracking-wide text-ink">
                14-Day Production Trend
              </h2>
```

Insert a new section between the closing `</div>` of "Today's Allotted Work" and the "14-Day Production Trend" grid:

```tsx
            </Table>
          </div>

          <div>
            <h2 className="mb-3 font-display text-lg font-bold uppercase tracking-wide text-ink">
              Material Risk
            </h2>
            {briefing.materials.top_risks.length === 0 ? (
              <p className="text-sm text-ink-soft">No material shortages blocking projects.</p>
            ) : (
              <div className="flex flex-col divide-y divide-line">
                {briefing.materials.top_risks.map((r, i) => (
                  <div key={i} className="flex items-start justify-between gap-4 py-2.5">
                    <div>
                      <span className="font-semibold text-ink">
                        {r.material_name}
                        {r.size ? ` — ${r.size}mm` : ""}
                        {r.joint_type ? ` (${r.joint_type})` : ""}
                      </span>
                      <p className="text-sm text-ink-soft">{r.projects.join(", ")}</p>
                    </div>
                    <Badge tone="critical">Gap: {r.net_gap}</Badge>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="grid grid-cols-1 gap-8 lg:grid-cols-2">
            <div>
              <h2 className="mb-3 font-display text-lg font-bold uppercase tracking-wide text-ink">
                14-Day Production Trend
              </h2>
```

- [ ] **Step 4: Verify the frontend builds**

```bash
npm --prefix next-frontend run build
```

Expected: build completes with no TypeScript errors, `/dashboard/executive` listed in the route output.

- [ ] **Step 5: Manual browser check**

Start both servers locally (`python -m uvicorn backend.main:app --port 8003 --reload` and `npm --prefix next-frontend run dev`), log in as CEO/MD/GM/Developer, open `/dashboard/executive`, confirm:
- The 5th "Projects Blocked on Material" card renders with the right tone (critical if >0, neutral if 0).
- The "Material Risk" section shows either the empty-state message or a list of red specs with project names and a critical badge showing the gap.

- [ ] **Step 6: Commit**

```bash
git add "next-frontend/src/app/(main)/dashboard/executive/page.tsx"
git commit -m "feat: show material risk digest on executive Briefing tab"
```

---

## Part 2 — Daily Email Digest

### Task 5: Extract `get_executive_briefing_data` from the `executive_briefing` route

**Files:**
- Modify: `backend/app/dashboard/router.py:214-405`

**Interfaces:**
- Produces: `get_executive_briefing_data(db: Session) -> dict` — everything the route currently computes, plus the `materials` key from Task 3, plus a new `"today"` field (`date.today().isoformat()`). Used by the route itself and by Task 7's script.

- [ ] **Step 1: Replace the `executive_briefing` route**

Find the full function in `backend/app/dashboard/router.py` (starts at `@router.get("/executive-briefing")`, currently lines 214-405 after Task 3's edits). Its signature line is:

```python
@router.get("/executive-briefing")
def executive_briefing(
    db: Session = Depends(get_db),
    user=Depends(require_roles(EXECUTIVES + ["Developer"])),
):
    from datetime import date as _date, timedelta
```

Change the function name and signature from `executive_briefing(db, user)` to `get_executive_briefing_data(db)` — i.e. replace:

```python
@router.get("/executive-briefing")
def executive_briefing(
    db: Session = Depends(get_db),
    user=Depends(require_roles(EXECUTIVES + ["Developer"])),
):
    from datetime import date as _date, timedelta
```

with:

```python
def get_executive_briefing_data(db: Session) -> dict:
    from datetime import date as _date, timedelta
```

Leave every line of the function body between that point and the `return {...}` completely unchanged (all the production/today_allotted/activity/leaderboard/by_role/materials computation from Tasks 1-3 stays exactly as-is — only the `def` line changes).

Find the `return` statement (added to in Task 3):

```python
    return {
        "production": production,
        "today_allotted": today_allotted,
        "activity": activity,
        "materials": materials,
        "people": {
```

Add a `"today"` field:

```python
    return {
        "today": today.isoformat(),
        "production": production,
        "today_allotted": today_allotted,
        "activity": activity,
        "materials": materials,
        "people": {
```

(`today` is already computed earlier in the function body as `today = _date.today()` for the production-window query — this just also returns it.)

Immediately after the end of `get_executive_briefing_data` (after its closing `}` and blank line, before `@router.get("/planning")`), add the thin route wrapper:

```python
@router.get("/executive-briefing")
def executive_briefing(
    db: Session = Depends(get_db),
    user=Depends(require_roles(EXECUTIVES + ["Developer"])),
):
    return get_executive_briefing_data(db)
```

- [ ] **Step 2: Manually verify no behavior change**

```bash
curl -s http://localhost:8003/api/v1/dashboard/executive-briefing -H "Authorization: Bearer $JWT" | python3 -m json.tool | head -20
```

Expected: HTTP 200, same shape as before plus a new top-level `"today"` field holding today's ISO date, e.g. `"today": "2026-07-27"`.

- [ ] **Step 3: Commit**

```bash
git add backend/app/dashboard/router.py
git commit -m "refactor: extract get_executive_briefing_data so the daily email script can reuse it"
```

---

### Task 6: Add `format_briefing_email` to `briefing_service.py` (TDD)

**Files:**
- Modify: `backend/services/briefing_service.py` (append new function)
- Test: `test_briefing_service.py`

**Interfaces:**
- Consumes: a dict shaped like `get_executive_briefing_data`'s return value (Task 5) — specifically needs `"today"`, `"production"` (`.yesterday`/`.last_7d` each with `.total_feet`/`.entries`), `"today_allotted"` (list of dicts with `"target_feet"`), `"materials"` (`.projects_blocked`), `"activity"` (list of dicts with `"actor_name"`/`"action"`/`"detail"`).
- Produces: `format_briefing_email(data: dict) -> str`. Used by Task 7's script.

- [ ] **Step 1: Write the failing tests**

Extend the import line in `test_briefing_service.py` (from Task 2's edit) to also import `format_briefing_email`:

```python
from backend.services.briefing_service import (
    summarize_production, on_time_pct, build_leaderboard, resolve_and_rank_activity,
    resolve_role, summarize_material_risk, format_briefing_email,
)
```

Add this fixture helper and two tests anywhere after the Task 2 additions and before `if __name__ == "__main__":`:

```python
def _briefing_fixture(**overrides):
    base = {
        "today": "2026-07-28",
        "production": {
            "yesterday": {"tig_feet": 100.0, "mig_feet": 50.0, "grinding_feet": 0.0, "total_feet": 150.0, "entries": 3},
            "last_7d": {"tig_feet": 400.0, "mig_feet": 200.0, "grinding_feet": 50.0, "total_feet": 650.0, "entries": 20},
            "trend_14d": [],
        },
        "today_allotted": [{"target_feet": 100}, {"target_feet": 50}],
        "activity": [{"actor_name": "Alice", "action": "Update", "detail": "Logged 40ft TIG"}],
        "materials": {"projects_blocked": 2, "top_risks": []},
    }
    base.update(overrides)
    return base


def test_format_briefing_email_includes_key_numbers():
    text = format_briefing_email(_briefing_fixture())
    assert "EJ Tracker — Morning Briefing — 2026-07-28" in text
    assert "Yesterday: 150.0 ft (3 entries)" in text
    assert "Last 7 days: 650.0 ft" in text
    assert "2 work orders, 150 ft target" in text
    assert "Projects blocked on material: 2" in text
    assert "Alice — Update — Logged 40ft TIG" in text


def test_format_briefing_email_empty_activity():
    text = format_briefing_email(_briefing_fixture(activity=[]))
    assert "No recent activity." in text
```

Add the two new test names to the `if __name__ == "__main__":` block, before `print("OK")`:

```python
    test_format_briefing_email_includes_key_numbers()
    test_format_briefing_email_empty_activity()
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
python test_briefing_service.py
```

Expected: `ImportError: cannot import name 'format_briefing_email'`.

- [ ] **Step 3: Implement `format_briefing_email`**

Append to `backend/services/briefing_service.py` (end of file, after `summarize_material_risk`):

```python
def format_briefing_email(data: dict) -> str:
    """
    data: shaped like get_executive_briefing_data's return value
      (backend.app.dashboard.router) — needs "today", "production",
      "today_allotted", "materials", "activity".
    Returns a condensed plain-text digest (Brevo's send_system_email is
    plain-text only — see backend.services.email_service).
    """
    y = data["production"]["yesterday"]
    w = data["production"]["last_7d"]
    today_allotted = data["today_allotted"]
    target_feet = round(sum(w_o["target_feet"] for w_o in today_allotted))
    materials = data["materials"]
    activity = data["activity"][:5]

    lines = [
        f"EJ Tracker — Morning Briefing — {data['today']}",
        "",
        f"Yesterday: {y['total_feet']} ft ({y['entries']} entries)",
        f"Last 7 days: {w['total_feet']} ft",
        f"Today's allotted work: {len(today_allotted)} work orders, {target_feet} ft target",
        f"Projects blocked on material: {materials['projects_blocked']}",
        "",
        "Recent activity:",
    ]
    if activity:
        for a in activity:
            lines.append(f"- {a['actor_name']} — {a['action']} — {a['detail']}")
    else:
        lines.append("- No recent activity.")

    return "\n".join(lines)
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
python test_briefing_service.py
```

Expected: `OK` printed, no assertion errors.

- [ ] **Step 5: Commit**

```bash
git add backend/services/briefing_service.py test_briefing_service.py
git commit -m "feat: add format_briefing_email formatter"
```

---

### Task 7: `scripts/send_daily_briefing.py` — the command Railway's Cron Job runs

**Files:**
- Create: `scripts/send_daily_briefing.py`

**Interfaces:**
- Consumes: `get_executive_briefing_data(db)` (Task 5), `format_briefing_email(data)` (Task 6), `send_system_email(to, subject, body)` (existing, `backend/services/email_service.py`), `SessionLocal` (existing, `backend/services/db_service.py`).

This follows the existing convention in this repo's `scripts/` directory (`sync_employees_to_users.py`, `import_employees.py`) — a standalone script, not a `backend/scripts/` package, run directly with `python scripts/send_daily_briefing.py` (not `python -m ...`).

- [ ] **Step 1: Write the script**

```python
import os
import sys

sys.path.append(os.path.abspath(os.path.join(os.path.dirname(__file__), '..')))

from backend.services.db_service import SessionLocal
from backend.app.dashboard.router import get_executive_briefing_data
from backend.services.briefing_service import format_briefing_email
from backend.services.email_service import send_system_email


def main():
    recipients = [e for e in (os.getenv("CEO_EMAIL"), os.getenv("MD_EMAIL")) if e]
    if not recipients:
        print("No CEO_EMAIL/MD_EMAIL configured — nothing to send", file=sys.stderr)
        sys.exit(1)  # fail loud: an unattended daily job should show as a failed Railway run, not a silent no-op

    db = SessionLocal()
    try:
        data = get_executive_briefing_data(db)
    finally:
        db.close()

    body = format_briefing_email(data)
    subject = f"EJ Tracker — Morning Briefing — {data['today']}"
    send_system_email(recipients, subject, body)
    print(f"Sent morning briefing to {recipients}")


if __name__ == "__main__":
    main()
```

- [ ] **Step 2: Manually verify locally**

With local `.env` containing a real `DATABASE_URL` and (temporarily, for this test only — same pattern as the Session 34 CEO/MD login test) `CEO_EMAIL`/`MD_EMAIL` set to an address you can check:

```bash
python scripts/send_daily_briefing.py
```

Expected: prints `Sent morning briefing to [...]`, exits 0. If `BREVO_API_KEY` isn't set locally, `send_system_email` logs a warning and no-ops (existing, unchanged behavior) — the script still exits 0 in that case since the job itself ran correctly. Check the target inbox if `BREVO_API_KEY` is set locally.

Also verify the fail-loud path:

```bash
CEO_EMAIL= MD_EMAIL= python scripts/send_daily_briefing.py; echo "exit code: $?"
```

Expected: prints the "No CEO_EMAIL/MD_EMAIL configured" message to stderr, `exit code: 1`.

- [ ] **Step 3: Commit**

```bash
git add scripts/send_daily_briefing.py
git commit -m "feat: add daily briefing email script for Railway Cron Job"
```

---

### Task 8: Railway Cron Job setup (manual, outside this repo) + session wrap-up

**Files:**
- Modify: `projectprogress.md`, `problemsresolved.md` (per this repo's standing convention — update at the end of every session)

This task has no code — it's the Railway-dashboard steps the user needs to do, which cannot be done from the repo, plus the required end-of-session documentation update.

- [ ] **Step 1: Give the user exact Railway Cron Job setup steps**

Report these steps to the user (do not attempt to perform them — no Railway CLI/dashboard access from this environment):

1. In the Railway project that hosts the `demo` backend service, click **+ New** → **Cron Job**.
2. Connect it to the same GitHub repo, branch `demo`.
3. Set the **Command**: `python scripts/send_daily_briefing.py`
4. Set the **Schedule** (cron syntax, UTC): `30 2 * * *` (2:30 AM UTC = 8:00 AM IST).
5. Under **Variables**, either link the same variable group as the backend service, or copy in: `DATABASE_URL`, `BREVO_API_KEY`, `SMTP_FROM_EMAIL`, `SMTP_FROM_NAME`, `CEO_EMAIL`, `MD_EMAIL`. (`CEO_EMAIL`/`MD_EMAIL` are new — not set anywhere yet, same gap pattern as the still-pending `CEO_USER`/`MD_USER` from Session 30.)
6. Deploy, then manually trigger one run from the Railway dashboard to confirm it succeeds before waiting for the schedule.

- [ ] **Step 2: Update `projectprogress.md`**

Add a new dated session entry (following the exact format of the existing Session 34 entry) summarizing: both features built, `npm run build` + `python test_briefing_service.py` passing, manual curl verification of both endpoint changes, and the pending Railway Cron Job setup (Step 1 above) as the only remaining manual step.

- [ ] **Step 3: Update `problemsresolved.md`**

Not a bug-fix session, but per the project's convention, log the two non-trivial design decisions made during implementation: (a) the material-notification side effect had to stay in `get_materials_dashboard` and not move into the extracted `_compute_material_rows`, to avoid firing GM/PM notification checks every time the briefing loads; (b) `get_executive_briefing_data` was kept in `router.py` rather than moved to `briefing_service.py` as the spec suggested, to avoid a service-layer-importing-from-router inversion (see "Deviation from the spec" at the top of this plan).

- [ ] **Step 4: Push to `demo`**

```bash
git push origin demo
```

Railway auto-deploys `demo` — confirm the deploy succeeds before considering Part 1 (material risk digest) live. Part 2 (email digest) additionally needs the manual Railway Cron Job setup from Step 1 before it actually fires on a schedule.
