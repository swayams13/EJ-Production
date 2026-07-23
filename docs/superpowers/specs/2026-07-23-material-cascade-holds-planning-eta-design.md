# Material Cascade, Holds & Planning ETA — Design Spec

**Date:** 2026-07-23  
**Status:** Approved — ready for implementation planning  
**Scope:** Items 1, 2, 3 from the module interconnection brainstorm (2026-07-23)

---

## Overview

Three tightly coupled features that close the procurement → scheduling → visibility loop:

1. **Material unblock cascade** — when a goods receipt lands, auto-resolve any MaterialHold records whose required material spec is now covered by warehouse stock.
2. **Auto-create holds on material-blocked work orders** — when `generate_work_orders` skips a part due to zero stock, create a `MaterialHold` row. Visible in the Holds Dashboard (new section) and counted in the Procurement morning list badge.
3. **Planning ETA visibility** — the Planning dashboard shows, per project, which materials are blocked and the earliest PO expected delivery date covering them.

---

## Section 1: Data Model

### New table: `MaterialHold`

Added via `_run_startup_migration` in `backend/main.py` (existing migration pattern).

```sql
CREATE TABLE material_holds (
    id            SERIAL PRIMARY KEY,
    project_id    INTEGER NOT NULL REFERENCES projects(id),
    part_id       INTEGER REFERENCES parts(id),
    material_name TEXT NOT NULL,
    size          INTEGER NOT NULL,
    joint_type    TEXT NOT NULL,
    required_qty  INTEGER NOT NULL DEFAULT 1,
    status        TEXT NOT NULL DEFAULT 'active',  -- active | resolved
    created_at    TIMESTAMP NOT NULL DEFAULT NOW(),
    resolved_at   TIMESTAMP
);
```

SQLAlchemy model added to `backend/services/db_service.py`:

```python
class MaterialHold(Base):
    __tablename__ = "material_holds"
    id            = Column(Integer, primary_key=True)
    project_id    = Column(Integer, ForeignKey("projects.id"), nullable=False)
    part_id       = Column(Integer, ForeignKey("parts.id"), nullable=True)
    material_name = Column(String, nullable=False)
    size          = Column(Integer, nullable=False)
    joint_type    = Column(String, nullable=False)
    required_qty  = Column(Integer, nullable=False, default=1)
    status        = Column(String, nullable=False, default="active")
    created_at    = Column(DateTime, default=datetime.utcnow)
    resolved_at   = Column(DateTime, nullable=True)
    project       = relationship("Project")
    part          = relationship("Part")
```

No columns added to existing tables.

---

## Section 2: Work Order Generation → Auto-create Holds

**File:** `backend/app/scheduler/router.py`

### New helper: `_collect_blocked_specs`

Called only when `find_available_part` returns `None`. Returns every `(part.name, line.size, line.joint_type)` tuple in the project that has zero warehouse stock AND has at least one pending process matching `process_type`.

```python
def _collect_blocked_specs(db, project, process_type):
    relevant_steps = PROCESS_TYPE_TO_STEPS.get(process_type, [])
    specs = []
    for line in project.production_lines:
        size = line.size or 0
        jt   = line.joint_type or ""
        for part in line.parts:
            avail = _available_stock_local(db, part.name, size, jt)
            has_pending = any(
                proc.process_name in relevant_steps and proc.status != "ready"
                for proc in part.processes
            )
            if avail == 0 and has_pending:
                specs.append({"part": part, "material_name": part.name, "size": size, "joint_type": jt})
    return specs
```

### Hook into `generate_work_orders`

In the existing Step 6 assignment loop, after `part = find_available_part(...)`:

```python
part = find_available_part(db, req["project"], process_type)
if part is None:
    # existing behaviour: record no_stock_projects
    if req["project"].quotation_no not in no_stock_projects:
        no_stock_projects.append(req["project"].quotation_no)
    # NEW: create holds for each blocked material spec
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

Committed at the end of the existing `db.commit()` — no extra round-trip.

`MaterialHold` must be imported from `db_service` at the top of the scheduler router.

---

## Section 3: Goods Receipt → Cascade Resolve Holds

**File:** `backend/app/procurement/router.py`

### New private function: `_cascade_material_received`

```python
def _cascade_material_received(db, material_name: str, size: int, joint_type: str) -> int:
    """Resolve any active MaterialHold whose stock requirement is now met."""
    from datetime import datetime
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
        avail = max(0, stock.qty_on_hand - stock.reserved_qty) if stock else 0
        if avail >= h.required_qty:
            h.status = "resolved"
            h.resolved_at = datetime.utcnow()
            resolved += 1
    return resolved
```

### Hook into `POST /api/v1/procurement/po/{po_id}/receipt`

The existing endpoint already updates `WarehouseStock.qty_on_hand` for each receipt line. After the stock update loop and before `db.commit()`, add:

```python
total_resolved = 0
for rl in body.lines:
    po_line = db.query(PurchaseOrderLine).filter_by(id=rl.po_line_id).first()
    if po_line:
        total_resolved += _cascade_material_received(
            db, po_line.material_name, po_line.size, po_line.joint_type
        )
```

Response already returns a `ReceiptResponse` — extend the schema to include `resolved_holds: int` so the PM knows how many parts just unblocked.

`MaterialHold` must be imported from `db_service`.

---

## Section 4: New Endpoint — `GET /api/v1/projects/material-holds`

**File:** `backend/app/projects/router.py`

Returns all active `MaterialHold` rows, enriched with project quotation_no and the earliest open PO ETA covering the same material spec.

**Response shape (per row):**
```json
{
  "id": 1,
  "project_id": 12,
  "quotation_no": "PE-2024-041",
  "project_name": "BPCL Vessel Header",
  "part_name": "Flange",
  "material_name": "Flange",
  "size": 100,
  "joint_type": "EJ",
  "required_qty": 1,
  "days_blocked": 3,
  "po_eta": "2026-07-28",
  "po_number": "PO-2026-017"
}
```

**`po_eta` join logic:**  
For each hold, find the earliest `PurchaseOrder.expected_delivery_date` where:
- `PurchaseOrderLine.material_name` matches hold's `material_name`
- `PurchaseOrderLine.size` matches hold's `size`
- `PurchaseOrderLine.joint_type` matches hold's `joint_type`
- `PurchaseOrder.status` in `['raised', 'sent', 'partially_received']`

`po_eta` is `null` if no matching open PO exists (signals: no PO raised yet — critical).

`days_blocked` = `(today - hold.created_at.date()).days`.

RBAC: same as other project endpoints (`SUPERVISORS`).

---

## Section 5: Procurement Morning List — Blocked Parts Badge

**File:** `backend/services/procurement_service.py`

In `get_morning_list` (or wherever the morning list response dict is built), add one scalar before returning:

```python
material_holds_count = db.query(func.count(MaterialHold.id)).filter_by(status="active").scalar() or 0
```

Return it as a top-level field alongside `morning_list`:

```json
{
  "morning_list": [...],
  "material_holds_count": 7
}
```

**Frontend — `next-frontend/src/app/(main)/procurement/page.tsx`** (or the morning list page component):

Add a badge in the page header area:

```tsx
{data.material_holds_count > 0 && (
  <Link href="/dashboard/holds">
    <Badge tone="critical">
      {data.material_holds_count} parts blocked on shop floor
    </Badge>
  </Link>
)}
```

Uses existing `Badge` component. Links to `/dashboard/holds` (existing route).

---

## Section 6: Planning Dashboard — Material Blocks per Project

**File:** `backend/app/dashboard/router.py` — `GET /api/v1/dashboard/planning`

For each project in the existing `active_projects` loop, compute `material_blocks`:

```python
from sqlalchemy import func as sqlfunc

# Outside the project loop — bulk fetch all active holds
active_holds = db.query(MaterialHold).filter_by(status="active").all()
# Group by project_id → {project_id: [holds]}
holds_by_project = {}
for h in active_holds:
    holds_by_project.setdefault(h.project_id, []).append(h)
```

Then for each project in the loop, build `material_blocks`:

```python
project_holds = holds_by_project.get(p.id, [])
# Group holds by (material_name, size, joint_type) — deduplicate
blocks_map = {}
for h in project_holds:
    key = (h.material_name, h.size, h.joint_type)
    blocks_map.setdefault(key, {"count": 0, "po_eta": None, "po_number": None})
    blocks_map[key]["count"] += 1

# Enrich with PO ETA — one query per unique material spec is acceptable at this scale
material_blocks = []
for (mat, sz, jt), info in blocks_map.items():
    po = db.query(PurchaseOrder).join(PurchaseOrderLine).filter(
        PurchaseOrderLine.material_name == mat,
        PurchaseOrderLine.size == sz,
        PurchaseOrderLine.joint_type == jt,
        PurchaseOrder.status.in_(["raised", "sent", "partially_received"]),
    ).order_by(PurchaseOrder.expected_delivery_date.asc()).first()
    material_blocks.append({
        "material_name": mat,
        "size": sz,
        "joint_type": jt,
        "parts_blocked": info["count"],
        "earliest_po_eta": po.expected_delivery_date.isoformat() if po and po.expected_delivery_date else None,
        "po_number": po.po_number if po else None,
    })
```

Add `"material_blocks": material_blocks` to each project's entry in the response.

**Frontend — `next-frontend/src/app/(main)/dashboard/planning/page.tsx`**:

Under each project row in the existing table/card, render `material_blocks` as a collapsible sub-row (use existing `<details>/<summary>` or a toggle state):

```tsx
{project.material_blocks?.length > 0 && (
  <div className="mt-2 rounded border border-amber-200 bg-amber-50 p-3 text-sm">
    <p className="font-semibold text-amber-800">
      Material Shortage ({project.material_blocks.length} spec{project.material_blocks.length > 1 ? 's' : ''})
    </p>
    {project.material_blocks.map((b) => (
      <div key={`${b.material_name}-${b.size}-${b.joint_type}`} className="mt-1 text-amber-700">
        {b.material_name} {b.size}NB {b.joint_type} — {b.parts_blocked} part(s) blocked
        {b.earliest_po_eta
          ? ` · PO ${b.po_number} ETA ${b.earliest_po_eta}`
          : ' · No PO raised'}
      </div>
    ))}
  </div>
)}
```

Uses Tailwind only, no new components.

---

## Section 7: Holds Dashboard — New Material Shortages Section

**File:** `next-frontend/src/app/(main)/dashboard/holds/page.tsx`

Add a second `Card` below the existing "Active Holds" card:

- Title: `Material Shortages (${materialHolds.length})`
- Fetches from `GET /api/v1/projects/material-holds`
- Columns: Project | Material | Size/Type | Days Blocked | PO ETA | Status

Badge tones:
- `po_eta` present → `tone="warning"` — "ETA: {date}"
- `po_eta` null → `tone="critical"` — "No PO Raised"

No action button needed — material holds auto-resolve on goods receipt. The PM's action is to raise a PO (done in procurement module).

---

## Data Flow Summary

```
generate_work_orders()
  → find_available_part() returns None
  → _collect_blocked_specs() finds zero-stock parts with pending processes
  → INSERT MaterialHold rows (deduped by active status)

POST /procurement/po/{id}/receipt
  → existing: updates WarehouseStock.qty_on_hand
  → NEW: _cascade_material_received() per receipt line
      → MaterialHold.status = "resolved" where stock now covers required_qty
      → response includes resolved_holds count

GET /api/v1/projects/material-holds       → Holds Dashboard (new section)
GET /api/v1/dashboard/planning            → extended with material_blocks per project
GET /api/v1/procurement/morning-list      → extended with material_holds_count badge
```

---

## Files Changed

| File | Change |
|---|---|
| `backend/services/db_service.py` | Add `MaterialHold` model |
| `backend/main.py` | Add `CREATE TABLE material_holds` startup migration |
| `backend/app/scheduler/router.py` | Add `_collect_blocked_specs`; hook into `generate_work_orders` |
| `backend/app/procurement/router.py` | Add `_cascade_material_received`; hook into receipt endpoint; import `MaterialHold` |
| `backend/services/procurement_service.py` | Add `material_holds_count` to morning list response |
| `backend/app/projects/router.py` | Add `GET /material-holds` endpoint |
| `backend/app/dashboard/router.py` | Extend planning endpoint with `material_blocks` per project |
| `next-frontend/.../dashboard/holds/page.tsx` | Add Material Shortages card (second section) |
| `next-frontend/.../procurement/page.tsx` | Add blocked parts count badge to header |
| `next-frontend/.../dashboard/planning/page.tsx` | Render `material_blocks` collapsible row per project |

Total: 10 files. No new frontend routes. No new dependencies.

---

## Constraints & Limitations

- `_cascade_material_received` checks `required_qty=1` for all holds (simplification — actual required qty per part is not tracked in this version). If a project needs 4 flanges, 4 separate holds will be created (one per blocked part row). `ponytail: coarse required_qty, upgrade when per-part BoM qty is tracked`
- The PO ETA join in the planning dashboard does one query per unique `(material, size, joint_type)` spec per page load. Acceptable at current scale (<100 active projects). `ponytail: batch if planning dashboard slows`
- MaterialHolds are NOT auto-created retroactively for existing blocked parts — they appear only after the next `generate_work_orders` run.
