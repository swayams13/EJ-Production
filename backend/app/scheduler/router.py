import json
import logging
from datetime import date, datetime
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import asc, func, nullslast
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
    Return the first Part in the project that has available warehouse stock
    and at least one PartProcess step matching process_type that is not yet 'ready'.
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


@router.post("/generate-work-orders")
def generate_work_orders(
    target_date: date,
    db: Session = Depends(get_db),
    current_user: dict = Depends(require_roles(["Developer", "GM", "Admin", "Production Manager", "Supervisor"])),
):
    from backend.services.mes_service import MESService
    from backend.services.production_service import aggregate_line_feet

    db.query(WorkOrder).filter(WorkOrder.date == target_date).delete()
    db.commit()

    # ── Step 1: present workers ───────────────────────────────────────────────
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

    # ── Step 2: approved daily-plan overrides ─────────────────────────────────
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

    # ── Step 3: accuracy scores from historical work orders ───────────────────
    accuracy_rows = db.query(
        WorkOrder.user_id,
        func.avg(WorkOrder.actual_feet / WorkOrder.target_feet),
    ).filter(
        WorkOrder.status == "Completed",
        WorkOrder.actual_feet.isnot(None),
        WorkOrder.target_feet > 0,
    ).group_by(WorkOrder.user_id).all()
    accuracy_map = {uid: min(float(acc), 1.5) for uid, acc in accuracy_rows if acc}

    # ── Step 4: build worker list with priority scores ────────────────────────
    employees = db.query(Employee).all()
    emp_map = {e.name: e for e in employees}

    worker_list = []
    for w in workers:
        emp = emp_map.get(w.full_name)
        target = capacity_overrides.get(w.id, None)
        skills = []
        experience_years = 0

        if emp:
            raw_skills = [emp.skill_1, emp.skill_2, emp.skill_3, emp.skill_4]
            skills = [(i, s) for i, s in enumerate(raw_skills) if s]
            experience_years = emp.experience_years or 0
            if target is None:
                target = emp.target_per_day or w.base_productivity or 50.0
        else:
            if w.skill:
                skills = [(0, w.skill)]
            if target is None:
                target = w.base_productivity or 50.0

        accuracy = accuracy_map.get(w.id, 0.8)          # default 80% if no history
        exp_score = min(experience_years / 20.0, 1.0)   # cap at 20 yrs
        eff_score = min(target / 100.0, 1.0)            # cap at 100 ft/day

        # Higher accuracy + more experience + higher efficiency → gets first pick
        priority_score = accuracy * 0.4 + exp_score * 0.3 + eff_score * 0.3

        worker_list.append({
            "user_id": w.id,
            "target_feet": target,
            "skills": skills,           # [(tier, skill_str), ...]
            "priority_score": priority_score,
        })

    # Best workers get first pick of projects
    worker_list.sort(key=lambda w: w["priority_score"], reverse=True)

    # ── Step 5: project pacing requirements ───────────────────────────────────
    projects = db.query(Project).filter(
        Project.status == "Active",
        Project.hold_until_date == None,
    ).order_by(
        nullslast(asc(Project.priority)),
        asc(Project.target_date),
        asc(Project.created_at),
    ).all()

    if not projects:
        return {"success": True, "message": "No active projects.", "orders_created": 0,
                "workers_assigned": len(worker_list), "no_stock_projects": []}

    today = date.today()
    project_requirements = []
    no_stock_projects: list = []

    for p in projects:
        total_tig, total_mig, total_grind = aggregate_line_feet(p.production_lines)
        total_feet = total_tig + total_mig + total_grind
        if total_feet == 0:
            continue

        assignment = db.query(ProjectResourceAssignment).filter_by(project_id=p.id).first()
        target_days = assignment.target_days if assignment and assignment.target_days else 15
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
            "remaining_TIG":      today_req * (total_tig   / total_feet),
            "remaining_MIG":      today_req * (total_mig   / total_feet),
            "remaining_GRINDING": today_req * (total_grind / total_feet),
        })

    if not project_requirements:
        return {"success": True, "message": "No pacing requirements today.", "orders_created": 0,
                "workers_assigned": len(worker_list), "no_stock_projects": []}

    # ── Step 6: assign each worker exactly ONE work order ─────────────────────
    # Process priority within a worker: MIG → TIG → Grinding
    SKILL_TO_PROCESS = [
        ("MIG",   "remaining_MIG",      "MIG"),
        ("TIG",   "remaining_TIG",      "TIG"),
        ("GRIND", "remaining_GRINDING", "Grinding"),
    ]

    orders_created = 0

    for worker in worker_list:
        assigned = False
        # Try each skill tier (0=primary first) and each matching process type
        for _tier, skill_str in sorted(worker["skills"], key=lambda x: x[0]):
            if assigned:
                break
            for skill_kw, req_key, process_type in SKILL_TO_PROCESS:
                if skill_kw not in skill_str.upper():
                    continue
                # Assign to the highest-priority project that still needs this process
                for req in project_requirements:
                    if req[req_key] <= 0:
                        continue
                    assigned_feet = min(worker["target_feet"], req[req_key])
                    part = find_available_part(db, req["project"], process_type)
                    if part is None and req["project"].quotation_no not in no_stock_projects:
                        no_stock_projects.append(req["project"].quotation_no)
                    db.add(WorkOrder(
                        project_id=req["project"].id,
                        user_id=worker["user_id"],
                        part_id=part.id if part else None,
                        date=target_date,
                        process_type=process_type,
                        target_feet=assigned_feet,
                        is_overtime=False,
                        status="Pending",
                    ))
                    orders_created += 1
                    req[req_key] -= assigned_feet
                    assigned = True
                    break
                if assigned:
                    break

    db.commit()
    return {
        "success": True,
        "message": f"Generated {orders_created} work orders for {len(worker_map)} workers.",
        "orders_created": orders_created,
        "workers_assigned": len(worker_map),
        "no_stock_projects": no_stock_projects,
    }


@router.get("/assignments", response_model=List[TaskAssignmentResponse])
def get_assignments(
    target_date: Optional[date] = None,
    db: Session = Depends(get_db),
    current_user: dict = Depends(require_roles(["Developer", "GM", "Admin", "Production Manager", "Supervisor"]))
):
    query = db.query(DailyTaskAssignment)
    if target_date:
        assignments = query.filter(DailyTaskAssignment.date == target_date).all()
        
        # Enterprise Lazy-Initialization: Auto-assign on first view of the day
        if not assignments and target_date == date.today():
            auto_assign_tasks(target_date, db, current_user)
            assignments = db.query(DailyTaskAssignment).filter(DailyTaskAssignment.date == target_date).all()
            
        return assignments
        
    return query.all()

@router.post("/assignments", response_model=TaskAssignmentResponse)
def create_assignment(
    assignment: TaskAssignmentCreate,
    db: Session = Depends(get_db),
    current_user: dict = Depends(require_roles(["Developer", "GM", "Admin", "Production Manager", "Supervisor"]))
):
    new_assignment = DailyTaskAssignment(
        project_id=assignment.project_id,
        user_id=assignment.user_id,
        process_type=assignment.process_type,
        date=assignment.date,
        target_feet=assignment.target_feet,
        status=assignment.status,
        is_overtime=assignment.is_overtime,
        notes=assignment.notes
    )
    db.add(new_assignment)
    db.commit()
    db.refresh(new_assignment)
    return new_assignment

@router.post("/auto-assign")
def auto_assign_tasks(
    target_date: date,
    db: Session = Depends(get_db),
    current_user: dict = Depends(require_roles(["Developer", "GM", "Admin", "Production Manager", "Supervisor"]))
):
    # Clear existing assignments for the day to re-run
    db.query(DailyTaskAssignment).filter(DailyTaskAssignment.date == target_date).delete()
    db.commit()

    # Get Present Workers
    present_logs = db.query(AttendanceLog).filter(
        AttendanceLog.date == target_date,
        AttendanceLog.status.in_(["Present", "Overtime"])
    ).all()
    
    # Check if ANY attendance is marked for this date
    any_logs = db.query(AttendanceLog).filter(AttendanceLog.date == target_date).first()
    
    if any_logs:
        # Attendance was taken, so only use present workers
        present_user_ids = [log.user_id for log in present_logs]
        if not present_user_ids:
            return {"success": False, "message": "Attendance is marked, but no workers are present today."}
        workers = db.query(User).filter(User.id.in_(present_user_ids), User.role == "Operator").all()
    else:
        # No attendance taken yet (e.g. future date planning), assume ALL operators are available
        workers = db.query(User).filter(User.role == "Operator").all()
        if not workers:
            return {"success": False, "message": "No operators found in the system to assign work to."}
    
    # Sort workers by base_productivity (simulating efficiency/track record)
    workers.sort(key=lambda w: w.base_productivity or 0, reverse=True)
    
    from backend.services.db_service import Employee
    employees = db.query(Employee).all()
    emp_map = {e.name: e for e in employees}
    
    # Create unified worker capacity tracker
    worker_map = {}
    worker_skills_map = {} # user_id -> [(tier, skill_string)]
    for w in workers:
        emp = emp_map.get(w.full_name)
        skills = []
        target = w.base_productivity or 50.0
        
        if emp:
            # Pad with None so we have exactly 4 levels
            raw_skills = [emp.skill_1, emp.skill_2, emp.skill_3, emp.skill_4]
            skills = [(i, s) for i, s in enumerate(raw_skills) if s]
            target = emp.target_per_day
        elif w.skill:
            skills = [(0, w.skill)]
            
        worker_info = {
            "user_id": w.id,
            "worker_name": w.full_name,
            "base_productivity": target,
            "remaining_capacity": target,
            "assigned_feet": 0.0,
            "ot_remaining_capacity": target * 0.5, # 50% extra for OT
            "can_do_overtime": True
        }
        
        worker_map[w.id] = worker_info
        worker_skills_map[w.id] = skills

    # Get Active Projects ordered by priority (created_at)
    projects = db.query(Project).filter(
        Project.status == "Active",
        Project.hold_until_date == None
    ).order_by(asc(Project.created_at)).all()
    
    if not projects:
        return {"success": True, "message": "No active projects to assign."}

    # 1. Gather Pacing Requirements per Project
    project_requirements = []
    from datetime import date
    today = date.today()
    from backend.services.mes_service import MESService
    from backend.services.db_service import ProjectResourceAssignment
    
    from backend.services.production_service import aggregate_line_feet

    for p in projects:
        total_tig, total_mig, total_grind = aggregate_line_feet(p.production_lines)

        total_feet = total_tig + total_mig + total_grind
        if total_feet == 0:
            continue
            
        assignment = db.query(ProjectResourceAssignment).filter(ProjectResourceAssignment.project_id == p.id).first()
        target_days = assignment.target_days if assignment and assignment.target_days else 15
        
        base_daily_target = total_feet / target_days if target_days > 0 else 0
        
        if p.created_at:
            import datetime
            if isinstance(p.created_at, str):
                created_date = datetime.datetime.strptime(p.created_at.split()[0], '%Y-%m-%d').date()
            else:
                created_date = p.created_at.date()
            days_elapsed = (today - created_date).days
        else:
            days_elapsed = 0
            
        if days_elapsed < 0:
            days_elapsed = 0
            
        expected_completed = min(total_feet, base_daily_target * days_elapsed)
        progress_pct = MESService.calculate_project_progress(db, p.id)
        actual_completed = total_feet * (progress_pct / 100)
        
        backlog = max(0, expected_completed - actual_completed)
        today_requirement = base_daily_target + backlog
        
        if today_requirement > 0:
            tig_req = today_requirement * (total_tig / total_feet)
            mig_req = today_requirement * (total_mig / total_feet)
            grind_req = today_requirement * (total_grind / total_feet)
            
            project_requirements.append({
                "project": p,
                "remaining_TIG": tig_req,
                "remaining_MIG": mig_req,
                "remaining_GRINDING": grind_req
            })
            
    if not project_requirements:
        return {"success": True, "message": "No active projects require pacing assignments today."}

    # 2. Assignment Logic (Tiered By Skill Priority)
    # Order of processing constraints: MIG -> TIG -> GRINDING
    process_order = [
        ("MIG", "remaining_MIG", "MIG"),
        ("TIG", "remaining_TIG", "TIG"),
        ("GRIND", "remaining_GRINDING", "Grinding")
    ]
    
    for skill_keyword, req_key, process_type in process_order:
        # 4 passes: Primary (0), Secondary (1), Tertiary (2), Quaternary (3)
        for tier in range(4):
            # Find all workers that have this skill at the current tier
            tier_workers = []
            for uid, skills in worker_skills_map.items():
                for lvl, s in skills:
                    if lvl == tier and skill_keyword in s.upper():
                        tier_workers.append(worker_map[uid])
            
            # Sort tier workers by remaining capacity (descending) to balance work
            tier_workers.sort(key=lambda w: w["remaining_capacity"], reverse=True)
            
            # Assign work to these workers
            req_index = 0
            for w in tier_workers:
                # While the worker has time in their shift AND there are projects left
                while w["remaining_capacity"] > 0 and req_index < len(project_requirements):
                    req = project_requirements[req_index]
                    
                    if req[req_key] <= 0:
                        req_index += 1
                        continue
                        
                    assigned_feet = min(w["remaining_capacity"], req[req_key])
                    
                    assignment = DailyTaskAssignment(
                        project_id=req["project"].id,
                        user_id=w["user_id"],
                        process_type=process_type,
                        date=target_date,
                        target_feet=assigned_feet,
                        is_overtime=False,
                        status="Pending"
                    )
                    db.add(assignment)
                    
                    w["assigned_feet"] += assigned_feet
                    w["remaining_capacity"] -= assigned_feet
                    req[req_key] -= assigned_feet
                    
                    if req[req_key] <= 0:
                        req_index += 1
                    
        # 3. Overtime Assignment (If there are still projects left unassigned in this skill)
        # We check if there are any pending requirements left for this process type
        has_pending = any(req[req_key] > 0 for req in project_requirements)
        if has_pending:
            # Gather all workers who have this skill across ANY tier
            all_skill_workers = []
            for uid, skills in worker_skills_map.items():
                if any(skill_keyword in s.upper() for lvl, s in skills):
                    all_skill_workers.append(worker_map[uid])
                    
            # Sort workers descending by base productivity for overtime
            all_skill_workers.sort(key=lambda x: x["base_productivity"], reverse=True)
            
            req_index = 0
            for w in all_skill_workers:
                while w["ot_remaining_capacity"] > 0 and req_index < len(project_requirements):
                    req = project_requirements[req_index]
                    if req[req_key] <= 0:
                        req_index += 1
                        continue
                        
                    # Worker can do a maximum of 50% extra capacity as overtime
                    assigned_ot_feet = min(w["ot_remaining_capacity"], req[req_key])
                    
                    assignment = DailyTaskAssignment(
                        project_id=req["project"].id,
                        user_id=w["user_id"],
                        process_type=process_type,
                        date=target_date,
                        target_feet=assigned_ot_feet,
                        is_overtime=True,
                        status="Pending"
                    )
                    db.add(assignment)
                    
                    w["assigned_feet"] += assigned_ot_feet
                    w["ot_remaining_capacity"] -= assigned_ot_feet
                    req[req_key] -= assigned_ot_feet
                    
                    if req[req_key] <= 0:
                        req_index += 1
                        
    db.commit()
    return {"success": True, "message": f"Successfully assigned target tracking plans to {len(worker_map)} workers for today."}


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


@router.get("/change-requests", response_model=List[ChangeRequestResponse])
def get_change_requests(
    status: Optional[str] = "pending_approval",
    target_date: Optional[date] = None,
    db: Session = Depends(get_db),
    current_user: dict = Depends(require_roles(["Developer", "GM", "Admin", "Production Manager", "Supervisor"])),
):
    query = db.query(ChangeRequest).options(joinedload(ChangeRequest.proposer))

    if current_user.get("role") == "Supervisor":
        query = query.filter(ChangeRequest.proposed_by == current_user["id"])

    if status:
        query = query.filter(ChangeRequest.status == status)
    if target_date:
        query = query.filter(ChangeRequest.target_date == target_date)

    return query.order_by(ChangeRequest.created_at.desc()).all()


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
