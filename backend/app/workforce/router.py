from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from sqlalchemy import func
from datetime import date
from typing import List, Optional
from pydantic import BaseModel

from backend.services.db_service import get_db, AttendanceLog, User
from backend.app.auth.rbac import require_roles, SUPERVISORS

router = APIRouter(prefix="/api/v1/workforce", tags=["Workforce"])

# --- Schemas ---

class AttendanceCreate(BaseModel):
    user_id: int
    date: date
    status: str
    hours: Optional[float] = None

class AttendanceResponse(BaseModel):
    id: int
    user_id: int
    date: date
    status: str
    hours: Optional[float]

    class Config:
        orm_mode = True

# --- Endpoints ---

@router.post("/attendance", response_model=AttendanceResponse)
def submit_attendance(
    attendance: AttendanceCreate,
    db: Session = Depends(get_db),
    current_user: dict = Depends(require_roles(["Developer", "GM", "Admin", "Production Manager", "Supervisor"]))
):
    # Upsert on the (user_id, date) unique constraint instead of check-then-insert,
    # which raced under concurrent submits (two requests could both pass the
    # "does it exist" check and both insert, producing duplicate attendance rows).
    from sqlalchemy.dialects.postgresql import insert as pg_insert

    stmt = pg_insert(AttendanceLog).values(
        user_id=attendance.user_id,
        date=attendance.date,
        status=attendance.status,
        hours=attendance.hours
    ).on_conflict_do_update(
        index_elements=[AttendanceLog.user_id, AttendanceLog.date],
        set_={"status": attendance.status, "hours": attendance.hours}
    ).returning(AttendanceLog.id)

    result = db.execute(stmt)
    db.commit()
    new_id = result.scalar_one()
    return db.query(AttendanceLog).filter(AttendanceLog.id == new_id).first()

@router.post("/attendance/bulk")
def submit_attendance_bulk(
    records: List[AttendanceCreate],
    db: Session = Depends(get_db),
    current_user: dict = Depends(require_roles(SUPERVISORS)),
):
    from sqlalchemy.dialects.postgresql import insert as pg_insert
    for rec in records:
        stmt = pg_insert(AttendanceLog).values(
            user_id=rec.user_id,
            date=rec.date,
            status=rec.status,
            hours=rec.hours,
        ).on_conflict_do_update(
            index_elements=[AttendanceLog.user_id, AttendanceLog.date],
            set_={"status": rec.status, "hours": rec.hours},
        )
        db.execute(stmt)
    db.commit()
    return {"success": True, "count": len(records)}

@router.get("/attendance", response_model=List[AttendanceResponse])
def get_attendance(
    target_date: Optional[date] = None,
    db: Session = Depends(get_db),
    current_user: dict = Depends(require_roles(["Developer", "GM", "Admin", "Production Manager", "Supervisor"]))
):
    query = db.query(AttendanceLog)
    if target_date:
        query = query.filter(AttendanceLog.date == target_date)
    return query.all()

@router.get("/metrics")
def get_workforce_metrics(
    db: Session = Depends(get_db),
    current_user: dict = Depends(require_roles(SUPERVISORS))
):
    users = db.query(User).filter(User.role == "Operator").all()
    metrics = []
    
    for u in users:
        total_logs = db.query(AttendanceLog).filter(AttendanceLog.user_id == u.id).count()
        present_logs = db.query(AttendanceLog).filter(
            AttendanceLog.user_id == u.id, 
            AttendanceLog.status.in_(["Present", "Overtime"])
        ).count()
        
        attendance_score = (present_logs / total_logs * 100) if total_logs > 0 else 0
        
        efficiency_score = 80.0  
        quality_score = 90.0     
        reliability_score = (attendance_score + quality_score) / 2
        
        metrics.append({
            "user_id": u.id,
            "name": u.full_name,
            "department": u.department,
            "skill": u.skill,
            "attendance_score": round(attendance_score, 1),
            "efficiency_score": round(efficiency_score, 1),
            "quality_score": round(quality_score, 1),
            "reliability_score": round(reliability_score, 1)
        })
        
    return {"success": True, "data": metrics}
