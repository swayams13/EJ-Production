# Worker Productivity Tracking — Design Spec
Date: 2026-07-16

## Problem

Work orders are generated and assigned to workers (target feet per process), but there is no link between the daily welding log entries supervisors make and those work orders. Actual feet logged by supervisors live only at the production-line level (`WeldingLog`), while `WorkOrder.actual_feet` stays null unless a supervisor manually completes it via the scheduler modal. GM/CEO/MD have no way to see per-worker productivity over time.

## Goal

Single entry point: when a supervisor logs TIG/MIG/Grinding feet on the job order page, that entry automatically updates the assigned worker's work order — no double entry. Worker actual vs target feet are visible on the scheduler page in real time. GM/CEO/MD get a productivity dashboard with daily/weekly/monthly breakdowns.

---

## Data Layer

### Migration

```sql
ALTER TABLE welding_logs
  ADD COLUMN work_order_id INTEGER REFERENCES work_orders(id);
```

Nullable — legacy logs without a matched work order are preserved.

### `WeldingLog` model (`db_service.py`)

Add:
```python
work_order_id = Column(Integer, ForeignKey("work_orders.id"), nullable=True)
work_order    = relationship("WorkOrder", back_populates="welding_logs")
```

### `WorkOrder` model (`db_service.py`)

Add reverse relationship:
```python
welding_logs = relationship("WeldingLog", back_populates="work_order")
```

---

## Backend Changes

### 1. `production/schemas.py` — `WeldingLogCreate`

Make `operator_id` required (remove `Optional` and `None` default).

```python
class WeldingLogCreate(BaseModel):
    operator_id: int          # required — must match a work order for today
    process_type: str         # TIG | MIG | Grinding
    feet_done: float = Field(gt=0)
```

### 2. `production/router.py` — `add_welding_log`

After the existing WeldingLog is created and committed, add a sync block:

```python
# Find matching work order for this operator + project + process + today
wo = db.query(WorkOrder).filter(
    WorkOrder.user_id      == tx.operator_id,
    WorkOrder.project_id   == line.project_id,
    WorkOrder.process_type == tx.process_type,
    WorkOrder.date         == date.today(),
).first()

if not wo:
    raise HTTPException(
        status_code=400,
        detail=f"No work order found for this worker on {tx.process_type} for this project today. Generate work orders first."
    )

log.work_order_id = wo.id

# Recompute actual_feet as sum of all linked welding logs for this work order
total = db.query(func.sum(WeldingLog.feet_done)).filter(
    WeldingLog.work_order_id == wo.id
).scalar() or 0.0
wo.actual_feet = total

db.commit()
```

`WorkOrder.actual_feet` is always the sum of its linked `WeldingLog` entries — derived on every write, never entered manually.

### 3. `scheduler/router.py` — `GET /work-orders`

Add optional query params `project_id` and `process_type` so the job order welding form can fetch only the workers relevant to the current project+process:

```python
@router.get("/work-orders", response_model=List[WorkOrderResponse])
def get_work_orders(
    target_date:  Optional[date] = None,
    project_id:   Optional[int]  = None,
    process_type: Optional[str]  = None,
    ...
):
    ...
    if project_id:
        query = query.filter(WorkOrder.project_id == project_id)
    if process_type:
        query = query.filter(WorkOrder.process_type == process_type)
    ...
```

### 4. New endpoint — `GET /api/v1/scheduler/productivity`

```
GET /api/v1/scheduler/productivity
  ?from_date=YYYY-MM-DD
  &to_date=YYYY-MM-DD
  &user_id=<optional>
  &process_type=<optional>
```

Roles: GM, CEO, MD, Admin, Developer.

Returns aggregated WorkOrder rows grouped by worker + process type:

```json
[
  {
    "user_id": 5,
    "worker_name": "Ramesh Kumar",
    "process_type": "TIG",
    "target_feet": 480.0,
    "actual_feet": 410.0,
    "efficiency_pct": 85.4,
    "days_worked": 6
  },
  ...
]
```

`efficiency_pct = (actual_feet / target_feet) * 100`, null-safe (0 if target is 0).

---

## Frontend Changes

### 1. Job order welding log form

**File:** wherever the welding log modal lives (job order page).

- Add a required **Worker** dropdown above the feet field.
- On open: fetch `GET /api/v1/scheduler/work-orders?date=<today>&project_id=<X>&process_type=<selected_process>`.
- Render as `<select>` with options from the returned work orders (display: worker name + target feet, e.g. "Ramesh Kumar — 80 ft").
- If the list is empty: show inline warning — *"No workers assigned to this process today. Generate work orders first."* and disable submit.
- `operator_id` is sent in the POST body; backend enforces the work order match.

### 2. Scheduler page — work order list

**File:** `next-frontend/src/app/(main)/scheduler/page.tsx`

- Add **Actual / Target** column to the work orders table: display as `{actual_feet ?? 0} / {target_feet} ft`.
- Optionally add a thin progress bar (use existing `ui/` components if one exists).
- `actual_feet` is already in `WorkOrderResponse` — no new API call.

### 3. New `/productivity` page

**File:** `next-frontend/src/app/(main)/productivity/page.tsx`

Roles: GM, CEO, MD, Admin (redirect others to `/dashboard`).

Layout:
- **Filter bar** (top): Date range with presets (Today / This Week / This Month / Custom), Worker dropdown (all workers), Process Type dropdown (All / TIG / MIG / Grinding).
- **Summary cards** (row): Total target ft | Total actual ft | Overall efficiency % | Workers tracked.
- **Table**: Worker | Process | Target ft | Actual ft | Efficiency % | Days worked. Sortable by any column.

Fetch: `GET /api/v1/scheduler/productivity?from_date=X&to_date=Y&...`

Add a nav link to `/productivity` in the sidebar, visible only to GM/CEO/MD/Admin.

---

## What is NOT in scope

- Mobile-optimised shop floor tablet UI — can be added later if needed.
- Editing or deleting welding log entries (no change to existing behaviour).
- Alerting supervisors when a worker is behind target — separate feature.
- Overtime work order tracking (exists in the scheduler but productivity page aggregates all work orders including overtime).

---

## Constraints

- PostgreSQL only.
- No new Python packages.
- No new npm packages — use existing `ui/` components.
- Push to `demo` branch only; no merge to `main` without explicit user approval.
