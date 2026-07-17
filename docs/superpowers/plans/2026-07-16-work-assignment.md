# Work Assignment Feature — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `WorkOrder` + `ChangeRequest` tables, a material-gated generate-work-orders algorithm, 7 new API endpoints, and a replacement `/scheduler` frontend page with supervisor-proposes/PM-approves workflow.

**Architecture:** New `work_orders` and `change_requests` tables are added purely additively (no existing tables touched). The scheduler `router.py` gains helpers and 7 endpoints alongside existing ones. The existing `DailyTaskAssignment` logic is left intact. The frontend page replaces `next-frontend/src/app/(main)/scheduler/page.tsx` entirely.

**Tech Stack:** FastAPI, SQLAlchemy (PostgreSQL), Pydantic v1, Next.js (App Router), TypeScript, Tailwind CSS with existing `@/components/ui` design system.

## Global Constraints

- PostgreSQL only — no SQLite.
- New Python packages go in root `requirements.txt` only.
- Push to `demo` branch only; never merge to `main` without PM approval.
- Role strings: `"Developer"`, `"GM"`, `"Admin"`, `"Production Manager"`, `"Supervisor"`, `"Operator"`.
- Never `alert()`/`confirm()`/`prompt()` in frontend — use `useConfirm`/`useToast`/`Modal`.
- Never interpolate Tailwind class names at runtime — use static string maps.
- `Th numeric` and `Td numeric` must appear together on the same column.
- `current_user` dict from `require_roles` has at minimum: `{"id": int, "role": str, "full_name": str}`.

---

## File Map

| Action | Path | Responsibility |
|---|---|---|
| Modify | `backend/services/db_service.py` | Add `WorkOrder`, `ChangeRequest` SQLAlchemy models |
| Modify | `backend/app/scheduler/schemas.py` | Add Pydantic schemas for WorkOrder + ChangeRequest |
| Modify | `backend/app/scheduler/router.py` | Add helpers + 8 new endpoints (generate, list, complete, employees, CR CRUD) |
| Create | `test_work_orders.py` | 5 self-contained unit tests (no pytest, no fixtures) |
| Replace | `next-frontend/src/app/(main)/scheduler/page.tsx` | New Work Orders page with tabs + modals |
| Modify | `next-frontend/src/components/Sidebar.tsx` line 34 | Rename "Daily Scheduler" → "Work Orders" |

---

## Task 1: DB Models — WorkOrder + ChangeRequest

**Files:**
- Modify: `backend/services/db_service.py`

**Interfaces:**
- Produces: `WorkOrder` class, `ChangeRequest` class — importable as `from backend.services.db_service import WorkOrder, ChangeRequest`

- [ ] **Step 1: Add `Index` to the SQLAlchemy import line**

In `backend/services/db_service.py`, change line 3:
```python
# Before:
from sqlalchemy import create_engine, Column, Integer, String, Float, Boolean, DateTime, Date, ForeignKey, Text, UniqueConstraint
# After:
from sqlalchemy import create_engine, Column, Integer, String, Float, Boolean, DateTime, Date, ForeignKey, Text, UniqueConstraint, Index
```

- [ ] **Step 2: Add `WorkOrder` model**

Insert this class directly before the `class CompanyResourcePool` block (after `class Employee`):

```python
class WorkOrder(Base):
    __tablename__ = "work_orders"
    id = Column(Integer, primary_key=True, index=True)
    project_id = Column(Integer, ForeignKey("projects.id"), nullable=False)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    part_id = Column(Integer, ForeignKey("parts.id"), nullable=True)
    date = Column(Date, default=date.today, nullable=False)
    process_type = Column(String, nullable=False)   # TIG | MIG | Grinding
    target_feet = Column(Float, nullable=False)
    actual_feet = Column(Float, nullable=True)
    is_overtime = Column(Boolean, default=False)
    status = Column(String, default="Pending")      # Pending | Completed | Blocked
    completed_part_process_id = Column(Integer, ForeignKey("part_processes.id"), nullable=True)
    notes = Column(Text, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)

    project = relationship("Project")
    user = relationship("User")
    part = relationship("Part")
    completed_part_process = relationship("PartProcess")

    __table_args__ = (
        Index("ix_work_orders_date_user", "date", "user_id"),
        Index("ix_work_orders_date_project", "date", "project_id"),
    )
```

- [ ] **Step 3: Add `ChangeRequest` model**

Insert directly after `WorkOrder`, still before `CompanyResourcePool`:

```python
class ChangeRequest(Base):
    __tablename__ = "change_requests"
    id = Column(Integer, primary_key=True, index=True)
    subject_type = Column(String, nullable=False)   # daily_plan_override | employee_profile
    subject_id = Column(Integer, nullable=True)     # Employee.id for employee_profile; null for daily_plan_override
    target_date = Column(Date, nullable=True)       # which day the daily_plan_override applies to
    proposed_by = Column(Integer, ForeignKey("users.id"), nullable=False)
    approved_by = Column(Integer, ForeignKey("users.id"), nullable=True)
    status = Column(String, default="pending_approval")  # pending_approval | approved | rejected
    changes_json = Column(Text, nullable=False)
    rejection_note = Column(Text, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    resolved_at = Column(DateTime, nullable=True)

    proposer = relationship("User", foreign_keys=[proposed_by])
    approver_user = relationship("User", foreign_keys=[approved_by])
```

- [ ] **Step 4: Verify with py_compile**

```bash
python -m py_compile backend/services/db_service.py && echo "OK"
```
Expected: `OK`

- [ ] **Step 5: Verify tables are created on startup**

```bash
python -c "
from backend.services.db_service import WorkOrder, ChangeRequest, Base, engine
Base.metadata.create_all(engine)
from sqlalchemy import inspect
insp = inspect(engine)
print('work_orders' in insp.get_table_names())
print('change_requests' in insp.get_table_names())
"
```
Expected: two lines of `True`

- [ ] **Step 6: Commit**

```bash
git add backend/services/db_service.py
git commit -m "feat(scheduler): add WorkOrder and ChangeRequest DB models"
```

---

## Task 2: Pydantic Schemas

**Files:**
- Modify: `backend/app/scheduler/schemas.py`

**Interfaces:**
- Consumes: `WorkOrder`, `ChangeRequest` models from Task 1
- Produces: `WorkOrderResponse`, `WorkOrderComplete`, `ChangeRequestCreate`, `ChangeRequestResponse`, `ChangeRequestReject`, `SimplePartProcess`, `SimpleProductionLine`, `SimplePartWithProcesses`

- [ ] **Step 1: Replace the entire contents of `backend/app/scheduler/schemas.py`**

```python
from pydantic import BaseModel
from typing import Optional, List
from datetime import date, datetime


class SimpleUser(BaseModel):
    id: int
    full_name: Optional[str]
    base_productivity: Optional[float] = None

    class Config:
        orm_mode = True


class SimpleProject(BaseModel):
    id: int
    quotation_no: str

    class Config:
        orm_mode = True


class SimplePartProcess(BaseModel):
    id: int
    process_name: str
    status: str

    class Config:
        orm_mode = True


class SimpleProductionLine(BaseModel):
    id: int
    size: Optional[int]
    joint_type: Optional[str]

    class Config:
        orm_mode = True


class SimplePartWithProcesses(BaseModel):
    id: int
    name: str
    production_line: Optional[SimpleProductionLine] = None
    processes: List[SimplePartProcess] = []

    class Config:
        orm_mode = True


# ── WorkOrder schemas ──────────────────────────────────────────────────────────

class TaskAssignmentCreate(BaseModel):
    """Legacy schema kept for existing /assignments endpoint."""
    project_id: int
    user_id: int
    process_type: str
    date: date
    target_feet: float
    status: Optional[str] = "Pending"
    is_overtime: Optional[bool] = False
    notes: Optional[str] = None


class TaskAssignmentResponse(BaseModel):
    """Legacy schema kept for existing /assignments endpoint."""
    id: int
    project_id: int
    user_id: int
    process_type: str
    date: date
    target_feet: float
    status: str
    is_overtime: bool
    notes: Optional[str]
    created_at: datetime
    user: Optional[SimpleUser] = None
    project: Optional[SimpleProject] = None

    class Config:
        orm_mode = True


class WorkOrderResponse(BaseModel):
    id: int
    project_id: int
    user_id: int
    part_id: Optional[int]
    date: date
    process_type: str
    target_feet: float
    actual_feet: Optional[float]
    is_overtime: bool
    status: str
    completed_part_process_id: Optional[int]
    notes: Optional[str]
    created_at: datetime
    user: Optional[SimpleUser] = None
    project: Optional[SimpleProject] = None
    part: Optional[SimplePartWithProcesses] = None

    class Config:
        orm_mode = True


class WorkOrderComplete(BaseModel):
    actual_feet: float
    status: str = "Completed"
    mark_step_ready: bool = False
    part_process_id: Optional[int] = None
    notes: Optional[str] = None


# ── ChangeRequest schemas ──────────────────────────────────────────────────────

class ChangeRequestCreate(BaseModel):
    subject_type: str          # "daily_plan_override" | "employee_profile"
    subject_id: Optional[int] = None
    target_date: Optional[date] = None
    changes_json: str          # JSON string


class ChangeRequestResponse(BaseModel):
    id: int
    subject_type: str
    subject_id: Optional[int]
    target_date: Optional[date]
    proposed_by: int
    approved_by: Optional[int]
    status: str
    changes_json: str
    rejection_note: Optional[str]
    created_at: datetime
    resolved_at: Optional[datetime]
    proposer: Optional[SimpleUser] = None

    class Config:
        orm_mode = True


class ChangeRequestReject(BaseModel):
    rejection_note: str
```

- [ ] **Step 2: Verify with py_compile**

```bash
python -m py_compile backend/app/scheduler/schemas.py && echo "OK"
```
Expected: `OK`

- [ ] **Step 3: Commit**

```bash
git add backend/app/scheduler/schemas.py
git commit -m "feat(scheduler): add WorkOrder and ChangeRequest Pydantic schemas"
```

---

## Task 3: Backend — Helpers + generate-work-orders endpoint

**Files:**
- Modify: `backend/app/scheduler/router.py`

**Interfaces:**
- Consumes: `WorkOrder`, `ChangeRequest`, `Employee`, `WarehouseStock`, `Part`, `PartProcess`, `ProjectResourceAssignment` from `db_service`; `WorkOrderResponse`, `WorkOrderComplete`, `ChangeRequestCreate`, `ChangeRequestResponse`, `ChangeRequestReject` from `schemas`
- Produces: `POST /api/v1/scheduler/generate-work-orders`, helper functions `_available_stock_local`, `find_available_part`

- [ ] **Step 1: Replace the top import block of `backend/app/scheduler/router.py`**

```python
import json
import logging
from datetime import date, datetime
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import asc
from sqlalchemy.orm import Session, joinedload

from backend.app.auth.rbac import require_roles
from backend.app.scheduler.schemas import (
    TaskAssignmentCreate, TaskAssignmentResponse,
    WorkOrderResponse, WorkOrderComplete,
    ChangeRequestCreate, ChangeRequestResponse, ChangeRequestReject,
)
from backend.services.db_service import (
    get_db,
    AttendanceLog, ChangeRequest, DailyTaskAssignment, Employee,
    Part, PartProcess, Project, ProjectResourceAssignment,
    User, WarehouseStock, WorkOrder,
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/v1/scheduler", tags=["Scheduler"])
```

- [ ] **Step 2: Add the `PROCESS_TYPE_TO_STEPS` constant and helper functions**

Add this block immediately after the `router = APIRouter(...)` line:

```python
# Maps work order process_type → PartProcess step names that represent that work.
# ponytail: strawman mapping — confirm with GM before changing.
PROCESS_TYPE_TO_STEPS = {
    "TIG":      ["Welding"],
    "MIG":      ["Welding"],
    "Grinding": ["Grinding", "DP test"],
}


def _available_stock_local(db: Session, material_name: str, size: int, joint_type: str) -> int:
    """Return warehouse available qty (on_hand - reserved). 0 if no record found."""
    stock = db.query(WarehouseStock).filter_by(
        material_name=material_name,
        size=size,
        joint_type=joint_type,
    ).first()
    if not stock:
        return 0
    return max(0, stock.qty_on_hand - stock.reserved_qty)


def find_available_part(db: Session, project: Project, process_type: str):
    """
    Return the first Part in the project that has:
      - available warehouse stock (qty_on_hand - reserved_qty > 0)
      - at least one PartProcess step matching PROCESS_TYPE_TO_STEPS[process_type]
        that is not yet 'ready'
    Returns None if no such part exists (work order still created, part_id=None).
    """
    relevant_steps = PROCESS_TYPE_TO_STEPS.get(process_type, [])
    for line in project.production_lines:
        size = line.size or 0
        joint_type = line.joint_type or ""
        for part in line.parts:
            avail = _available_stock_local(db, part.name, size, joint_type)
            if avail > 0:
                for proc in part.processes:
                    if proc.process_name in relevant_steps and proc.status != "ready":
                        return part
    return None
```

- [ ] **Step 3: Add the `generate_work_orders` endpoint**

Add this endpoint after the helper functions and before the existing `@router.get("/assignments", ...)` endpoint:

```python
@router.post("/generate-work-orders")
def generate_work_orders(
    target_date: date,
    db: Session = Depends(get_db),
    current_user: dict = Depends(require_roles(["Developer", "GM", "Admin", "Production Manager"])),
):
    from backend.services.mes_service import MESService
    from backend.services.production_service import aggregate_line_feet

    # Clear existing work orders for this date
    db.query(WorkOrder).filter(WorkOrder.date == target_date).delete()
    db.commit()

    # Step 1: Get present workers
    any_logs = db.query(AttendanceLog).filter(AttendanceLog.date == target_date).first()
    if any_logs:
        present_logs = db.query(AttendanceLog).filter(
            AttendanceLog.date == target_date,
            AttendanceLog.status.in_(["Present", "Overtime"]),
        ).all()
        present_user_ids = [log.user_id for log in present_logs]
        if not present_user_ids:
            return {"success": False, "message": "Attendance marked but no workers present.", "orders_created": 0}
        workers = db.query(User).filter(
            User.id.in_(present_user_ids),
            User.role == "Operator",
        ).all()
    else:
        workers = db.query(User).filter(User.role == "Operator").all()
        if not workers:
            return {"success": False, "message": "No operators found.", "orders_created": 0}

    workers.sort(key=lambda w: w.base_productivity or 0, reverse=True)

    # Step 2: Apply approved daily_plan_override ChangeRequests
    overrides = db.query(ChangeRequest).filter_by(
        subject_type="daily_plan_override",
        target_date=target_date,
        status="approved",
    ).all()

    exclude_ids: set = set()
    capacity_overrides: dict = {}
    for cr in overrides:
        changes = json.loads(cr.changes_json)
        exclude_ids.update(changes.get("exclude_user_ids", []))
        for uid_str, cap in changes.get("capacity_overrides", {}).items():
            capacity_overrides[int(uid_str)] = float(cap)

    workers = [w for w in workers if w.id not in exclude_ids]
    if not workers:
        return {"success": False, "message": "All workers excluded by approved overrides.", "orders_created": 0}

    # Step 3: Build worker_map and worker_skills_map
    employees = db.query(Employee).all()
    emp_map = {e.name: e for e in employees}

    worker_map: dict = {}
    worker_skills_map: dict = {}
    for w in workers:
        emp = emp_map.get(w.full_name)
        target = capacity_overrides.get(w.id, w.base_productivity or 50.0)
        skills = []

        if emp:
            raw_skills = [emp.skill_1, emp.skill_2, emp.skill_3, emp.skill_4]
            skills = [(i, s) for i, s in enumerate(raw_skills) if s]
            if w.id not in capacity_overrides:
                target = emp.target_per_day
        elif w.skill:
            skills = [(0, w.skill)]

        worker_map[w.id] = {
            "user_id": w.id,
            "base_productivity": target,
            "remaining_capacity": target,
            "assigned_feet": 0.0,
            "ot_remaining_capacity": target * 0.5,
        }
        worker_skills_map[w.id] = skills

    # Step 4: Get active projects ordered by priority (P1 < P2 < P3 < null, then deadline, then age)
    projects = db.query(Project).filter(
        Project.status == "Active",
        Project.hold_until_date == None,
    ).order_by(
        asc(Project.priority),
        asc(Project.target_date),
        asc(Project.created_at),
    ).all()

    if not projects:
        return {"success": True, "message": "No active projects.", "orders_created": 0, "workers_assigned": 0, "no_stock_projects": []}

    # Step 5: Compute pacing requirements per project
    today = date.today()
    project_requirements = []
    no_stock_projects: list = []

    for p in projects:
        total_tig, total_mig, total_grind = aggregate_line_feet(p.production_lines)
        total_feet = total_tig + total_mig + total_grind
        if total_feet == 0:
            continue

        assignment = db.query(ProjectResourceAssignment).filter_by(project_id=p.id).first()
        target_days = (assignment.target_days if assignment and assignment.target_days else 15)
        base_daily_target = total_feet / target_days

        created_date = p.created_at.date() if hasattr(p.created_at, "date") else p.created_at
        days_elapsed = max(0, (today - created_date).days)
        expected_completed = min(total_feet, base_daily_target * days_elapsed)
        progress_pct = MESService.calculate_project_progress(db, p.id)
        actual_completed = total_feet * (progress_pct / 100)
        backlog = max(0, expected_completed - actual_completed)
        today_req = base_daily_target + backlog

        if today_req <= 0:
            continue

        project_requirements.append({
            "project": p,
            "remaining_TIG": today_req * (total_tig / total_feet),
            "remaining_MIG": today_req * (total_mig / total_feet),
            "remaining_GRINDING": today_req * (total_grind / total_feet),
        })

    if not project_requirements:
        return {"success": True, "message": "No pacing requirements today.", "orders_created": 0, "workers_assigned": len(worker_map), "no_stock_projects": []}

    # Step 6: Assignment loop — MIG → TIG → GRIND, tiers 0-3 + overtime
    orders_created = 0
    process_order = [
        ("MIG",   "remaining_MIG",       "MIG"),
        ("TIG",   "remaining_TIG",       "TIG"),
        ("GRIND", "remaining_GRINDING",  "Grinding"),
    ]

    for skill_keyword, req_key, process_type in process_order:
        # Normal shift: tier 0 first (primary skill), then 1, 2, 3
        for tier in range(4):
            tier_workers = [
                worker_map[uid]
                for uid, skills in worker_skills_map.items()
                for lvl, s in skills
                if lvl == tier and skill_keyword in s.upper()
            ]
            tier_workers.sort(key=lambda w: w["remaining_capacity"], reverse=True)
            req_index = 0

            for w in tier_workers:
                while w["remaining_capacity"] > 0 and req_index < len(project_requirements):
                    req = project_requirements[req_index]
                    if req[req_key] <= 0:
                        req_index += 1
                        continue

                    assigned_feet = min(w["remaining_capacity"], req[req_key])
                    part = find_available_part(db, req["project"], process_type)
                    if part is None and req["project"].quotation_no not in no_stock_projects:
                        no_stock_projects.append(req["project"].quotation_no)

                    wo = WorkOrder(
                        project_id=req["project"].id,
                        user_id=w["user_id"],
                        part_id=part.id if part else None,
                        date=target_date,
                        process_type=process_type,
                        target_feet=assigned_feet,
                        is_overtime=False,
                        status="Pending",
                    )
                    db.add(wo)
                    orders_created += 1

                    w["assigned_feet"] += assigned_feet
                    w["remaining_capacity"] -= assigned_feet
                    req[req_key] -= assigned_feet

                    if req[req_key] <= 0:
                        req_index += 1

        # Overtime: if any requirement for this process type remains unfulfilled
        has_pending = any(req[req_key] > 0 for req in project_requirements)
        if has_pending:
            ot_workers = [
                worker_map[uid]
                for uid, skills in worker_skills_map.items()
                if any(skill_keyword in s.upper() for _, s in skills)
            ]
            ot_workers.sort(key=lambda w: w["base_productivity"], reverse=True)
            req_index = 0

            for w in ot_workers:
                while w["ot_remaining_capacity"] > 0 and req_index < len(project_requirements):
                    req = project_requirements[req_index]
                    if req[req_key] <= 0:
                        req_index += 1
                        continue

                    assigned_ot = min(w["ot_remaining_capacity"], req[req_key])
                    part = find_available_part(db, req["project"], process_type)

                    wo = WorkOrder(
                        project_id=req["project"].id,
                        user_id=w["user_id"],
                        part_id=part.id if part else None,
                        date=target_date,
                        process_type=process_type,
                        target_feet=assigned_ot,
                        is_overtime=True,
                        status="Pending",
                    )
                    db.add(wo)
                    orders_created += 1

                    w["ot_remaining_capacity"] -= assigned_ot
                    req[req_key] -= assigned_ot

                    if req[req_key] <= 0:
                        req_index += 1

    db.commit()
    return {
        "success": True,
        "message": f"Generated {orders_created} work orders for {len(worker_map)} workers.",
        "orders_created": orders_created,
        "workers_assigned": len(worker_map),
        "no_stock_projects": no_stock_projects,
    }
```

- [ ] **Step 4: Verify with py_compile**

```bash
python -m py_compile backend/app/scheduler/router.py && echo "OK"
```
Expected: `OK`

- [ ] **Step 5: Smoke-test the endpoint registers (server must be stopped first)**

```bash
python -c "
from backend.app.scheduler.router import router
routes = [r.path for r in router.routes]
print('/api/v1/scheduler/generate-work-orders' in routes)
"
```
Expected: `True`

- [ ] **Step 6: Commit**

```bash
git add backend/app/scheduler/router.py
git commit -m "feat(scheduler): add generate-work-orders endpoint with material gate"
```

---

## Task 4: Backend — GET/PATCH work-orders + GET employees endpoints

**Files:**
- Modify: `backend/app/scheduler/router.py`

**Interfaces:**
- Consumes: `WorkOrderResponse`, `WorkOrderComplete` from schemas; `WorkOrder`, `Part`, `PartProcess` from db_service
- Produces: `GET /api/v1/scheduler/work-orders`, `PATCH /api/v1/scheduler/work-orders/{id}`, `GET /api/v1/scheduler/employees`

- [ ] **Step 1: Add the GET work-orders endpoint**

Append to `backend/app/scheduler/router.py` (after `generate_work_orders`):

```python
@router.get("/work-orders", response_model=List[WorkOrderResponse])
def get_work_orders(
    target_date: Optional[date] = None,
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
    return query.order_by(asc(WorkOrder.user_id), asc(WorkOrder.process_type)).all()
```

- [ ] **Step 2: Add the PATCH work-orders/{id} endpoint**

```python
@router.patch("/work-orders/{work_order_id}", response_model=WorkOrderResponse)
def complete_work_order(
    work_order_id: int,
    payload: WorkOrderComplete,
    db: Session = Depends(get_db),
    current_user: dict = Depends(require_roles(["Developer", "GM", "Admin", "Production Manager", "Supervisor"])),
):
    wo = db.query(WorkOrder).filter(WorkOrder.id == work_order_id).first()
    if not wo:
        raise HTTPException(status_code=404, detail="Work order not found")

    wo.actual_feet = payload.actual_feet
    wo.status = payload.status
    if payload.notes is not None:
        wo.notes = payload.notes

    if payload.mark_step_ready and payload.part_process_id:
        proc = db.query(PartProcess).filter(PartProcess.id == payload.part_process_id).first()
        if proc:
            proc.status = "ready"
            proc.date_ready = date.today()
            wo.completed_part_process_id = payload.part_process_id

    db.commit()
    db.refresh(wo)
    return wo
```

- [ ] **Step 3: Add the GET employees endpoint**

```python
@router.get("/employees")
def get_employees(
    db: Session = Depends(get_db),
    current_user: dict = Depends(require_roles(["Developer", "GM", "Admin", "Production Manager", "Supervisor"])),
):
    employees = db.query(Employee).order_by(Employee.name).all()
    return [
        {
            "id": e.id,
            "emp_id": e.emp_id,
            "name": e.name,
            "company": e.company,
            "skill_1": e.skill_1,
            "skill_2": e.skill_2,
            "skill_3": e.skill_3,
            "skill_4": e.skill_4,
            "target_per_day": e.target_per_day,
            "active": e.active,
        }
        for e in employees
    ]
```

- [ ] **Step 4: Verify with py_compile**

```bash
python -m py_compile backend/app/scheduler/router.py && echo "OK"
```
Expected: `OK`

- [ ] **Step 5: Commit**

```bash
git add backend/app/scheduler/router.py
git commit -m "feat(scheduler): add GET/PATCH work-orders and GET employees endpoints"
```

---

## Task 5: Backend — ChangeRequest CRUD endpoints

**Files:**
- Modify: `backend/app/scheduler/router.py`

**Interfaces:**
- Consumes: `ChangeRequestCreate`, `ChangeRequestResponse`, `ChangeRequestReject` from schemas; `ChangeRequest`, `Employee` from db_service
- Produces: `POST /api/v1/scheduler/change-requests`, `GET /api/v1/scheduler/change-requests`, `PATCH /api/v1/scheduler/change-requests/{id}/approve`, `PATCH /api/v1/scheduler/change-requests/{id}/reject`

- [ ] **Step 1: Add POST change-requests endpoint**

Append to `backend/app/scheduler/router.py`:

```python
@router.post("/change-requests", response_model=ChangeRequestResponse)
def create_change_request(
    payload: ChangeRequestCreate,
    db: Session = Depends(get_db),
    current_user: dict = Depends(require_roles(["Developer", "GM", "Admin", "Production Manager", "Supervisor"])),
):
    cr = ChangeRequest(
        subject_type=payload.subject_type,
        subject_id=payload.subject_id,
        target_date=payload.target_date,
        proposed_by=current_user["id"],
        changes_json=payload.changes_json,
        status="pending_approval",
    )
    db.add(cr)
    db.commit()
    db.refresh(cr)
    return cr
```

- [ ] **Step 2: Add GET change-requests endpoint**

```python
@router.get("/change-requests", response_model=List[ChangeRequestResponse])
def get_change_requests(
    status: Optional[str] = "pending_approval",
    target_date: Optional[date] = None,
    db: Session = Depends(get_db),
    current_user: dict = Depends(require_roles(["Developer", "GM", "Admin", "Production Manager", "Supervisor"])),
):
    query = db.query(ChangeRequest).options(joinedload(ChangeRequest.proposer))

    # Supervisors may only see their own requests
    if current_user.get("role") == "Supervisor":
        query = query.filter(ChangeRequest.proposed_by == current_user["id"])

    if status:
        query = query.filter(ChangeRequest.status == status)
    if target_date:
        query = query.filter(ChangeRequest.target_date == target_date)

    return query.order_by(ChangeRequest.created_at.desc()).all()
```

- [ ] **Step 3: Add PATCH approve endpoint**

```python
@router.patch("/change-requests/{cr_id}/approve", response_model=ChangeRequestResponse)
def approve_change_request(
    cr_id: int,
    db: Session = Depends(get_db),
    current_user: dict = Depends(require_roles(["Developer", "GM", "Admin", "Production Manager"])),
):
    cr = db.query(ChangeRequest).filter(ChangeRequest.id == cr_id).first()
    if not cr:
        raise HTTPException(status_code=404, detail="Change request not found")
    if cr.status != "pending_approval":
        raise HTTPException(status_code=400, detail="Change request is not pending")

    cr.status = "approved"
    cr.approved_by = current_user["id"]
    cr.resolved_at = datetime.utcnow()

    # For employee_profile: apply changes to Employee record immediately
    if cr.subject_type == "employee_profile" and cr.subject_id:
        emp = db.query(Employee).filter(Employee.id == cr.subject_id).first()
        if emp:
            changes = json.loads(cr.changes_json).get("changes", {})
            allowed = {"skill_1", "skill_2", "skill_3", "skill_4", "target_per_day", "active"}
            for field, value in changes.items():
                if field in allowed:
                    setattr(emp, field, value)

    db.commit()
    db.refresh(cr)
    return cr
```

- [ ] **Step 4: Add PATCH reject endpoint**

```python
@router.patch("/change-requests/{cr_id}/reject", response_model=ChangeRequestResponse)
def reject_change_request(
    cr_id: int,
    payload: ChangeRequestReject,
    db: Session = Depends(get_db),
    current_user: dict = Depends(require_roles(["Developer", "GM", "Admin", "Production Manager"])),
):
    cr = db.query(ChangeRequest).filter(ChangeRequest.id == cr_id).first()
    if not cr:
        raise HTTPException(status_code=404, detail="Change request not found")
    if cr.status != "pending_approval":
        raise HTTPException(status_code=400, detail="Change request is not pending")

    cr.status = "rejected"
    cr.approved_by = current_user["id"]
    cr.rejection_note = payload.rejection_note
    cr.resolved_at = datetime.utcnow()

    db.commit()
    db.refresh(cr)
    return cr
```

- [ ] **Step 5: Verify with py_compile**

```bash
python -m py_compile backend/app/scheduler/router.py && echo "OK"
```
Expected: `OK`

- [ ] **Step 6: Commit**

```bash
git add backend/app/scheduler/router.py
git commit -m "feat(scheduler): add ChangeRequest CRUD endpoints (propose/list/approve/reject)"
```

---

## Task 6: Tests

**Files:**
- Create: `test_work_orders.py` (project root, alongside `test_priority_score.py`)

**Interfaces:**
- Consumes: `WorkOrder`, `ChangeRequest` from `backend.services.db_service`; `find_available_part` from `backend.app.scheduler.router`

- [ ] **Step 1: Write the test file**

Create `test_work_orders.py` in the project root:

```python
"""Self-contained tests for Work Assignment feature. No pytest, no fixtures."""
import json
from datetime import date

from backend.services.db_service import WorkOrder, ChangeRequest, SessionLocal


def test_work_order_defaults():
    wo = WorkOrder(
        project_id=1,
        user_id=1,
        date=date.today(),
        process_type="TIG",
        target_feet=15.0,
    )
    assert wo.status == "Pending"
    assert wo.is_overtime is False
    assert wo.actual_feet is None
    assert wo.part_id is None
    assert wo.completed_part_process_id is None
    print("PASS: WorkOrder defaults correct")


def test_change_request_defaults():
    cr = ChangeRequest(
        subject_type="employee_profile",
        subject_id=3,
        proposed_by=1,
        changes_json=json.dumps({"changes": {"skill_1": "TIG Welding"}}),
    )
    assert cr.status == "pending_approval"
    assert cr.rejection_note is None
    assert cr.resolved_at is None
    print("PASS: ChangeRequest defaults correct")


def test_find_available_part_empty_project():
    """find_available_part returns None for a project with no production lines."""
    from backend.app.scheduler.router import find_available_part

    class FakeProject:
        production_lines = []

    db = SessionLocal()
    try:
        result = find_available_part(db, FakeProject(), "TIG")
        assert result is None
        print("PASS: find_available_part returns None for empty project")
    finally:
        db.close()


def test_employee_profile_changes_json():
    changes = {
        "employee_id": 3,
        "changes": {"skill_1": "TIG Welding", "target_per_day": 65.0, "active": True},
    }
    cr = ChangeRequest(
        subject_type="employee_profile",
        subject_id=3,
        proposed_by=1,
        changes_json=json.dumps(changes),
    )
    parsed = json.loads(cr.changes_json)
    assert "changes" in parsed
    assert parsed["changes"]["skill_1"] == "TIG Welding"
    assert parsed["changes"]["target_per_day"] == 65.0
    print("PASS: employee_profile changes_json structure valid")


def test_daily_plan_override_json():
    changes = {
        "exclude_user_ids": [5, 12],
        "capacity_overrides": {"3": 60.0},
        "notes": "Worker on leave",
    }
    cr = ChangeRequest(
        subject_type="daily_plan_override",
        target_date=date.today(),
        proposed_by=1,
        changes_json=json.dumps(changes),
    )
    parsed = json.loads(cr.changes_json)
    assert 5 in parsed["exclude_user_ids"]
    assert "3" in parsed["capacity_overrides"]
    print("PASS: daily_plan_override changes_json structure valid")


if __name__ == "__main__":
    test_work_order_defaults()
    test_change_request_defaults()
    test_find_available_part_empty_project()
    test_employee_profile_changes_json()
    test_daily_plan_override_json()
    print("\nAll work order tests passed.")
```

- [ ] **Step 2: Run the tests**

```bash
python test_work_orders.py
```
Expected output:
```
PASS: WorkOrder defaults correct
PASS: ChangeRequest defaults correct
PASS: find_available_part returns None for empty project
PASS: employee_profile changes_json structure valid
PASS: daily_plan_override changes_json structure valid

All work order tests passed.
```

- [ ] **Step 3: Commit**

```bash
git add test_work_orders.py
git commit -m "test(scheduler): add work order self-contained tests"
```

---

## Task 7: Frontend — Replace /scheduler page + update Sidebar

**Files:**
- Replace: `next-frontend/src/app/(main)/scheduler/page.tsx`
- Modify: `next-frontend/src/components/Sidebar.tsx` (line 34)

**Interfaces:**
- Consumes: All 8 new endpoints from Tasks 3–5; design system components from `@/components/ui`

- [ ] **Step 1: Update Sidebar label**

In `next-frontend/src/components/Sidebar.tsx` at line 34, change `"Daily Scheduler"` to `"Work Orders"`:

```tsx
// Before:
{ name: "Daily Scheduler", href: "/scheduler" },
// After:
{ name: "Work Orders", href: "/scheduler" },
```

- [ ] **Step 2: Replace the entire page**

Replace the full contents of `next-frontend/src/app/(main)/scheduler/page.tsx`:

```tsx
"use client";
import { useState, useEffect } from "react";
import { apiFetch } from "@/lib/api";
import {
  Card, CardHeader, Table, THead, TBody, Tr, Th, Td,
  Badge, Button, Input, Select, Textarea, Label,
  Modal, Alert, Spinner, EmptyState,
  useConfirm, useToast,
} from "@/components/ui";

const API = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8003";

// ── Types ───────────────────────────────────────────────────────────────────

interface WorkOrder {
  id: number;
  project_id: number;
  user_id: number;
  part_id: number | null;
  date: string;
  process_type: string;
  target_feet: number;
  actual_feet: number | null;
  is_overtime: boolean;
  status: string;
  completed_part_process_id: number | null;
  notes: string | null;
  user?: { id: number; full_name: string | null };
  project?: { id: number; quotation_no: string };
  part?: {
    id: number;
    name: string;
    production_line?: { size: number | null; joint_type: string | null };
    processes: Array<{ id: number; process_name: string; status: string }>;
  };
}

interface ChangeRequest {
  id: number;
  subject_type: string;
  subject_id: number | null;
  target_date: string | null;
  proposed_by: number;
  status: string;
  changes_json: string;
  rejection_note: string | null;
  created_at: string;
  proposer?: { id: number; full_name: string | null };
}

interface Employee {
  id: number;
  emp_id: string;
  name: string;
  company: string;
  skill_1: string | null;
  skill_2: string | null;
  skill_3: string | null;
  skill_4: string | null;
  target_per_day: number;
  active: boolean;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

const STATUS_TONE: Record<string, "success" | "warning" | "critical" | "neutral"> = {
  Completed: "success",
  Pending: "warning",
  Blocked: "critical",
};

function partLabel(wo: WorkOrder): string {
  if (!wo.part) return "—";
  const size = wo.part.production_line?.size;
  return size ? `${wo.part.name} ${size}mm` : wo.part.name;
}

function crSummary(cr: ChangeRequest): string {
  try {
    const c = JSON.parse(cr.changes_json);
    if (cr.subject_type === "employee_profile") {
      return `Employee profile: ${Object.keys(c.changes ?? {}).join(", ")}`;
    }
    const excluded = (c.exclude_user_ids ?? []).length;
    const overridden = Object.keys(c.capacity_overrides ?? {}).length;
    return `Daily plan: ${excluded} excluded, ${overridden} capacity overrides`;
  } catch {
    return cr.subject_type;
  }
}

function getRole(): string {
  if (typeof window === "undefined") return "";
  const token = localStorage.getItem("token");
  if (!token) return "";
  try {
    return JSON.parse(atob(token.split(".")[1])).role ?? "";
  } catch {
    return "";
  }
}

// ── Page ─────────────────────────────────────────────────────────────────────

export default function SchedulerPage() {
  const { confirm, dialog } = useConfirm();
  const { showToast, toasts } = useToast();

  const [userRole, setUserRole] = useState("");
  const [date, setDate] = useState(new Date().toISOString().split("T")[0]);
  const [tab, setTab] = useState<"orders" | "approvals">("orders");
  const [orders, setOrders] = useState<WorkOrder[]>([]);
  const [changeRequests, setChangeRequests] = useState<ChangeRequest[]>([]);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [pendingCount, setPendingCount] = useState(0);
  const [noStockProjects, setNoStockProjects] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);

  // Complete modal
  const [completeWO, setCompleteWO] = useState<WorkOrder | null>(null);
  const [actualFeet, setActualFeet] = useState("");
  const [markProcessId, setMarkProcessId] = useState("");
  const [completeNotes, setCompleteNotes] = useState("");

  // Workforce modal
  const [workforceOpen, setWorkforceOpen] = useState(false);
  const [editedEmployees, setEditedEmployees] = useState<Record<number, Partial<Employee>>>({});

  // Override modal
  const [overrideOpen, setOverrideOpen] = useState(false);
  const [excludeIds, setExcludeIds] = useState<Set<number>>(new Set());
  const [capacityOverrides, setCapacityOverrides] = useState<Record<number, string>>({});
  const [overrideNotes, setOverrideNotes] = useState("");

  // Reject modal
  const [rejectCR, setRejectCR] = useState<ChangeRequest | null>(null);
  const [rejectNote, setRejectNote] = useState("");

  useEffect(() => { setUserRole(getRole()); }, []);

  const isManager = ["Developer", "GM", "Admin", "Production Manager"].includes(userRole);

  useEffect(() => {
    fetchOrders();
  }, [date]);

  useEffect(() => {
    if (isManager && tab === "approvals") fetchPending();
  }, [isManager, tab]);

  const fetchOrders = async () => {
    setLoading(true);
    try {
      const res = await apiFetch(`${API}/api/v1/scheduler/work-orders?target_date=${date}`);
      if (res.ok) {
        const data: WorkOrder[] = await res.json();
        setOrders(data);
        const noStock = [
          ...new Set(
            data
              .filter(wo => wo.part_id === null)
              .map(wo => wo.project?.quotation_no ?? `Proj #${wo.project_id}`)
          ),
        ];
        setNoStockProjects(noStock);
      }
    } finally {
      setLoading(false);
    }
  };

  const fetchPending = async () => {
    const res = await apiFetch(`${API}/api/v1/scheduler/change-requests?status=pending_approval`);
    if (res.ok) {
      const data: ChangeRequest[] = await res.json();
      setChangeRequests(data);
      setPendingCount(data.length);
    }
  };

  const fetchEmployees = async () => {
    const res = await apiFetch(`${API}/api/v1/scheduler/employees`);
    if (res.ok) setEmployees(await res.json());
  };

  const handleGenerate = async () => {
    const ok = await confirm({
      title: "Generate work orders?",
      description: "This will overwrite existing work orders for this date.",
      confirmLabel: "Generate",
    });
    if (!ok) return;
    setLoading(true);
    try {
      const res = await apiFetch(
        `${API}/api/v1/scheduler/generate-work-orders?target_date=${date}`,
        { method: "POST" }
      );
      const data = await res.json();
      if (data.success) {
        showToast(`${data.orders_created} orders generated`, "success");
        fetchOrders();
      } else {
        showToast(data.message ?? "Failed to generate", "critical");
      }
    } finally {
      setLoading(false);
    }
  };

  const handleComplete = async () => {
    if (!completeWO || !actualFeet) return;
    const body = {
      actual_feet: parseFloat(actualFeet),
      status: "Completed",
      mark_step_ready: !!markProcessId,
      part_process_id: markProcessId ? parseInt(markProcessId) : null,
      notes: completeNotes || null,
    };
    const res = await apiFetch(`${API}/api/v1/scheduler/work-orders/${completeWO.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (res.ok) {
      showToast("Work order completed", "success");
      setCompleteWO(null);
      setActualFeet("");
      setMarkProcessId("");
      setCompleteNotes("");
      fetchOrders();
    } else {
      showToast("Failed to complete work order", "critical");
    }
  };

  const openWorkforce = async () => {
    setEditedEmployees({});
    await fetchEmployees();
    setWorkforceOpen(true);
  };

  const handleEmployeeEdit = (
    empId: number,
    field: keyof Employee,
    value: string | boolean | number
  ) => {
    setEditedEmployees(prev => ({
      ...prev,
      [empId]: { ...prev[empId], [field]: value },
    }));
  };

  const handleProposeEmployeeChanges = async () => {
    const entries = Object.entries(editedEmployees);
    if (!entries.length) { showToast("No changes to propose", "critical"); return; }
    let allOk = true;
    for (const [empIdStr, changes] of entries) {
      const payload = {
        subject_type: "employee_profile",
        subject_id: parseInt(empIdStr),
        target_date: null,
        changes_json: JSON.stringify({ employee_id: parseInt(empIdStr), changes }),
      };
      const res = await apiFetch(`${API}/api/v1/scheduler/change-requests`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) allOk = false;
    }
    showToast(
      allOk ? `${entries.length} change request(s) submitted for PM approval` : "Some requests failed",
      allOk ? "success" : "critical"
    );
    setWorkforceOpen(false);
    setEditedEmployees({});
    if (isManager) fetchPending();
  };

  const handleSubmitOverride = async () => {
    const payload = {
      subject_type: "daily_plan_override",
      subject_id: null,
      target_date: date,
      changes_json: JSON.stringify({
        exclude_user_ids: [...excludeIds],
        capacity_overrides: Object.fromEntries(
          Object.entries(capacityOverrides)
            .filter(([, v]) => v !== "")
            .map(([k, v]) => [k, parseFloat(v)])
        ),
        notes: overrideNotes,
      }),
    };
    const res = await apiFetch(`${API}/api/v1/scheduler/change-requests`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (res.ok) {
      showToast("Override request submitted for PM approval", "success");
      setOverrideOpen(false);
      setExcludeIds(new Set());
      setCapacityOverrides({});
      setOverrideNotes("");
    } else {
      showToast("Failed to submit override", "critical");
    }
  };

  const handleApprove = async (crId: number) => {
    const res = await apiFetch(
      `${API}/api/v1/scheduler/change-requests/${crId}/approve`,
      { method: "PATCH" }
    );
    if (res.ok) { showToast("Approved", "success"); fetchPending(); }
    else showToast("Failed to approve", "critical");
  };

  const handleReject = async () => {
    if (!rejectCR) return;
    const res = await apiFetch(
      `${API}/api/v1/scheduler/change-requests/${rejectCR.id}/reject`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rejection_note: rejectNote }),
      }
    );
    if (res.ok) {
      showToast("Rejected", "success");
      setRejectCR(null);
      setRejectNote("");
      fetchPending();
    } else {
      showToast("Failed to reject", "critical");
    }
  };

  // Workers visible in the override modal are inferred from current work orders
  const presentWorkers = [
    ...new Map(
      orders.map(wo => [wo.user_id, wo.user])
    ).entries(),
  ].map(([id, user]) => ({ id, full_name: user?.full_name ?? `User #${id}` }));

  // ── Render ──────────────────────────────────────────────────────────────────

  return (
    <div>
      {/* Header */}
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="font-display text-3xl font-extrabold uppercase tracking-wide text-ink">
            Work Orders
          </h1>
          <p className="text-ink-soft">Material-gated daily work assignment</p>
        </div>
        <div className="flex items-center gap-3">
          <Input
            type="date"
            value={date}
            onChange={e => setDate(e.target.value)}
            className="max-w-[180px]"
          />
          {isManager && (
            <Button variant="primary" disabled={loading} onClick={handleGenerate}>
              {loading ? "Generating…" : "Generate Work Orders"}
            </Button>
          )}
        </div>
      </div>

      {/* No-stock warning */}
      {noStockProjects.length > 0 && (
        <div className="mb-4">
          <Alert tone="warning" title="No stock for some assignments">
            Work orders created without matched materials for:{" "}
            {noStockProjects.join(", ")}
          </Alert>
        </div>
      )}

      {/* Tabs */}
      <div className="mb-4 flex items-center gap-4 border-b border-line">
        <button
          className={`pb-2 text-sm font-medium ${tab === "orders" ? "border-b-2 border-brand text-brand" : "text-ink-soft"}`}
          onClick={() => setTab("orders")}
        >
          Work Orders
          {orders.length > 0 && (
            <span className="ml-1.5 rounded-full bg-paper-raised px-1.5 py-0.5 text-xs font-data">
              {orders.length}
            </span>
          )}
        </button>
        {isManager && (
          <button
            className={`pb-2 text-sm font-medium ${tab === "approvals" ? "border-b-2 border-brand text-brand" : "text-ink-soft"}`}
            onClick={() => setTab("approvals")}
          >
            Pending Approvals
            {pendingCount > 0 && (
              <span className="ml-1.5 rounded-full bg-critical px-1.5 py-0.5 text-xs font-data text-white">
                {pendingCount}
              </span>
            )}
          </button>
        )}
      </div>

      {/* Work Orders tab */}
      {tab === "orders" && (
        <Card>
          <CardHeader
            title={`Work Orders — ${date}`}
            action={
              <Button variant="secondary" onClick={openWorkforce}>
                Manage Workforce
              </Button>
            }
          />
          {loading && orders.length === 0 ? (
            <div className="p-6">
              <Spinner label="Loading work orders…" />
            </div>
          ) : orders.length === 0 ? (
            <div className="p-6">
              <EmptyState
                title="No work orders for this date"
                description={isManager ? "Click Generate Work Orders to create today's plan." : "Ask the Production Manager to generate today's plan."}
              />
            </div>
          ) : (
            <Table>
              <THead>
                <Tr>
                  <Th>Worker</Th>
                  <Th>Project</Th>
                  <Th>Part</Th>
                  <Th>Process</Th>
                  <Th numeric>Target ft</Th>
                  <Th>OT</Th>
                  <Th>Status</Th>
                  <Th>Action</Th>
                </Tr>
              </THead>
              <TBody>
                {orders.map(wo => (
                  <Tr key={wo.id}>
                    <Td className="font-medium text-ink">
                      {wo.user?.full_name ?? `User #${wo.user_id}`}
                    </Td>
                    <Td>{wo.project?.quotation_no ?? `Proj #${wo.project_id}`}</Td>
                    <Td>
                      {wo.part_id === null ? (
                        <Badge tone="critical">⚠ No Stock</Badge>
                      ) : (
                        <span className="text-sm text-ink">{partLabel(wo)}</span>
                      )}
                    </Td>
                    <Td>
                      <Badge tone="brand">{wo.process_type}</Badge>
                    </Td>
                    <Td numeric>{wo.target_feet.toFixed(1)}</Td>
                    <Td>
                      {wo.is_overtime ? (
                        <Badge tone="warning">OT</Badge>
                      ) : (
                        <Badge tone="neutral">No</Badge>
                      )}
                    </Td>
                    <Td>
                      <Badge tone={STATUS_TONE[wo.status] ?? "neutral"}>{wo.status}</Badge>
                    </Td>
                    <Td>
                      {wo.status !== "Completed" && (
                        <Button
                          variant="secondary"
                          onClick={() => {
                            setCompleteWO(wo);
                            setActualFeet(String(wo.target_feet));
                            setMarkProcessId("");
                            setCompleteNotes("");
                          }}
                        >
                          Complete
                        </Button>
                      )}
                    </Td>
                  </Tr>
                ))}
              </TBody>
            </Table>
          )}
        </Card>
      )}

      {/* Pending Approvals tab — PM only */}
      {tab === "approvals" && isManager && (
        <Card>
          <CardHeader title="Pending Approvals" />
          {changeRequests.length === 0 ? (
            <div className="p-6">
              <EmptyState title="No pending approvals" description="Nothing to review right now." />
            </div>
          ) : (
            <Table>
              <THead>
                <Tr>
                  <Th>Type</Th>
                  <Th>Proposed By</Th>
                  <Th>Summary</Th>
                  <Th>Target Date</Th>
                  <Th>Submitted</Th>
                  <Th>Actions</Th>
                </Tr>
              </THead>
              <TBody>
                {changeRequests.map(cr => (
                  <Tr key={cr.id}>
                    <Td>
                      <Badge tone="brand">
                        {cr.subject_type === "employee_profile" ? "Employee" : "Daily Plan"}
                      </Badge>
                    </Td>
                    <Td>{cr.proposer?.full_name ?? `User #${cr.proposed_by}`}</Td>
                    <Td className="max-w-xs truncate text-sm text-ink-soft">{crSummary(cr)}</Td>
                    <Td className="text-sm text-ink-soft">{cr.target_date ?? "—"}</Td>
                    <Td className="text-sm text-ink-soft">
                      {new Date(cr.created_at).toLocaleDateString()}
                    </Td>
                    <Td>
                      <div className="flex gap-2">
                        <Button variant="primary" onClick={() => handleApprove(cr.id)}>
                          Approve
                        </Button>
                        <Button
                          variant="danger"
                          onClick={() => { setRejectCR(cr); setRejectNote(""); }}
                        >
                          Reject
                        </Button>
                      </div>
                    </Td>
                  </Tr>
                ))}
              </TBody>
            </Table>
          )}
        </Card>
      )}

      {/* ── Modals ──────────────────────────────────────────────────────────── */}

      {/* Complete Work Order Modal */}
      <Modal
        open={!!completeWO}
        onClose={() => setCompleteWO(null)}
        title="Complete Work Order"
        description={
          completeWO
            ? `${completeWO.user?.full_name ?? ""} — ${completeWO.project?.quotation_no ?? ""} (${completeWO.process_type})`
            : ""
        }
      >
        <div className="flex w-full flex-col gap-3 pb-4">
          <div>
            <Label>Actual Feet Completed</Label>
            <Input
              type="number"
              step="0.1"
              min="0"
              value={actualFeet}
              onChange={e => setActualFeet(e.target.value)}
              placeholder="e.g. 14.5"
            />
          </div>
          {(completeWO?.part?.processes?.filter(p => p.status !== "ready") ?? []).length > 0 && (
            <div>
              <Label>Mark Step Ready (optional)</Label>
              <Select value={markProcessId} onChange={e => setMarkProcessId(e.target.value)}>
                <option value="">— don&apos;t mark any step —</option>
                {completeWO!.part!.processes
                  .filter(p => p.status !== "ready")
                  .map(p => (
                    <option key={p.id} value={String(p.id)}>
                      {p.process_name}
                    </option>
                  ))}
              </Select>
            </div>
          )}
          <div>
            <Label>Notes (optional)</Label>
            <Textarea
              value={completeNotes}
              onChange={e => setCompleteNotes(e.target.value)}
              rows={2}
            />
          </div>
        </div>
        <Button variant="secondary" onClick={() => setCompleteWO(null)}>
          Cancel
        </Button>
        <Button
          variant="primary"
          onClick={handleComplete}
          disabled={!actualFeet || isNaN(parseFloat(actualFeet))}
        >
          Save
        </Button>
      </Modal>

      {/* Manage Workforce Modal */}
      <Modal
        open={workforceOpen}
        onClose={() => setWorkforceOpen(false)}
        title="Manage Workforce"
      >
        <div className="w-full overflow-x-auto pb-4">
          {employees.length === 0 ? (
            <Spinner label="Loading employees…" />
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-line text-left text-ink-soft">
                  {["Name", "Co.", "Skill 1", "Skill 2", "Skill 3", "Skill 4", "Tgt/Day", "Active"].map(h => (
                    <th key={h} className="pb-2 pr-2 font-medium">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {employees.map(emp => {
                  const edits = editedEmployees[emp.id] ?? {};
                  return (
                    <tr key={emp.id} className="border-b border-line">
                      <td className="py-1 pr-2 font-medium">{emp.name}</td>
                      <td className="py-1 pr-2 text-ink-soft">{emp.company}</td>
                      {(["skill_1", "skill_2", "skill_3", "skill_4"] as const).map(f => (
                        <td key={f} className="py-1 pr-2">
                          <Input
                            value={edits[f] !== undefined ? String(edits[f]) : (emp[f] ?? "")}
                            onChange={e => handleEmployeeEdit(emp.id, f, e.target.value)}
                            className="w-24 text-xs"
                          />
                        </td>
                      ))}
                      <td className="py-1 pr-2">
                        <Input
                          type="number"
                          value={
                            edits.target_per_day !== undefined
                              ? String(edits.target_per_day)
                              : String(emp.target_per_day)
                          }
                          onChange={e =>
                            handleEmployeeEdit(emp.id, "target_per_day", parseFloat(e.target.value))
                          }
                          className="w-16 text-xs"
                        />
                      </td>
                      <td className="py-1">
                        <Select
                          value={String(edits.active !== undefined ? edits.active : emp.active)}
                          onChange={e =>
                            handleEmployeeEdit(emp.id, "active", e.target.value === "true")
                          }
                          className="w-16 text-xs"
                        >
                          <option value="true">Yes</option>
                          <option value="false">No</option>
                        </Select>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" onClick={() => { setOverrideOpen(true); }}>
            Override Today&apos;s Plan
          </Button>
          <Button variant="secondary" onClick={() => setWorkforceOpen(false)}>
            Cancel
          </Button>
          <Button
            variant="primary"
            disabled={Object.keys(editedEmployees).length === 0}
            onClick={handleProposeEmployeeChanges}
          >
            Propose Changes ({Object.keys(editedEmployees).length})
          </Button>
        </div>
      </Modal>

      {/* Daily Override Modal */}
      <Modal
        open={overrideOpen}
        onClose={() => setOverrideOpen(false)}
        title="Override Today's Plan"
        description="Changes require PM approval before they affect generation."
      >
        <div className="flex w-full flex-col gap-3 pb-4">
          <p className="text-sm text-ink-soft">Uncheck workers to exclude from today&apos;s run:</p>
          {presentWorkers.length === 0 && (
            <p className="text-sm text-ink-soft">No workers on today&apos;s orders yet.</p>
          )}
          {presentWorkers.map(w => (
            <div key={w.id} className="flex items-center gap-3">
              <input
                type="checkbox"
                id={`wo-${w.id}`}
                checked={!excludeIds.has(w.id)}
                onChange={e => {
                  setExcludeIds(prev => {
                    const next = new Set(prev);
                    if (e.target.checked) next.delete(w.id);
                    else next.add(w.id);
                    return next;
                  });
                }}
              />
              <label htmlFor={`wo-${w.id}`} className="flex-1 text-sm">
                {w.full_name}
              </label>
              <Input
                type="number"
                placeholder="Capacity override"
                value={capacityOverrides[w.id] ?? ""}
                onChange={e =>
                  setCapacityOverrides(prev => ({ ...prev, [w.id]: e.target.value }))
                }
                className="w-28 text-xs"
              />
            </div>
          ))}
          <div>
            <Label>Notes</Label>
            <Textarea
              value={overrideNotes}
              onChange={e => setOverrideNotes(e.target.value)}
              rows={2}
            />
          </div>
        </div>
        <Button variant="secondary" onClick={() => setOverrideOpen(false)}>Cancel</Button>
        <Button variant="primary" onClick={handleSubmitOverride}>Submit for Approval</Button>
      </Modal>

      {/* Reject Modal */}
      <Modal
        open={!!rejectCR}
        onClose={() => setRejectCR(null)}
        title="Reject Change Request"
      >
        <div className="w-full pb-4">
          <Label>Reason for rejection</Label>
          <Textarea
            value={rejectNote}
            onChange={e => setRejectNote(e.target.value)}
            rows={3}
          />
        </div>
        <Button variant="secondary" onClick={() => setRejectCR(null)}>Cancel</Button>
        <Button
          variant="danger"
          onClick={handleReject}
          disabled={!rejectNote.trim()}
        >
          Reject
        </Button>
      </Modal>

      {dialog}
      {toasts}
    </div>
  );
}
```

- [ ] **Step 3: TypeScript build check**

```bash
npm --prefix next-frontend run build 2>&1 | tail -20
```
Expected: build completes with 0 TypeScript errors. The scheduler route should appear in the route list.

- [ ] **Step 4: Commit**

```bash
git add next-frontend/src/app/(main)/scheduler/page.tsx next-frontend/src/components/Sidebar.tsx
git commit -m "feat(scheduler): replace Daily Scheduler with Work Orders page"
```

---

## Final Checks

- [ ] **Backend compile check**

```bash
python -m py_compile backend/services/db_service.py backend/app/scheduler/schemas.py backend/app/scheduler/router.py && echo "All OK"
```
Expected: `All OK`

- [ ] **Run tests**

```bash
python test_work_orders.py
```
Expected: `All work order tests passed.`

- [ ] **Frontend build**

```bash
npm --prefix next-frontend run build 2>&1 | grep -E "error|Error|warning|Warning|✓" | head -20
```
Expected: no errors, route `/scheduler` in the output.

- [ ] **Push to demo**

```bash
git push origin demo
```

- [ ] **Update projectprogress.md**

Document: Session 19, what was built, commits, what to verify on Railway, open questions (PROCESS_TYPE_TO_STEPS mapping confirmation with GM).
