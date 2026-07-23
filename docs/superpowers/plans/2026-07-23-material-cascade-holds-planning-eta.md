# Material Cascade, Holds & Planning ETA — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wire procurement goods receipts to auto-resolve material shortage holds, auto-create those holds during work order generation, surface them in the Holds Dashboard with manual override, badge the procurement morning list, and show per-project material ETA in the Planning dashboard.

**Architecture:** One new `MaterialHold` SQLAlchemy model (auto-created by `Base.metadata.create_all`). Three backend write hooks (work order generation, goods receipt, manual resolve). Three read surfaces (Holds Dashboard, morning list badge, planning dashboard). No message queue — all cascades are synchronous in the same DB session/transaction.

**Tech Stack:** FastAPI + SQLAlchemy (Python backend), Next.js App Router + TypeScript (frontend). PostgreSQL. All new Python packages: none. All new npm packages: none.

## Global Constraints

- PostgreSQL only — no SQLite fallback
- Python dependencies go in root `requirements.txt` only
- Push to `demo` branch only — never merge to `main` without explicit human approval
- Run backend: `python -m uvicorn backend.main:app --port 8003 --reload` from project root
- Run frontend: `npm --prefix next-frontend run dev`
- Build check: `npm --prefix next-frontend run build` — must pass 0 TS errors before commit
- RBAC: `SUPERVISORS` role constant covers Supervisor, Production Manager, GM, Admin, Developer — already imported in all router files as `from backend.app.auth.rbac import require_roles, SUPERVISORS, MANAGEMENT`
- Never use `alert()`/`confirm()`/`prompt()` in frontend — use existing `Toast`/`Alert` components
- Never interpolate Tailwind class names at runtime

---

## File Map

| File | Action | What changes |
|---|---|---|
| `backend/services/db_service.py` | Modify | Add `MaterialHold` SQLAlchemy model |
| `backend/app/scheduler/router.py` | Modify | Add `_collect_blocked_specs`; hook hold creation into `generate_work_orders` |
| `backend/app/procurement/router.py` | Modify | Add `_cascade_material_received`; hook into `log_receipt`; import `MaterialHold` |
| `backend/app/procurement/schemas.py` | Modify | Add `resolved_holds: int` to `ReceiptResponse` |
| `backend/app/projects/router.py` | Modify | Add `GET /material-holds` and `PATCH /material-holds/{id}/resolve` |
| `backend/app/dashboard/router.py` | Modify | Add `material_blocks` per project in planning endpoint |
| `next-frontend/src/app/(main)/procurement/page.tsx` | Modify | Parse new response shape; add blocked-parts badge |
| `next-frontend/src/app/(main)/dashboard/holds/page.tsx` | Modify | Add Material Shortages card with Mark Resolved |
| `next-frontend/src/app/(main)/dashboard/planning/page.tsx` | Modify | Add `material_blocks` inline row per project |

---

## Task 1: MaterialHold SQLAlchemy Model

**Files:**
- Modify: `backend/services/db_service.py`

**Interfaces:**
- Produces: `MaterialHold` ORM class importable as `from backend.services.db_service import MaterialHold`; columns: `id, project_id, part_id, material_name, size, joint_type, required_qty, status, resolution_note, created_at, resolved_at`

- [ ] **Step 1: Find the insertion point in db_service.py**

Open `backend/services/db_service.py`. Locate the `WarehouseStock` class (around line 316). Add `MaterialHold` immediately after it. Also locate the import block at the top — ensure `DateTime` is already in the Column imports (it is, since other models use it).

- [ ] **Step 2: Add the MaterialHold model**

```python
class MaterialHold(Base):
    __tablename__ = "material_holds"
    id              = Column(Integer, primary_key=True)
    project_id      = Column(Integer, ForeignKey("projects.id"), nullable=False)
    part_id         = Column(Integer, ForeignKey("parts.id"), nullable=True)
    material_name   = Column(String, nullable=False)
    size            = Column(Integer, nullable=False)
    joint_type      = Column(String, nullable=False)
    required_qty    = Column(Integer, nullable=False, default=1)
    status          = Column(String, nullable=False, default="active")  # active | resolved
    resolution_note = Column(String, nullable=True)
    created_at      = Column(DateTime, default=datetime.utcnow)
    resolved_at     = Column(DateTime, nullable=True)
    project         = relationship("Project")
    part            = relationship("Part")
```

`datetime` is already imported at the top of `db_service.py` (used by other models). `Base`, `Column`, `Integer`, `String`, `ForeignKey`, `DateTime`, `relationship` are all already imported.

- [ ] **Step 3: Verify server starts and creates the table**

```bash
python -m uvicorn backend.main:app --port 8003
```

Expected: no errors. Server starts. `Base.metadata.create_all(engine)` (called in `main.py` on startup) will create the `material_holds` table automatically.

- [ ] **Step 4: Confirm table exists**

```bash
# In a separate terminal — connect to your Railway Postgres or local DB
psql $DATABASE_URL -c "\d material_holds"
```

Expected: table with columns `id, project_id, part_id, material_name, size, joint_type, required_qty, status, resolution_note, created_at, resolved_at`.

- [ ] **Step 5: Commit**

```bash
git add backend/services/db_service.py
git commit -m "feat: add MaterialHold SQLAlchemy model"
```

---

## Task 2: Auto-Create Holds in Work Order Generation

**Files:**
- Modify: `backend/app/scheduler/router.py` (lines ~1-30 imports, ~36-64 helpers, ~227-260 assignment loop)

**Interfaces:**
- Consumes: `MaterialHold` from `backend.services.db_service` (Task 1)
- Produces: `_collect_blocked_specs(db, project, process_type) -> list[dict]` — each dict has keys `part` (ORM object), `material_name` (str), `size` (int), `joint_type` (str)

- [ ] **Step 1: Add MaterialHold to the scheduler router import**

In `backend/app/scheduler/router.py`, find the existing import from `backend.services.db_service` (around line 19-21):

```python
    User, WarehouseStock, WorkOrder,
```

Add `MaterialHold` to this line:

```python
    User, WarehouseStock, WorkOrder, MaterialHold,
```

- [ ] **Step 2: Add `_collect_blocked_specs` helper**

Add this function immediately after the existing `find_available_part` function (after line ~64):

```python
def _collect_blocked_specs(db: Session, project, process_type: str) -> list:
    """
    Returns all (part, material_name, size, joint_type) specs in the project
    that have zero warehouse stock AND have at least one pending process matching
    process_type. Called only when find_available_part returns None.
    """
    relevant_steps = PROCESS_TYPE_TO_STEPS.get(process_type, [])
    specs = []
    for line in project.production_lines:
        size = line.size or 0
        jt = line.joint_type or ""
        for part in line.parts:
            avail = _available_stock_local(db, part.name, size, jt)
            has_pending = any(
                proc.process_name in relevant_steps and proc.status != "ready"
                for proc in part.processes
            )
            if avail == 0 and has_pending:
                specs.append({
                    "part": part,
                    "material_name": part.name,
                    "size": size,
                    "joint_type": jt,
                })
    return specs
```

- [ ] **Step 3: Hook hold creation into the assignment loop**

In `generate_work_orders`, find the existing block around line 241-243:

```python
                    part = find_available_part(db, req["project"], process_type)
                    if part is None and req["project"].quotation_no not in no_stock_projects:
                        no_stock_projects.append(req["project"].quotation_no)
```

Replace it with:

```python
                    part = find_available_part(db, req["project"], process_type)
                    if part is None:
                        if req["project"].quotation_no not in no_stock_projects:
                            no_stock_projects.append(req["project"].quotation_no)
                        for spec in _collect_blocked_specs(db, req["project"], process_type):
                            exists = db.query(MaterialHold).filter_by(
                                project_id=req["project"].id,
                                part_id=spec["part"].id,
                                material_name=spec["material_name"],
                                size=spec["size"],
                                joint_type=spec["joint_type"],
                                status="active",
                            ).first()
                            if not exists:
                                db.add(MaterialHold(
                                    project_id=req["project"].id,
                                    part_id=spec["part"].id,
                                    material_name=spec["material_name"],
                                    size=spec["size"],
                                    joint_type=spec["joint_type"],
                                    required_qty=1,
                                ))
```

The `db.commit()` at line ~261 already commits everything — no extra flush needed.

- [ ] **Step 4: Test — generate work orders and verify holds appear**

Start the backend. Call generate-work-orders for today (adjust the date):

```bash
curl -s -X POST "http://localhost:8003/api/v1/scheduler/generate-work-orders?target_date=2026-07-23" \
  -H "Authorization: Bearer <your_token>" | python3 -m json.tool
```

Then query the DB:

```bash
psql $DATABASE_URL -c "SELECT project_id, material_name, size, joint_type, status FROM material_holds;"
```

Expected: rows with `status='active'` for any projects where `find_available_part` returned None. If all projects have stock, holds table stays empty — that's correct.

- [ ] **Step 5: Verify no regressions on work order generation response**

```bash
curl -s "http://localhost:8003/api/v1/scheduler/work-orders?target_date=2026-07-23" \
  -H "Authorization: Bearer <your_token>" | python3 -m json.tool
```

Expected: same work order list as before — hold creation is additive, doesn't change work order output.

- [ ] **Step 6: Commit**

```bash
git add backend/app/scheduler/router.py
git commit -m "feat(scheduler): auto-create MaterialHold on material-blocked work orders"
```

---

## Task 3: Goods Receipt → Cascade Resolve Holds

**Files:**
- Modify: `backend/app/procurement/router.py`
- Modify: `backend/app/procurement/schemas.py`

**Interfaces:**
- Consumes: `MaterialHold` from `backend.services.db_service` (Task 1)
- Produces: `_cascade_material_received(db, material_name, size, joint_type) -> int` (count of resolved holds); `ReceiptResponse.resolved_holds: int`

- [ ] **Step 1: Add MaterialHold to procurement router imports**

In `backend/app/procurement/router.py`, find the existing `db_service` import (lines 6-11):

```python
from backend.services.db_service import (
    get_db, Vendor, WarehouseStock, MaterialLeadTime,
    PurchaseOrder, PurchaseOrderLine, PurchaseOrderLineAllocation,
    GoodsReceipt, GoodsReceiptLine, PartProcess, Part, User,
    DailyProcurementLog,
)
```

Add `MaterialHold` to it:

```python
from backend.services.db_service import (
    get_db, Vendor, WarehouseStock, MaterialLeadTime,
    PurchaseOrder, PurchaseOrderLine, PurchaseOrderLineAllocation,
    GoodsReceipt, GoodsReceiptLine, PartProcess, Part, User,
    DailyProcurementLog, MaterialHold,
)
```

- [ ] **Step 2: Add `_cascade_material_received` function**

Add this helper immediately before the `log_receipt` endpoint (before line ~241):

```python
def _cascade_material_received(db: Session, material_name: str, size: int, joint_type: str) -> int:
    """
    Resolve active MaterialHolds for this spec whose required_qty is now covered
    by current warehouse stock. Returns count of holds resolved.
    """
    active = db.query(MaterialHold).filter_by(
        material_name=material_name,
        size=size,
        joint_type=joint_type,
        status="active",
    ).all()
    resolved = 0
    for h in active:
        stock = db.query(WarehouseStock).filter_by(
            material_name=material_name, size=size, joint_type=joint_type
        ).first()
        avail = max(0, (stock.qty_on_hand or 0) - (stock.reserved_qty or 0)) if stock else 0
        if avail >= h.required_qty:
            h.status = "resolved"
            h.resolved_at = datetime.utcnow()
            resolved += 1
    return resolved
```

- [ ] **Step 3: Hook cascade into `log_receipt`**

In the `log_receipt` function, find the PO status update block (around lines 281-286):

```python
    all_lines = po.lines
    if all(ln.status == "received" for ln in all_lines):
        po.status = "received"
    elif any((ln.received_qty or 0) > 0 for ln in all_lines):
        po.status = "partially_received"
    po.updated_at = datetime.utcnow()

    db.commit()
    db.refresh(receipt)
    return receipt
```

Replace it with:

```python
    all_lines = po.lines
    if all(ln.status == "received" for ln in all_lines):
        po.status = "received"
    elif any((ln.received_qty or 0) > 0 for ln in all_lines):
        po.status = "partially_received"
    po.updated_at = datetime.utcnow()

    # Cascade: resolve MaterialHolds for each received material spec
    total_resolved = 0
    for rl in body.lines:
        po_line = db.query(PurchaseOrderLine).filter_by(id=rl.po_line_id).first()
        if po_line:
            total_resolved += _cascade_material_received(
                db, po_line.material_name, po_line.size, po_line.joint_type
            )

    db.commit()
    db.refresh(receipt)
    receipt.resolved_holds = total_resolved
    return receipt
```

Note: `receipt.resolved_holds` is set as a Python attribute after refresh — it's not a DB column. Pydantic reads it via the response schema.

- [ ] **Step 4: Update ReceiptResponse schema to include resolved_holds**

In `backend/app/procurement/schemas.py`, find `ReceiptResponse` (around line 155):

```python
class ReceiptResponse(BaseModel):
    id: int
    purchase_order_id: int
    receipt_date: Optional[DateType] = None
    received_by: Optional[int] = None
    notes: Optional[str] = None

    class Config:
        from_attributes = True
```

Replace with:

```python
class ReceiptResponse(BaseModel):
    id: int
    purchase_order_id: int
    receipt_date: Optional[DateType] = None
    received_by: Optional[int] = None
    notes: Optional[str] = None
    resolved_holds: int = 0

    class Config:
        from_attributes = True
```

- [ ] **Step 5: Test — receive a PO and verify holds are resolved**

First ensure there's an active MaterialHold in the DB (from Task 2 test, or insert manually):

```bash
psql $DATABASE_URL -c "
INSERT INTO material_holds (project_id, material_name, size, joint_type, required_qty, status, created_at)
VALUES (1, 'Flange', 100, 'EJ', 1, 'active', NOW())
ON CONFLICT DO NOTHING;"
```

Then receive a PO line for `Flange / 100 / EJ` (use an existing draft PO, or check `/api/v1/procurement/po`):

```bash
curl -s -X POST "http://localhost:8003/api/v1/procurement/po/1/receipt" \
  -H "Authorization: Bearer <your_token>" \
  -H "Content-Type: application/json" \
  -d '{"lines": [{"po_line_id": 1, "qty_received": 5}]}' | python3 -m json.tool
```

Expected response includes `"resolved_holds": 1` (or more if multiple holds matched).

Verify in DB:

```bash
psql $DATABASE_URL -c "SELECT id, status, resolved_at FROM material_holds WHERE material_name='Flange' AND size=100;"
```

Expected: `status='resolved'`, `resolved_at` is set.

- [ ] **Step 6: Commit**

```bash
git add backend/app/procurement/router.py backend/app/procurement/schemas.py
git commit -m "feat(procurement): cascade-resolve MaterialHolds on goods receipt"
```

---

## Task 4: Manual Resolve Endpoint + GET /material-holds

**Files:**
- Modify: `backend/app/projects/router.py`

**Interfaces:**
- Consumes: `MaterialHold` from `backend.services.db_service` (Task 1); `PurchaseOrder`, `PurchaseOrderLine` (already imported in projects router)
- Produces:
  - `GET /api/v1/projects/material-holds` → `list[MaterialHoldRow]` where each row has: `id, project_id, quotation_no, project_name, part_name, material_name, size, joint_type, required_qty, days_blocked, po_eta, po_number`
  - `PATCH /api/v1/projects/material-holds/{hold_id}/resolve` → `{"ok": true, "id": hold_id}`

- [ ] **Step 1: Add MaterialHold and PurchaseOrder to projects router imports**

Open `backend/app/projects/router.py`. Find the existing import from `backend.services.db_service`. Add `MaterialHold`, `PurchaseOrder`, `PurchaseOrderLine` if not already there. Example (adjust to match the actual import block):

```python
from backend.services.db_service import (
    get_db, Project, ProjectProductionLine, Part, PartProcess,
    ProjectHoldHistory, ProjectResourceAssignment, WeldingMaster,
    MaterialHold, PurchaseOrder, PurchaseOrderLine,
    # ... keep all existing imports
)
```

Also add near the top if not present:

```python
from pydantic import BaseModel as PydanticBase
from typing import Optional
```

- [ ] **Step 2: Add the GET /material-holds endpoint**

Add at the end of `backend/app/projects/router.py` (before the last line, or after the existing `/holds` endpoint):

```python
@router.get("/material-holds")
def get_material_holds(
    db: Session = Depends(get_db),
    _=Depends(require_roles(SUPERVISORS)),
):
    from datetime import date as _date, datetime as _dt
    today = _date.today()

    holds = (
        db.query(MaterialHold)
        .filter_by(status="active")
        .order_by(MaterialHold.created_at.asc())
        .all()
    )

    rows = []
    for h in holds:
        # Earliest open PO covering this material spec
        po = (
            db.query(PurchaseOrder)
            .join(PurchaseOrderLine, PurchaseOrderLine.purchase_order_id == PurchaseOrder.id)
            .filter(
                PurchaseOrderLine.material_name == h.material_name,
                PurchaseOrderLine.size == h.size,
                PurchaseOrderLine.joint_type == h.joint_type,
                PurchaseOrder.status.in_(["raised", "sent", "partially_received"]),
            )
            .order_by(PurchaseOrder.expected_delivery_date.asc())
            .first()
        )

        created = h.created_at.date() if hasattr(h.created_at, "date") else h.created_at
        days_blocked = (today - created).days if created else 0

        rows.append({
            "id": h.id,
            "project_id": h.project_id,
            "quotation_no": h.project.quotation_no if h.project else "",
            "project_name": h.project.project_name if h.project else "",
            "part_name": h.part.name if h.part else h.material_name,
            "material_name": h.material_name,
            "size": h.size,
            "joint_type": h.joint_type,
            "required_qty": h.required_qty,
            "days_blocked": days_blocked,
            "po_eta": po.expected_delivery_date.isoformat() if po and po.expected_delivery_date else None,
            "po_number": po.po_number if po else None,
        })

    return rows
```

- [ ] **Step 3: Add the PATCH /material-holds/{hold_id}/resolve endpoint**

Add immediately after the GET endpoint:

```python
class MaterialHoldResolve(PydanticBase):
    resolution_note: Optional[str] = None


@router.patch("/material-holds/{hold_id}/resolve")
def resolve_material_hold(
    hold_id: int,
    body: MaterialHoldResolve,
    db: Session = Depends(get_db),
    _=Depends(require_roles(SUPERVISORS)),
):
    from datetime import datetime as _dt
    h = db.query(MaterialHold).filter_by(id=hold_id).first()
    if not h:
        raise HTTPException(404, "Hold not found")
    if h.status == "resolved":
        raise HTTPException(400, "Hold is already resolved")
    h.status = "resolved"
    h.resolved_at = _dt.utcnow()
    h.resolution_note = body.resolution_note
    db.commit()
    return {"ok": True, "id": hold_id}
```

- [ ] **Step 4: Test GET /material-holds**

```bash
curl -s "http://localhost:8003/api/v1/projects/material-holds" \
  -H "Authorization: Bearer <your_token>" | python3 -m json.tool
```

Expected: JSON array. Each item has `id, quotation_no, material_name, size, joint_type, days_blocked, po_eta, po_number`. `po_eta` is `null` if no open PO covers the spec.

- [ ] **Step 5: Test PATCH /material-holds/{id}/resolve**

Take an `id` from the GET response above:

```bash
curl -s -X PATCH "http://localhost:8003/api/v1/projects/material-holds/1/resolve" \
  -H "Authorization: Bearer <your_token>" \
  -H "Content-Type: application/json" \
  -d '{"resolution_note": "Pulled from alternate store"}' | python3 -m json.tool
```

Expected: `{"ok": true, "id": 1}`

Verify:

```bash
psql $DATABASE_URL -c "SELECT id, status, resolution_note, resolved_at FROM material_holds WHERE id=1;"
```

Expected: `status='resolved'`, `resolution_note` set, `resolved_at` set.

Calling PATCH again on the same hold:

```bash
curl -s -X PATCH "http://localhost:8003/api/v1/projects/material-holds/1/resolve" \
  -H "Authorization: Bearer <your_token>" \
  -H "Content-Type: application/json" \
  -d '{}'
```

Expected: `{"detail": "Hold is already resolved"}` (400 error).

- [ ] **Step 6: Commit**

```bash
git add backend/app/projects/router.py
git commit -m "feat(projects): add GET /material-holds and PATCH /material-holds/{id}/resolve"
```

---

## Task 5: Morning List Badge — Backend + Frontend

**Files:**
- Modify: `backend/app/procurement/router.py` (morning-list endpoint, lines ~343-377)
- Modify: `next-frontend/src/app/(main)/procurement/page.tsx`

**Interfaces:**
- Consumes: `MaterialHold` (Task 1), existing `morning_list` endpoint
- Produces: `GET /api/v1/procurement/morning-list` now returns `{"items": [...], "material_holds_count": N}` instead of a bare array. Frontend adapts.

- [ ] **Step 1: Update morning-list endpoint to return object with count**

In `backend/app/procurement/router.py`, find the `morning_list` endpoint (line ~343). The current return is `return items` (after mutating items in a loop). Replace the final `return items` with:

```python
    from sqlalchemy import func as _func
    material_holds_count = (
        db.query(_func.count(MaterialHold.id))
        .filter(MaterialHold.status == "active")
        .scalar()
    ) or 0

    return {"items": items, "material_holds_count": material_holds_count}
```

`MaterialHold` is already imported in this file from Task 3.

- [ ] **Step 2: Test the updated morning-list response shape**

```bash
curl -s "http://localhost:8003/api/v1/procurement/morning-list" \
  -H "Authorization: Bearer <your_token>" | python3 -m json.tool
```

Expected: `{"items": [...], "material_holds_count": 3}` (count reflects active holds in DB).

- [ ] **Step 3: Update procurement page to handle new response shape**

In `next-frontend/src/app/(main)/procurement/page.tsx`:

**a) Add `material_holds_count` to component state** — find the state declarations around line ~180:

```tsx
const [items, setItems] = useState<MorningListItem[]>([]);
const [loading, setLoading] = useState(true);
const [fetchError, setFetchError] = useState("");
```

Add:

```tsx
const [items, setItems] = useState<MorningListItem[]>([]);
const [materialHoldsCount, setMaterialHoldsCount] = useState(0);
const [loading, setLoading] = useState(true);
const [fetchError, setFetchError] = useState("");
```

**b) Update the `load` function** — find where `setItems(await res.json())` is called (around line ~198):

```tsx
      if (res.ok) {
        setItems(await res.json());
      }
```

Replace with:

```tsx
      if (res.ok) {
        const data = await res.json();
        setItems(data.items ?? []);
        setMaterialHoldsCount(data.material_holds_count ?? 0);
      }
```

**c) Add the badge** — find the page header area (the `<h1>` or title section, around line ~280). Add the badge after the page title:

```tsx
{materialHoldsCount > 0 && (
  <a href="/dashboard/holds" className="inline-flex items-center gap-1.5 rounded-full bg-critical/10 px-3 py-1 text-sm font-semibold text-critical hover:bg-critical/20 transition-colors">
    {materialHoldsCount} part{materialHoldsCount !== 1 ? "s" : ""} blocked on shop floor ↗
  </a>
)}
```

Use `<a>` not `<Link>` to keep it simple — this is a cross-section navigation link. The `critical` color token is already defined in `globals.css`.

- [ ] **Step 4: Build check**

```bash
npm --prefix next-frontend run build
```

Expected: 0 TypeScript errors, same route count as before.

- [ ] **Step 5: Manual browser test**

Start frontend (`npm --prefix next-frontend run dev`). Open the procurement morning list page. With active material holds in DB, the badge appears below the page title and links to `/dashboard/holds`. With zero holds, badge is hidden.

- [ ] **Step 6: Commit**

```bash
git add backend/app/procurement/router.py next-frontend/src/app/\(main\)/procurement/page.tsx
git commit -m "feat(procurement): add material holds count badge to morning list"
```

---

## Task 6: Planning Dashboard Backend — material_blocks per Project

**Files:**
- Modify: `backend/app/dashboard/router.py` (planning endpoint, ~line 174)

**Interfaces:**
- Consumes: `MaterialHold` (Task 1), `PurchaseOrder`, `PurchaseOrderLine` — need to be imported in dashboard router if not already
- Produces: each entry in `pacing_metrics` gains `"material_blocks": [{"material_name", "size", "joint_type", "parts_blocked", "earliest_po_eta", "po_number"}]`

- [ ] **Step 1: Check and update imports in dashboard router**

Open `backend/app/dashboard/router.py`. Find the existing import from `backend.services.db_service`. Add `MaterialHold`, `PurchaseOrder`, `PurchaseOrderLine` if not present:

```python
from backend.services.db_service import (
    get_db, Project, ProjectProductionLine, Part, PartProcess,
    WorkOrder, AttendanceLog, User,
    MaterialHold, PurchaseOrder, PurchaseOrderLine,
    # ... keep all existing imports
)
```

- [ ] **Step 2: Add material_blocks computation to the planning endpoint**

In `get_planning_dashboard` (starting line ~175), locate the beginning of the `active_projects` loop (around line ~201: `for p in active_projects:`).

Before the loop, add a bulk fetch of all active holds:

```python
    # Bulk-fetch all active holds — avoids N+1 per project
    all_active_holds = db.query(MaterialHold).filter_by(status="active").all()
    holds_by_project: dict = {}
    for h in all_active_holds:
        holds_by_project.setdefault(h.project_id, []).append(h)
```

Then, inside the `for p in active_projects:` loop, after `pacing_metrics.append(...)` (or wherever each project's dict is built), add `material_blocks` to that dict.

Find the `pacing_metrics.append` call (somewhere after line ~217). Look for a dict being built for each project. Add `material_blocks` computation inside the loop, before the append:

```python
        # Material blocks for this project
        project_holds = holds_by_project.get(p.id, [])
        blocks_map: dict = {}
        for h in project_holds:
            key = (h.material_name, h.size, h.joint_type)
            blocks_map.setdefault(key, 0)
            blocks_map[key] += 1

        material_blocks = []
        for (mat, sz, jt), count in blocks_map.items():
            po = (
                db.query(PurchaseOrder)
                .join(PurchaseOrderLine, PurchaseOrderLine.purchase_order_id == PurchaseOrder.id)
                .filter(
                    PurchaseOrderLine.material_name == mat,
                    PurchaseOrderLine.size == sz,
                    PurchaseOrderLine.joint_type == jt,
                    PurchaseOrder.status.in_(["raised", "sent", "partially_received"]),
                )
                .order_by(PurchaseOrder.expected_delivery_date.asc())
                .first()
            )
            material_blocks.append({
                "material_name": mat,
                "size": sz,
                "joint_type": jt,
                "parts_blocked": count,
                "earliest_po_eta": po.expected_delivery_date.isoformat() if po and po.expected_delivery_date else None,
                "po_number": po.po_number if po else None,
            })
```

Then ensure each pacing_metrics entry dict includes `"material_blocks": material_blocks`. The exact dict key name must match — look for the `pacing_metrics.append({...})` call and add `"material_blocks": material_blocks` to that dict.

- [ ] **Step 3: Test planning dashboard returns material_blocks**

```bash
curl -s "http://localhost:8003/api/v1/dashboard/planning" \
  -H "Authorization: Bearer <your_token>" | python3 -c "
import sys, json
d = json.load(sys.stdin)
for p in d.get('pacing_metrics', [])[:3]:
    print(p.get('project_name'), '→', p.get('material_blocks', []))
"
```

Expected: each project printed with its `material_blocks` array (empty list `[]` for projects with no active holds, populated list for blocked ones).

- [ ] **Step 4: Commit**

```bash
git add backend/app/dashboard/router.py
git commit -m "feat(dashboard): add material_blocks per project to planning endpoint"
```

---

## Task 7: Holds Dashboard Frontend — Material Shortages Card

**Files:**
- Modify: `next-frontend/src/app/(main)/dashboard/holds/page.tsx`

**Interfaces:**
- Consumes: `GET /api/v1/projects/material-holds` (Task 4); `PATCH /api/v1/projects/material-holds/{id}/resolve` (Task 4)
- Produces: second card below existing "Active Holds" card, with inline resolve form

- [ ] **Step 1: Read the current holds page**

Open `next-frontend/src/app/(main)/dashboard/holds/page.tsx`. Identify:
- The `API` base URL constant (or inline `process.env.NEXT_PUBLIC_API_URL || "http://localhost:8003"` pattern)
- The existing `HoldRow` interface
- The existing state declarations (`holds`, `loading`)
- The import line for UI components

- [ ] **Step 2: Add MaterialHold interface and state**

After the existing `interface HoldRow {…}` block, add:

```tsx
interface MaterialHoldRow {
  id: number;
  project_id: number;
  quotation_no: string;
  project_name: string;
  part_name: string;
  material_name: string;
  size: number;
  joint_type: string;
  required_qty: number;
  days_blocked: number;
  po_eta: string | null;
  po_number: string | null;
}
```

Inside the component function, after the existing `const [holds, setHolds] = useState<HoldRow[]>([]);` line, add:

```tsx
const [materialHolds, setMaterialHolds] = useState<MaterialHoldRow[]>([]);
const [materialLoading, setMaterialLoading] = useState(true);
const [resolvingId, setResolvingId] = useState<number | null>(null);
const [resolveNote, setResolveNote] = useState("");
const [resolveOpenId, setResolveOpenId] = useState<number | null>(null);
```

- [ ] **Step 3: Add fetchMaterialHolds function**

After the existing `fetchHolds` function, add:

```tsx
  const API = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8003";

  const fetchMaterialHolds = () => {
    setMaterialLoading(true);
    apiFetch(`${API}/api/v1/projects/material-holds`)
      .then((res) => res.json())
      .then((data) => {
        setMaterialHolds(Array.isArray(data) ? data : []);
        setMaterialLoading(false);
      })
      .catch(() => setMaterialLoading(false));
  };

  const resolveHold = async (id: number) => {
    setResolvingId(id);
    try {
      const res = await apiFetch(`${API}/api/v1/projects/material-holds/${id}/resolve`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ resolution_note: resolveNote || null }),
      });
      if (res.ok) {
        setResolveOpenId(null);
        setResolveNote("");
        fetchMaterialHolds();
      }
    } finally {
      setResolvingId(null);
    }
  };
```

Note: if `API` constant is already defined in the file, don't redeclare it — reuse the existing one.

- [ ] **Step 4: Call fetchMaterialHolds in useEffect**

Find the existing `useEffect(() => { fetchHolds(); }, []);` and add the material holds fetch:

```tsx
  useEffect(() => {
    fetchHolds();
    fetchMaterialHolds();
  }, []);
```

- [ ] **Step 5: Add the Material Shortages card to the JSX**

After the closing `</Card>` of the existing "Active Holds" card, add:

```tsx
      <Card>
        <CardHeader title={`Material Shortages (${materialHolds.length})`} />
        {materialLoading ? (
          <div className="p-6"><Spinner label="Loading material holds…" /></div>
        ) : materialHolds.length === 0 ? (
          <div className="p-6">
            <EmptyState title="No material shortages!" description="All parts have sufficient warehouse stock." />
          </div>
        ) : (
          <Table>
            <THead>
              <Tr>
                <Th>Project</Th>
                <Th>Material</Th>
                <Th>Days Blocked</Th>
                <Th>PO ETA</Th>
                <Th>Action</Th>
              </Tr>
            </THead>
            <TBody>
              {materialHolds.map((h) => (
                <>
                  <Tr key={h.id}>
                    <Td>
                      <div className="font-bold text-ink">{h.quotation_no}</div>
                      <div className="text-xs text-ink-soft">{h.project_name}</div>
                    </Td>
                    <Td>
                      <div className="font-semibold text-ink">{h.material_name}</div>
                      <div className="text-xs text-ink-soft">{h.size}NB · {h.joint_type}</div>
                    </Td>
                    <Td>
                      <Badge tone={h.days_blocked > 3 ? "critical" : "warning"}>
                        {h.days_blocked}d
                      </Badge>
                    </Td>
                    <Td>
                      {h.po_eta ? (
                        <div>
                          <Badge tone="warning">ETA {h.po_eta}</Badge>
                          <div className="text-xs text-ink-soft mt-0.5">{h.po_number}</div>
                        </div>
                      ) : (
                        <Badge tone="critical">No PO Raised</Badge>
                      )}
                    </Td>
                    <Td>
                      {resolveOpenId === h.id ? (
                        <div className="flex flex-col gap-1">
                          <input
                            className="rounded border border-ink-subtle px-2 py-1 text-xs text-ink"
                            placeholder="Resolution note (optional)"
                            value={resolveNote}
                            onChange={(e) => setResolveNote(e.target.value)}
                          />
                          <div className="flex gap-1">
                            <Button
                              variant="primary"
                              onClick={() => resolveHold(h.id)}
                              disabled={resolvingId === h.id}
                            >
                              {resolvingId === h.id ? "Saving…" : "Confirm"}
                            </Button>
                            <Button
                              variant="secondary"
                              onClick={() => { setResolveOpenId(null); setResolveNote(""); }}
                            >
                              Cancel
                            </Button>
                          </div>
                        </div>
                      ) : (
                        <Button variant="secondary" onClick={() => setResolveOpenId(h.id)}>
                          Mark Resolved
                        </Button>
                      )}
                    </Td>
                  </Tr>
                </>
              ))}
            </TBody>
          </Table>
        )}
      </Card>
```

Check that `Button` with `variant="secondary"` is supported by the existing `Button` component in `next-frontend/src/components/ui/`. If the variant name differs (e.g., `"ghost"` or `"outline"`), adjust to match the existing API.

- [ ] **Step 6: Build check**

```bash
npm --prefix next-frontend run build
```

Expected: 0 TypeScript errors.

- [ ] **Step 7: Manual browser test**

Open `/dashboard/holds`. Verify:
1. Existing "Active Holds" card still works (project-level holds)
2. New "Material Shortages" card shows below it
3. "Mark Resolved" button expands inline form
4. After confirming, the row disappears and count updates
5. With zero active material holds, the card shows the empty state message

- [ ] **Step 8: Commit**

```bash
git add next-frontend/src/app/\(main\)/dashboard/holds/page.tsx
git commit -m "feat(holds-dashboard): add Material Shortages card with manual resolve"
```

---

## Task 8: Planning Dashboard Frontend — Material Blocks Row

**Files:**
- Modify: `next-frontend/src/app/(main)/dashboard/planning/page.tsx`

**Interfaces:**
- Consumes: `material_blocks` field on each `PacingMetric` entry (Task 6)

- [ ] **Step 1: Add material_blocks to the PacingMetric interface**

In `next-frontend/src/app/(main)/dashboard/planning/page.tsx`, find the `interface PacingMetric` block (around line ~20):

```tsx
interface PacingMetric {
  project_id: number;
  project_number: string;
  project_name: string;
  // ... other fields
}
```

Add `material_blocks` field:

```tsx
interface MaterialBlock {
  material_name: string;
  size: number;
  joint_type: string;
  parts_blocked: number;
  earliest_po_eta: string | null;
  po_number: string | null;
}

interface PacingMetric {
  project_id: number;
  project_number: string;
  project_name: string;
  // ... all existing fields unchanged ...
  material_blocks?: MaterialBlock[];
}
```

- [ ] **Step 2: Render material_blocks below each project row**

Find the `metrics.pacing_metrics.map((p) => {` block (around line ~183). Each project renders a `<Tr>`. After the closing `</Tr>` for each project row, add a conditional detail row:

```tsx
                  <Tr key={p.project_id}>
                    {/* ... existing cells unchanged ... */}
                  </Tr>
                  {p.material_blocks && p.material_blocks.length > 0 && (
                    <Tr key={`${p.project_id}-blocks`}>
                      <Td colSpan={6} className="p-0">
                        <div className="mx-4 mb-2 rounded border border-amber-200 bg-amber-50 px-3 py-2 text-xs">
                          <span className="font-semibold text-amber-800">
                            Material Shortage — {p.material_blocks.length} spec{p.material_blocks.length > 1 ? "s" : ""} blocked:
                          </span>
                          <ul className="mt-1 space-y-0.5 text-amber-700">
                            {p.material_blocks.map((b) => (
                              <li key={`${b.material_name}-${b.size}-${b.joint_type}`}>
                                {b.material_name} {b.size}NB {b.joint_type} · {b.parts_blocked} part{b.parts_blocked > 1 ? "s" : ""}
                                {b.earliest_po_eta
                                  ? ` · PO ${b.po_number} ETA ${b.earliest_po_eta}`
                                  : " · No PO raised"}
                              </li>
                            ))}
                          </ul>
                        </div>
                      </Td>
                    </Tr>
                  )}
```

The `colSpan` value (6) must match the number of columns in the planning table — adjust if the actual column count differs.

- [ ] **Step 3: Build check**

```bash
npm --prefix next-frontend run build
```

Expected: 0 TypeScript errors.

- [ ] **Step 4: Manual browser test**

Open `/dashboard/planning`. For projects with active `MaterialHold` records in the DB:
- An amber banner appears immediately below that project's row
- Shows material name, NB size, joint type, part count, and PO ETA (or "No PO raised")
- Projects with no holds show no banner

- [ ] **Step 5: Final commit and push to demo**

```bash
git add next-frontend/src/app/\(main\)/dashboard/planning/page.tsx
git commit -m "feat(planning-dashboard): show material shortage ETA per project"
git push origin demo
```

---

## Self-Review Checklist

| Spec requirement | Task covering it |
|---|---|
| MaterialHold table with `resolution_note` | Task 1 |
| Auto-create holds in work order generation (deduped) | Task 2 |
| Cascade resolve on goods receipt | Task 3 |
| `resolved_holds` count in receipt response | Task 3 |
| `GET /projects/material-holds` with po_eta join | Task 4 |
| `PATCH /projects/material-holds/{id}/resolve` with note | Task 4 |
| 400 on double-resolve | Task 4 |
| `material_holds_count` in morning list response | Task 5 |
| Frontend badge on procurement page | Task 5 |
| `material_blocks` per project in planning endpoint | Task 6 |
| Material Shortages card in Holds Dashboard | Task 7 |
| Mark Resolved inline form with cancel | Task 7 |
| Material blocks inline row in Planning dashboard | Task 8 |
| Push to `demo` only | Task 8 step 5 |
