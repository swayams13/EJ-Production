# Worker Productivity Tracking Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When a supervisor logs welding feet on the Shop Floor Entry page, those feet automatically update the assigned worker's work order — enabling real-time per-worker productivity tracking visible on the Scheduler page and a new Productivity dashboard for GM/CEO/MD.

**Architecture:** `WeldingLog` gains a `work_order_id` FK; on every `add_welding_log` call, the backend resolves the matching `WorkOrder` and recomputes `actual_feet` as the sum of all linked `WeldingLog` rows. The production entry page replaces its global operator dropdown with a per-process-type dropdown populated from today's work orders for the selected project. A new `/productivity` page aggregates `WorkOrder` rows into per-worker daily/weekly/monthly summaries.

**Tech Stack:** FastAPI + SQLAlchemy (PostgreSQL), Next.js (TSX), existing `ui/` component library.

## Global Constraints

- PostgreSQL only — no SQLite.
- New Python packages: none. New npm packages: none.
- All Python dependencies in root `requirements.txt`.
- Push to `demo` branch only; never merge to `main` without explicit user approval.
- Never interpolate Tailwind class names at runtime.
- Never use `alert()` / `confirm()` / `prompt()` in frontend.
- Use `<Select>`, `<Input>`, `<Button>`, `<Card>`, `<Badge>`, `<Label>`, `<Th>`, `<Td>` from `next-frontend/src/components/ui/`.
- Backend server: `python -m uvicorn backend.main:app --port 8003 --reload`
- Frontend server: `npm --prefix next-frontend run dev`

---

## File Map

| File | Action | Purpose |
|------|--------|---------|
| `backend/services/db_service.py` | Modify | Add `work_order_id` FK + relationships to `WeldingLog` and `WorkOrder` |
| `backend/app/production/schemas.py` | Modify | Make `operator_id` required in `WeldingLogCreate` |
| `backend/app/production/router.py` | Modify | Auto-match WorkOrder on welding log save; update `actual_feet` |
| `backend/app/scheduler/router.py` | Modify | Add `project_id`/`process_type` filters to `GET /work-orders`; add `GET /productivity` |
| `next-frontend/src/app/(main)/production/entry/page.tsx` | Modify | Replace global operator dropdown with per-process work-order dropdowns |
| `next-frontend/src/app/(main)/scheduler/page.tsx` | Modify | Add Actual ft column to work orders table |
| `next-frontend/src/app/(main)/productivity/page.tsx` | Create | New Productivity dashboard page |
| `next-frontend/src/components/Sidebar.tsx` | Modify | Add Productivity nav link under Workforce |

---

## Task 1: DB — Add `work_order_id` FK to `WeldingLog`

**Files:**
- Modify: `backend/services/db_service.py:186-197`

**Interfaces:**
- Produces: `WeldingLog.work_order_id` (nullable Integer FK → `work_orders.id`); `WorkOrder.welding_logs` relationship

- [ ] **Step 1: Add the column and relationships**

In `backend/services/db_service.py`, update the `WeldingLog` class (currently lines 186–197):

```python
class WeldingLog(Base):
    __tablename__ = "welding_logs"
    id = Column(Integer, primary_key=True, index=True)
    production_line_id = Column(Integer, ForeignKey("project_production_lines.id"), nullable=False)
    operator_id = Column(Integer, ForeignKey("users.id"))
    work_order_id = Column(Integer, ForeignKey("work_orders.id"), nullable=True)
    process_type = Column(String, nullable=False) # "TIG", "MIG", "Grinding"
    feet_done = Column(Float, nullable=False)
    date = Column(Date, default=date.today)
    created_at = Column(DateTime, default=datetime.utcnow)

    production_line = relationship("ProjectProductionLine")
    operator = relationship("User", foreign_keys=[operator_id])
    work_order = relationship("WorkOrder", back_populates="welding_logs")
```

Then update the `WorkOrder` class (currently lines 390–413) — add the back-reference after the existing relationships:

```python
    project = relationship("Project")
    user = relationship("User")
    part = relationship("Part")
    completed_part_process = relationship("PartProcess")
    welding_logs = relationship("WeldingLog", back_populates="work_order")
```

- [ ] **Step 2: Run the DB migration**

With the backend server stopped, run:

```bash
python -c "
from backend.services.db_service import engine
from sqlalchemy import text
with engine.connect() as conn:
    conn.execute(text('ALTER TABLE welding_logs ADD COLUMN IF NOT EXISTS work_order_id INTEGER REFERENCES work_orders(id);'))
    conn.commit()
print('Migration done')
"
```

Expected output: `Migration done`

- [ ] **Step 3: Verify column exists**

```bash
python -c "
from backend.services.db_service import engine
from sqlalchemy import text
with engine.connect() as conn:
    result = conn.execute(text(\"SELECT column_name FROM information_schema.columns WHERE table_name='welding_logs' AND column_name='work_order_id';\"))
    print(result.fetchone())
"
```

Expected: `('work_order_id',)`

- [ ] **Step 4: Commit**

```bash
git add backend/services/db_service.py
git commit -m "feat(db): add work_order_id FK to welding_logs"
```

---

## Task 2: Backend — Require operator, auto-sync WorkOrder on welding log save

**Files:**
- Modify: `backend/app/production/schemas.py`
- Modify: `backend/app/production/router.py:222-283`

**Interfaces:**
- Consumes: `WeldingLog.work_order_id` (from Task 1)
- Produces: `POST /api/v1/production/requirements/{req_id}/welding_logs` now returns 400 if no matching work order; sets `WeldingLog.work_order_id` and recomputes `WorkOrder.actual_feet`

- [ ] **Step 1: Make `operator_id` required in the schema**

In `backend/app/production/schemas.py`, replace the `WeldingLogCreate` class:

```python
class WeldingLogCreate(BaseModel):
    operator_id: int          # required — must match a work order for today
    process_type: str         # TIG | MIG | Grinding
    feet_done: float = Field(gt=0)
```

- [ ] **Step 2: Update `add_welding_log` to auto-match and sync**

In `backend/app/production/router.py`, replace the `add_welding_log` function (currently lines 222–283) with:

```python
@router.post("/requirements/{req_id}/welding_logs")
def add_welding_log(req_id: int, tx: WeldingLogCreate, db: Session = Depends(get_db), current_user: dict = Depends(require_roles(SUPERVISORS))):
    from sqlalchemy import func as sa_func
    from backend.services.db_service import WorkOrder

    line = db.query(ProjectProductionLine).filter_by(id=req_id).first()
    if not line:
        raise HTTPException(status_code=404, detail="Requirement not found")

    if tx.process_type not in VALID_WELDING_PROCESS_TYPES:
        raise HTTPException(status_code=400, detail=f"process_type must be one of {VALID_WELDING_PROCESS_TYPES}")

    joint_type = getattr(line, 'joint_type', None) or 'EJ'
    if joint_type == 'DJ' and tx.process_type == 'TIG':
        raise HTTPException(
            status_code=400,
            detail="Dismantling Joint (DJ) lines have no TIG process; log this welding as MIG instead."
        )

    user = db.query(User).filter_by(id=tx.operator_id).first()
    if not user:
        raise HTTPException(status_code=400, detail="Invalid operator")

    wo = db.query(WorkOrder).filter(
        WorkOrder.user_id == tx.operator_id,
        WorkOrder.project_id == line.project_id,
        WorkOrder.process_type == tx.process_type,
        WorkOrder.date == date.today(),
    ).first()
    if not wo:
        raise HTTPException(
            status_code=400,
            detail=f"No work order found for this worker on {tx.process_type} for this project today. Generate work orders first."
        )

    log = WeldingLog(
        production_line_id=req_id,
        operator_id=tx.operator_id,
        work_order_id=wo.id,
        process_type=tx.process_type,
        feet_done=tx.feet_done
    )
    db.add(log)
    db.flush()  # write to transaction so SUM query includes the new row

    total = db.query(sa_func.sum(WeldingLog.feet_done)).filter(
        WeldingLog.work_order_id == wo.id
    ).scalar() or 0.0
    wo.actual_feet = total

    db_user = db.query(User).filter_by(username=current_user["username"]).first() if current_user else None
    db.add(AuditLog(
        user_id=db_user.id if db_user else None,
        username=current_user["username"] if current_user else None,
        action="Update",
        table_name="welding_logs",
        record_id=req_id,
        details=f"Added {tx.feet_done} feet of {tx.process_type} for requirement {req_id} (work_order_id={wo.id})"
    ))

    db.commit()

    # Recalculate required resources — never fail the log over a recalc error
    try:
        from backend.services.db_service import Project, ProjectResourceAssignment
        from backend.services.production_service import calculate_required_resources_for_deadline
        project = db.query(Project).filter_by(id=line.project_id).first()
        if project:
            today = date.today()
            target_days = max(1, (project.target_date - today).days) if project.target_date and project.target_date > today else 15
            req_tig, req_mig, req_grind = calculate_required_resources_for_deadline(line.project_id, target_days)
            assign = db.query(ProjectResourceAssignment).filter_by(project_id=line.project_id).first()
            if assign:
                assign.assigned_tig_welders = req_tig
                assign.assigned_mig_welders = req_mig
                assign.assigned_grinders = req_grind
                db.commit()
    except Exception:
        pass

    return {"success": True, "message": f"Added {tx.feet_done} feet to {tx.process_type}"}
```

- [ ] **Step 3: Smoke-test the endpoint manually**

Start the backend: `python -m uvicorn backend.main:app --port 8003 --reload`

Test with a valid work order (replace IDs with real ones from your DB):

```bash
curl -s -X POST http://localhost:8003/api/v1/production/requirements/1/welding_logs \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <your_token>" \
  -d '{"operator_id": 5, "process_type": "TIG", "feet_done": 10.0}' | python3 -m json.tool
```

Expected: `{"success": true, "message": "Added 10.0 feet to TIG"}`

Test without a matching work order (use an operator with no work order today):

```bash
curl -s -X POST http://localhost:8003/api/v1/production/requirements/1/welding_logs \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <your_token>" \
  -d '{"operator_id": 999, "process_type": "TIG", "feet_done": 10.0}' | python3 -m json.tool
```

Expected: `{"detail": "No work order found for this worker on TIG for this project today. Generate work orders first."}`

- [ ] **Step 4: Verify `actual_feet` updated on the work order**

```bash
curl -s http://localhost:8003/api/v1/scheduler/work-orders?target_date=<today> \
  -H "Authorization: Bearer <your_token>" | python3 -m json.tool | grep actual_feet
```

Expected: the work order for that worker now shows `"actual_feet": 10.0` (or cumulative sum if logged before).

- [ ] **Step 5: Commit**

```bash
git add backend/app/production/schemas.py backend/app/production/router.py
git commit -m "feat(production): require operator on welding log, auto-sync WorkOrder.actual_feet"
```

---

## Task 3: Backend — `GET /work-orders` filters + `GET /productivity` endpoint

**Files:**
- Modify: `backend/app/scheduler/router.py:541-555` (get_work_orders function)
- Modify: `backend/app/scheduler/router.py` (add /productivity route after get_work_orders)

**Interfaces:**
- Produces:
  - `GET /api/v1/scheduler/work-orders?project_id=X&process_type=TIG&target_date=Y` → filtered list
  - `GET /api/v1/scheduler/productivity?from_date=YYYY-MM-DD&to_date=YYYY-MM-DD&user_id=X&process_type=TIG` → productivity rows

- [ ] **Step 1: Add `project_id` and `process_type` params to `get_work_orders`**

In `backend/app/scheduler/router.py`, replace the `get_work_orders` function (currently lines 541–555):

```python
@router.get("/work-orders", response_model=List[WorkOrderResponse])
def get_work_orders(
    target_date: Optional[date] = None,
    project_id: Optional[int] = None,
    process_type: Optional[str] = None,
    db: Session = Depends(get_db),
    current_user: dict = Depends(require_roles(["Developer", "GM", "Admin", "Production Manager", "Supervisor"])),
):
    query = db.query(WorkOrder).options(
        joinedload(WorkOrder.user),
        joinedload(WorkOrder.project),
        joinedload(WorkOrder.part).joinedload(Part.processes),
        joinedload(WorkOrder.part).joinedload(Part.production_line),
    )
    if target_date:
        query = query.filter(WorkOrder.date == target_date)
    if project_id:
        query = query.filter(WorkOrder.project_id == project_id)
    if process_type:
        query = query.filter(WorkOrder.process_type == process_type)
    return query.order_by(asc(WorkOrder.user_id), asc(WorkOrder.process_type)).all()
```

- [ ] **Step 2: Add the `/productivity` endpoint**

Add this after the `get_work_orders` function in `backend/app/scheduler/router.py`. You will need `from sqlalchemy import func` at the top (check if already imported; add if not) and `from backend.app.auth.rbac import MANAGEMENT` (already defined in rbac.py as `["Developer", "GM", "Admin", "Production Manager"]`):

```python
@router.get("/productivity")
def get_productivity(
    from_date: date,
    to_date: date,
    user_id: Optional[int] = None,
    process_type: Optional[str] = None,
    db: Session = Depends(get_db),
    current_user: dict = Depends(require_roles(["Developer", "GM", "Admin", "Production Manager"])),
):
    # User is already imported from backend.services.db_service at the top of this file
    query = (
        db.query(
            WorkOrder.user_id,
            User.full_name,
            WorkOrder.process_type,
            func.sum(WorkOrder.target_feet).label("target_feet"),
            func.sum(func.coalesce(WorkOrder.actual_feet, 0)).label("actual_feet"),
            func.count(WorkOrder.date.distinct()).label("days_worked"),
        )
        .join(User, User.id == WorkOrder.user_id)
        .filter(WorkOrder.date >= from_date, WorkOrder.date <= to_date)
    )
    if user_id:
        query = query.filter(WorkOrder.user_id == user_id)
    if process_type:
        query = query.filter(WorkOrder.process_type == process_type)
    rows = query.group_by(WorkOrder.user_id, User.full_name, WorkOrder.process_type).order_by(User.full_name, WorkOrder.process_type).all()

    return [
        {
            "user_id": r.user_id,
            "worker_name": r.full_name or f"User #{r.user_id}",
            "process_type": r.process_type,
            "target_feet": round(r.target_feet or 0, 2),
            "actual_feet": round(r.actual_feet or 0, 2),
            "efficiency_pct": round((r.actual_feet / r.target_feet * 100) if r.target_feet else 0, 1),
            "days_worked": r.days_worked,
        }
        for r in rows
    ]
```

> **Note on `User` import:** `backend/app/scheduler/router.py` already imports `User` from `backend/services/db_service`. Use that — do not add a second import.

- [ ] **Step 3: Smoke-test both endpoints**

```bash
# Filtered work orders
curl -s "http://localhost:8003/api/v1/scheduler/work-orders?target_date=<today>&project_id=1&process_type=TIG" \
  -H "Authorization: Bearer <token>" | python3 -m json.tool

# Productivity
curl -s "http://localhost:8003/api/v1/scheduler/productivity?from_date=2026-07-01&to_date=2026-07-16" \
  -H "Authorization: Bearer <token>" | python3 -m json.tool
```

Expected for work orders: list filtered to TIG workers on project 1.  
Expected for productivity: array of `{user_id, worker_name, process_type, target_feet, actual_feet, efficiency_pct, days_worked}`.

- [ ] **Step 4: Commit**

```bash
git add backend/app/scheduler/router.py
git commit -m "feat(scheduler): add project_id/process_type filters to work-orders; add /productivity endpoint"
```

---

## Task 4: Frontend — Per-process worker dropdown in Shop Floor Entry

**Files:**
- Modify: `next-frontend/src/app/(main)/production/entry/page.tsx`

**Interfaces:**
- Consumes: `GET /api/v1/scheduler/work-orders?target_date=<today>&project_id=X` (from Task 3)
- Consumes: `POST /api/v1/production/requirements/{req_id}/welding_logs` now requires `operator_id` (from Task 2)

**What changes:**
- Remove global `operators` state + its fetch + global `operatorId` state
- Add `todayWorkOrders` state (WorkOrders for today's project, all process types)
- Add `weldingOperatorIds` state (per-process-type selected worker)
- Fetch work orders whenever `projectId` changes
- Inside each welding card: add a worker dropdown (filtered by process_type) above the feet input
- Disable submit if no worker selected; show warning text if list is empty

- [ ] **Step 1: Add new state and remove old operator state**

Find these lines (~97, ~115–118) and replace:

```typescript
// OLD — remove both of these blocks:
const [operatorId, setOperatorId] = useState("");
// ...
useEffect(() => {
  apiFetch(`${process.env.NEXT_PUBLIC_API_URL || "http://localhost:8003"}/api/v1/users`)
    .then((res) => res.json())
    .then((d) => setOperators((d.data || []).filter((u: { role: string }) => u.role === "Operator")))
    .catch(() => {});
}, []);
```

```typescript
// NEW — add these (place near the other useState declarations, ~line 81):
interface WOSlim {
  id: number;
  user_id: number;
  process_type: string;
  target_feet: number;
  user?: { id: number; full_name: string | null };
}
const [todayWorkOrders, setTodayWorkOrders] = useState<WOSlim[]>([]);
const [weldingOperatorIds, setWeldingOperatorIds] = useState<Record<string, string>>({});
```

Also remove the `operators` state declaration: `const [operators, setOperators] = useState<...>([]);`

- [ ] **Step 2: Fetch work orders when projectId changes**

Add this `useEffect` after the existing `projectId` effect (~line 121):

```typescript
useEffect(() => {
  if (!projectId) { setTodayWorkOrders([]); setWeldingOperatorIds({}); return; }
  const today = new Date().toISOString().split("T")[0];
  apiFetch(`${process.env.NEXT_PUBLIC_API_URL || "http://localhost:8003"}/api/v1/scheduler/work-orders?target_date=${today}&project_id=${projectId}`)
    .then((res) => res.json())
    .then((data: WOSlim[]) => { if (Array.isArray(data)) setTodayWorkOrders(data); })
    .catch(() => {});
}, [projectId]);
```

- [ ] **Step 3: Remove the global Operator dropdown from the form card**

Find and delete this block (~lines 404–413):

```tsx
// DELETE THIS:
<div>
  <Label>Operator (Optional)</Label>
  <Select value={operatorId} onChange={(e) => setOperatorId(e.target.value)}>
    <option value="">-- Supervisor Entry --</option>
    {operators.map((op) => (
      <option key={op.id} value={op.id}>
        {op.full_name}
      </option>
    ))}
  </Select>
</div>
```

- [ ] **Step 4: Add per-process worker dropdown inside each welding card**

Find the welding card rendering block in the `Welding` tab (~line 747–765). Inside the `!isComplete && target > 0` branch, prepend a worker dropdown above the feet `<Input>`:

```tsx
{!isComplete && target > 0 ? (
  <div className="mt-2 flex flex-col gap-2">
    {/* Worker dropdown — required, populated from today's work orders */}
    {(() => {
      const workers = todayWorkOrders.filter((wo) => wo.process_type === type);
      return workers.length === 0 ? (
        <p className="text-xs text-critical">No workers assigned to {displayType} today. Generate work orders first.</p>
      ) : (
        <Select
          value={weldingOperatorIds[type] || ""}
          onChange={(e) => setWeldingOperatorIds({ ...weldingOperatorIds, [type]: e.target.value })}
        >
          <option value="">-- Select Worker --</option>
          {workers.map((wo) => (
            <option key={wo.user_id} value={wo.user_id}>
              {wo.user?.full_name ?? `Worker #${wo.user_id}`} — {wo.target_feet.toFixed(1)} ft target
            </option>
          ))}
        </Select>
      );
    })()}
    <Input
      type="number"
      min="0.1"
      step="0.1"
      placeholder="Today's Feet Done"
      value={feetInputs[type] || ""}
      onChange={(e) => handleFeetChange(type, e.target.value)}
    />
    <Button
      variant="primary"
      className="w-full justify-center"
      disabled={submitting || !feetInputs[type] || !weldingOperatorIds[type]}
      onClick={() => handleGlobalWeldingSubmit(type)}
    >
      Log {displayType} Progress
    </Button>
  </div>
) : ...}
```

- [ ] **Step 5: Update `handleGlobalWeldingSubmit` to send `weldingOperatorIds[type]`**

Find `handleGlobalWeldingSubmit` (~line 267). Replace the `operator_id` line in the fetch body:

```typescript
// OLD:
body: JSON.stringify({ process_type: processType, feet_done: feet, operator_id: operatorId ? parseInt(operatorId) : null }),

// NEW:
body: JSON.stringify({ process_type: processType, feet_done: feet, operator_id: parseInt(weldingOperatorIds[processType]) }),
```

Also add a guard at the top of the function after the feet check:

```typescript
if (!weldingOperatorIds[processType]) {
  setErrorMsg("Select a worker before logging feet.");
  return;
}
```

- [ ] **Step 6: Verify in browser**

1. Start both servers.
2. Navigate to `/production/entry`.
3. Select a project that has work orders generated for today.
4. Open the Welding tab.
5. Confirm each process card (TIG/MIG/Grinding) shows a worker dropdown populated from today's work orders.
6. Select a worker, enter feet, submit — confirm success toast.
7. Select a project with NO work orders → confirm "Generate work orders first" warning and disabled button.

- [ ] **Step 7: Commit**

```bash
git add next-frontend/src/app/\(main\)/production/entry/page.tsx
git commit -m "feat(production): per-process worker dropdown driven by today's work orders"
```

---

## Task 5: Frontend — Add Actual ft column to Scheduler work orders table

**Files:**
- Modify: `next-frontend/src/app/(main)/scheduler/page.tsx`

**Interfaces:**
- Consumes: `WorkOrder.actual_feet` (already in the `WorkOrder` interface at line 23; already returned by the API)

- [ ] **Step 1: Add the column header**

Find the `<Th>` row in the work orders table (~line 470–480). Add after the `Target ft` header:

```tsx
<Th numeric>Actual ft</Th>
```

- [ ] **Step 2: Add the column cell**

Find the `<Td numeric>{wo.target_feet.toFixed(1)}</Td>` cell (~line 499). Add after it:

```tsx
<Td numeric>
  {wo.actual_feet != null ? (
    <span className={wo.actual_feet >= wo.target_feet ? "text-success font-bold" : "text-ink"}>
      {wo.actual_feet.toFixed(1)}
    </span>
  ) : (
    <span className="text-ink-soft">—</span>
  )}
</Td>
```

- [ ] **Step 3: Verify in browser**

Navigate to `/scheduler`, pick today's date. Confirm the "Actual ft" column appears. After logging welding feet in Task 4, refresh — confirm the actual feet update in real time.

- [ ] **Step 4: Commit**

```bash
git add next-frontend/src/app/\(main\)/scheduler/page.tsx
git commit -m "feat(scheduler): show actual ft vs target ft in work orders table"
```

---

## Task 6: Frontend — New `/productivity` page + Sidebar link

**Files:**
- Create: `next-frontend/src/app/(main)/productivity/page.tsx`
- Modify: `next-frontend/src/components/Sidebar.tsx`

**Interfaces:**
- Consumes: `GET /api/v1/scheduler/productivity?from_date=X&to_date=Y&user_id=Z&process_type=P` (from Task 3)

- [ ] **Step 1: Create the productivity page**

Create `next-frontend/src/app/(main)/productivity/page.tsx`:

```tsx
"use client";

import { useEffect, useState } from "react";
import { apiFetch } from "@/lib/apiFetch";
import { Card } from "@/components/ui/Card";
import { Select } from "@/components/ui/Select";
import { Label } from "@/components/ui/Label";
import { Button } from "@/components/ui/Button";
import { Table, Th, Td } from "@/components/ui/Table";
import { Badge } from "@/components/ui/Badge";
import { useRouter } from "next/navigation";

const API = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8003";

interface ProductivityRow {
  user_id: number;
  worker_name: string;
  process_type: string;
  target_feet: number;
  actual_feet: number;
  efficiency_pct: number;
  days_worked: number;
}

const ALLOWED_ROLES = ["Developer", "GM", "Admin", "Production Manager"];

function isoDate(d: Date) {
  return d.toISOString().split("T")[0];
}

function presetRange(preset: string): [string, string] {
  const today = new Date();
  if (preset === "week") {
    const start = new Date(today);
    start.setDate(today.getDate() - today.getDay() + 1); // Mon
    return [isoDate(start), isoDate(today)];
  }
  if (preset === "month") {
    return [`${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-01`, isoDate(today)];
  }
  return [isoDate(today), isoDate(today)]; // today
}

export default function ProductivityPage() {
  const router = useRouter();
  const [allowed, setAllowed] = useState(false);
  const [preset, setPreset] = useState("week");
  const [fromDate, setFromDate] = useState(() => presetRange("week")[0]);
  const [toDate, setToDate] = useState(() => presetRange("week")[1]);
  const [processType, setProcessType] = useState("");
  const [rows, setRows] = useState<ProductivityRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    const role = localStorage.getItem("user_role") ?? "";
    if (!ALLOWED_ROLES.includes(role)) { router.push("/dashboard"); return; }
    setAllowed(true);
  }, [router]);

  const fetchData = async () => {
    setLoading(true); setError("");
    try {
      const params = new URLSearchParams({ from_date: fromDate, to_date: toDate });
      if (processType) params.set("process_type", processType);
      const res = await apiFetch(`${API}/api/v1/scheduler/productivity?${params}`);
      if (!res.ok) { const e = await res.json(); throw new Error(e.detail || "Failed"); }
      setRows(await res.json());
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (allowed) fetchData();
  // ponytail: intentional — only re-fetch when allowed changes (manual fetch button handles the rest)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allowed]);

  const handlePreset = (p: string) => {
    setPreset(p);
    const [f, t] = presetRange(p);
    setFromDate(f); setToDate(t);
  };

  if (!allowed) return null;

  const totalTarget = rows.reduce((s, r) => s + r.target_feet, 0);
  const totalActual = rows.reduce((s, r) => s + r.actual_feet, 0);
  const overallEff = totalTarget > 0 ? Math.round((totalActual / totalTarget) * 100) : 0;

  const effTone = (pct: number) => pct >= 90 ? "success" : pct >= 70 ? "warning" : "critical";

  return (
    <div className="flex flex-col gap-6 p-6">
      <h1 className="text-2xl font-bold text-ink">Worker Productivity</h1>

      {/* Filters */}
      <Card className="flex flex-wrap items-end gap-4 p-4">
        <div>
          <Label>Period</Label>
          <div className="flex gap-2 mt-1">
            {["today", "week", "month"].map((p) => (
              <Button
                key={p}
                variant={preset === p ? "primary" : "secondary"}
                onClick={() => handlePreset(p)}
              >
                {p === "today" ? "Today" : p === "week" ? "This Week" : "This Month"}
              </Button>
            ))}
          </div>
        </div>
        <div>
          <Label>From</Label>
          <input
            type="date"
            className="mt-1 block rounded border border-line bg-paper px-3 py-2 text-sm text-ink"
            value={fromDate}
            onChange={(e) => { setPreset("custom"); setFromDate(e.target.value); }}
          />
        </div>
        <div>
          <Label>To</Label>
          <input
            type="date"
            className="mt-1 block rounded border border-line bg-paper px-3 py-2 text-sm text-ink"
            value={toDate}
            onChange={(e) => { setPreset("custom"); setToDate(e.target.value); }}
          />
        </div>
        <div>
          <Label>Process</Label>
          <Select value={processType} onChange={(e) => setProcessType(e.target.value)}>
            <option value="">All</option>
            <option value="TIG">TIG</option>
            <option value="MIG">MIG</option>
            <option value="Grinding">Grinding</option>
          </Select>
        </div>
        <Button variant="primary" onClick={fetchData} disabled={loading}>
          {loading ? "Loading…" : "Apply"}
        </Button>
      </Card>

      {/* Summary cards */}
      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        {[
          { label: "Target ft", value: totalTarget.toFixed(1) },
          { label: "Actual ft", value: totalActual.toFixed(1) },
          { label: "Overall Efficiency", value: `${overallEff}%` },
          { label: "Workers Tracked", value: String(new Set(rows.map((r) => r.user_id)).size) },
        ].map(({ label, value }) => (
          <Card key={label} className="p-4 text-center">
            <div className="text-xs font-bold uppercase tracking-wide text-ink-soft">{label}</div>
            <div className="font-data mt-1 text-2xl font-bold text-ink">{value}</div>
          </Card>
        ))}
      </div>

      {/* Table */}
      {error && <p className="text-sm text-critical">{error}</p>}
      {rows.length === 0 && !loading && (
        <p className="text-sm text-ink-soft">No data for the selected range.</p>
      )}
      {rows.length > 0 && (
        <Card>
          <Table>
            <thead>
              <tr>
                <Th>Worker</Th>
                <Th>Process</Th>
                <Th numeric>Target ft</Th>
                <Th numeric>Actual ft</Th>
                <Th numeric>Efficiency</Th>
                <Th numeric>Days Worked</Th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={i}>
                  <Td>{r.worker_name}</Td>
                  <Td><Badge tone="brand">{r.process_type}</Badge></Td>
                  <Td numeric>{r.target_feet.toFixed(1)}</Td>
                  <Td numeric>{r.actual_feet.toFixed(1)}</Td>
                  <Td numeric>
                    <Badge tone={effTone(r.efficiency_pct)}>{r.efficiency_pct.toFixed(1)}%</Badge>
                  </Td>
                  <Td numeric>{r.days_worked}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        </Card>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Add Productivity link to Sidebar**

In `next-frontend/src/components/Sidebar.tsx`, find the `Workforce` nav group (~line 47–53) and add the Productivity link:

```tsx
// OLD:
{
  label: "Workforce",
  items: [
    { name: "Workforce Intelligence", href: "/workforce" },
    { name: "User Management", href: "/operators" },
  ],
},

// NEW:
{
  label: "Workforce",
  items: [
    { name: "Workforce Intelligence", href: "/workforce" },
    { name: "Productivity", href: "/productivity", hideForRoles: ["Supervisor", "Operator"] },
    { name: "User Management", href: "/operators" },
  ],
},
```

- [ ] **Step 3: Verify `hideForRoles` is applied in Sidebar render**

Confirm the Sidebar's `NavGroup` rendering already filters by `hideForRoles`. Look for it in the render block (~line 105–137). If the filter is applied, you're done. If not, find where items are mapped and add:

```tsx
.filter((item) => !item.hideForRoles || !item.hideForRoles.includes(role ?? ""))
```

- [ ] **Step 4: Verify in browser**

1. Log in as GM/Admin — confirm "Productivity" appears in sidebar under Workforce.
2. Navigate to `/productivity` — confirm the page loads with a table.
3. Log in as Supervisor — confirm "Productivity" is hidden in sidebar and `/productivity` redirects to `/dashboard`.
4. Change preset to "Today", "This Month" — confirm date range updates and Apply re-fetches.
5. Filter by process type "TIG" — confirm only TIG rows appear.

- [ ] **Step 5: Commit**

```bash
git add next-frontend/src/app/\(main\)/productivity/page.tsx next-frontend/src/components/Sidebar.tsx
git commit -m "feat(productivity): add worker productivity dashboard page"
```

---

## Task 7: Push to demo + smoke test end-to-end

- [ ] **Step 1: Push to demo**

```bash
git push origin demo
```

- [ ] **Step 2: Wait for Railway deploy, then test end-to-end**

Full flow to verify on the demo deployment:

1. **Generate work orders**: Go to `/workforce`, mark attendance for today, click Generate Work Orders.
2. **Verify work orders**: Go to `/scheduler` — confirm workers appear with target_feet and `Actual ft` column shows `—`.
3. **Log welding feet**: Go to `/production/entry`, select the same project, open Welding tab. Confirm the worker dropdown is populated per-process-type.
4. **Select a worker + enter feet + submit**: Confirm success message.
5. **Check scheduler**: Refresh `/scheduler` — confirm that worker's Actual ft now shows the logged value.
6. **Check productivity**: Go to `/productivity`, set range to Today, click Apply — confirm the worker appears with correct target/actual/efficiency.

- [ ] **Step 3: Notify user for manual verification and merge approval**

Report the demo URL and the test results to the user. Do NOT merge to `main` — wait for explicit approval.
