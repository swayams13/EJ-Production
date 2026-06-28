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
    
    # Group by skill
    workers_by_skill = {}
    for w in workers:
        if w.skill not in workers_by_skill:
            workers_by_skill[w.skill] = []
        workers_by_skill[w.skill].append({
            "user_id": w.id,
            "base_productivity": w.base_productivity or 50.0,
            "assigned_feet": 0.0,
            "can_do_overtime": True # Top workers can do overtime
        })

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
        total_feet = 0
        for line in p.production_lines:
            total_feet += (line.tig_feet or 0) + (line.mig_feet or 0) + (line.grinding_feet or 0)
            
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
            project_requirements.append({
                "project": p,
                "remaining_req": today_requirement
            })
            
    if not project_requirements:
        return {"success": True, "message": "No active projects require pacing assignments today."}

    # 2. Assignment Logic
    for skill, available_workers in workers_by_skill.items():
        process_type = skill
        req_index = 0
        
        for w in available_workers:
            # Worker has an 8-hour shift capacity
            worker_daily_capacity = w["base_productivity"] * 8
            worker_remaining_capacity = worker_daily_capacity
            
            # While the worker has time in their shift AND there are projects left
            while worker_remaining_capacity > 0 and req_index < len(project_requirements):
                req = project_requirements[req_index]
                
                if req["remaining_req"] <= 0:
                    req_index += 1
                    continue
                    
                # Take whatever is smaller: the worker's remaining shift time, or the project's remaining requirement
                assigned_feet = min(worker_remaining_capacity, req["remaining_req"])
                
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
                worker_remaining_capacity -= assigned_feet
                req["remaining_req"] -= assigned_feet
                
                if req["remaining_req"] <= 0:
                    req_index += 1
                    
        # 3. Overtime Assignment (If there are still projects left unassigned in this skill)
        if req_index < len(project_requirements):
            # Sort workers descending by base productivity for overtime
            available_workers.sort(key=lambda x: x["base_productivity"], reverse=True)
            
            for w in available_workers:
                if req_index >= len(project_requirements):
                    break
                    
                req = project_requirements[req_index]
                if req["remaining_req"] <= 0:
                    req_index += 1
                    continue
                    
                # Worker can do a maximum of 4 hours overtime per day
                worker_max_ot_capacity = w["base_productivity"] * 4
                assigned_ot_feet = min(worker_max_ot_capacity, req["remaining_req"])
                
                assignment = DailyTaskAssignment(
                    project_id=req["project"].id,
                    user_id=w["user_id"],
                    process_type=process_type,
                    date=target_date,
                    target_feet=assigned_ot_feet,
                    is_overtime=True,
                    status="Pending",
                    notes=f"Auto-assigned overtime ({round(assigned_ot_feet / w['base_productivity'], 1)} hrs) due to backlog."
                )
                db.add(assignment)
                
                req["remaining_req"] -= assigned_ot_feet
                if req["remaining_req"] <= 0:
                    req_index += 1

    db.commit()
    return {"success": True, "message": "Auto-assignment completed successfully."}
