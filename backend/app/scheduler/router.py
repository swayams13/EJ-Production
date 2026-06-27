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
        query = query.filter(DailyTaskAssignment.date == target_date)
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

    # Simplified Assignment Logic
    for skill, available_workers in workers_by_skill.items():
        process_type = skill
        project_index = 0
        
        # 1. Assign up to base capacity
        for w in available_workers:
            if project_index >= len(projects):
                break
            
            project = projects[project_index]
            assignment = DailyTaskAssignment(
                project_id=project.id,
                user_id=w["user_id"],
                process_type=process_type,
                date=target_date,
                target_feet=w["base_productivity"],
                is_overtime=False,
                status="Pending"
            )
            db.add(assignment)
            w["assigned_feet"] += w["base_productivity"]
            
            # Move to next project just to distribute work (simplified)
            project_index += 1 

        # 2. Overtime Assignment (If there are still projects left unassigned)
        if project_index < len(projects):
            # Assign overtime to the most efficient workers (they are sorted descending)
            for w in available_workers:
                if project_index >= len(projects):
                    break
                
                # Give an extra 20% of base_productivity as overtime
                overtime_target = w["base_productivity"] * 0.2
                project = projects[project_index]
                
                assignment = DailyTaskAssignment(
                    project_id=project.id,
                    user_id=w["user_id"],
                    process_type=process_type,
                    date=target_date,
                    target_feet=overtime_target,
                    is_overtime=True,
                    status="Pending",
                    notes="Auto-assigned overtime due to high workload."
                )
                db.add(assignment)
                
                project_index += 1

    db.commit()
    return {"success": True, "message": "Auto-assignment completed successfully."}
