from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from sqlalchemy import asc
from datetime import date
from typing import List, Optional

from backend.services.db_service import get_db, DailyTaskAssignment, Project, User, AttendanceLog
from backend.app.auth.rbac import require_roles
from backend.app.scheduler.schemas import TaskAssignmentCreate, TaskAssignmentResponse

router = APIRouter(prefix="/api/v1/scheduler", tags=["Scheduler"])

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
    
    # Group by skill using multi-skill from Employee map
    workers_by_skill = {}
    for w in workers:
        emp = emp_map.get(w.full_name)
        skills = []
        target = w.base_productivity or 50.0
        
        if emp:
            skills = [s for s in [emp.skill_1, emp.skill_2, emp.skill_3, emp.skill_4] if s]
            target = emp.target_per_day
        elif w.skill:
            skills = [w.skill]
            
        worker_info = {
            "user_id": w.id,
            "base_productivity": target,
            "remaining_capacity": target,
            "assigned_feet": 0.0,
            "ot_remaining_capacity": target * 0.5, # 50% extra for OT
            "can_do_overtime": True
        }
        
        for s in skills:
            if s not in workers_by_skill:
                workers_by_skill[s] = []
            workers_by_skill[s].append(worker_info)

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
    
    for p in projects:
        total_tig = 0
        total_mig = 0
        total_grind = 0
        
        for line in p.production_lines:
            jtype = getattr(line, 'joint_type', None) or 'EJ'
            if jtype == 'DJ':
                total_mig += (line.mig_feet or 0) + (line.tig_feet or 0)
            else:
                total_tig += (line.tig_feet or 0)
                total_mig += (line.mig_feet or 0)
            total_grind += (line.grinding_feet or 0)
            
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

    # 2. Assignment Logic
    for skill, available_workers in workers_by_skill.items():
        if not skill:
            continue
            
        skill_upper = skill.upper()
        if "TIG" in skill_upper:
            req_key = "remaining_TIG"
            process_type = "TIG"
        elif "MIG" in skill_upper:
            req_key = "remaining_MIG"
            process_type = "MIG"
        elif "GRIND" in skill_upper:
            req_key = "remaining_GRINDING"
            process_type = "Grinding"
        else:
            continue
            
        req_index = 0
        
        for w in available_workers:
            # While the worker has time in their shift AND there are projects left
            while w["remaining_capacity"] > 0 and req_index < len(project_requirements):
                req = project_requirements[req_index]
                
                if req[req_key] <= 0:
                    req_index += 1
                    continue
                    
                # Take whatever is smaller: the worker's remaining shift time, or the project's remaining requirement
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
        if req_index < len(project_requirements):
            # Sort workers descending by base productivity for overtime
            available_workers.sort(key=lambda x: x["base_productivity"], reverse=True)
            
            for w in available_workers:
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
                        status="Pending",
                        notes=f"Auto-assigned overtime due to backlog."
                    )
                    db.add(assignment)
                    
                    w["assigned_feet"] += assigned_ot_feet
                    w["ot_remaining_capacity"] -= assigned_ot_feet
                    req[req_key] -= assigned_ot_feet
                    
                    if req[req_key] <= 0:
                        req_index += 1

    db.commit()
    return {"success": True, "message": "Auto-assignment completed successfully."}
