from datetime import date, timedelta
from collections import defaultdict

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session, joinedload
from backend.services.db_service import (
    get_db, User, AttendanceLog, WeldingLog, ProductionLog, WorkOrder
)
from backend.app.users.schemas import UserCreate, UserUpdate
from passlib.context import CryptContext

pwd_context = CryptContext(schemes=["argon2"], deprecated="auto")
router = APIRouter(prefix="/api/v1/users", tags=["Users"])

from backend.app.auth.rbac import require_roles, SUPERVISORS, USER_ADMINS

@router.get("")
def get_users(db: Session = Depends(get_db), current_user: dict = Depends(require_roles(SUPERVISORS))):
    users = db.query(User).all()
    result = [{"id": u.id, "name": u.full_name, "role": u.role, "username": u.username, "experience": u.experience, "skill": u.skill, "department": u.department, "base_productivity": u.base_productivity} for u in users]
    return {"success": True, "message": "Users retrieved", "data": result}

@router.post("")
def create_user(user: UserCreate, db: Session = Depends(get_db), current_user: dict = Depends(require_roles(USER_ADMINS))):
    import uuid
    
    gen_username = user.username
    if not gen_username:
        slug = user.full_name.lower().replace(" ", "")[:10]
        gen_username = f"{slug}_{uuid.uuid4().hex[:6]}"
        
    gen_password = user.password or "shopfloor_no_login"

    existing = db.query(User).filter_by(username=gen_username).first()
    if existing:
        raise HTTPException(status_code=400, detail="Username already exists")
        
    hashed_pw = pwd_context.hash(gen_password)
    new_user = User(
        username=gen_username,
        full_name=user.full_name,
        hashed_password=hashed_pw,
        role=user.role,
        experience=user.experience,
        skill=user.skill,
        department=user.department,
        base_productivity=user.base_productivity
    )
    db.add(new_user)
    db.commit()
    return {"success": True, "message": "User created successfully", "data": {"id": new_user.id}}

@router.put("/{user_id}")
def update_user(user_id: int, req: UserUpdate, db: Session = Depends(get_db), current_user: dict = Depends(require_roles(USER_ADMINS))):
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
        
    if req.full_name is not None:
        user.full_name = req.full_name
    if req.role is not None:
        user.role = req.role
    if req.department is not None:
        user.department = req.department
    if req.skill is not None:
        user.skill = req.skill
    if req.experience is not None:
        user.experience = req.experience
    if req.base_productivity is not None:
        user.base_productivity = req.base_productivity
    if req.password:
        user.hashed_password = pwd_context.hash(req.password)
        
    db.commit()
    return {"success": True, "message": "User updated successfully"}

@router.delete("/{user_id}")
def delete_user(user_id: int, db: Session = Depends(get_db), current_user: dict = Depends(require_roles(USER_ADMINS))):
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
        
    try:
        from backend.services.db_service import DailyTaskAssignment, AuditLog
        # Nullify references so historical production logs aren't deleted when an operator is removed
        db.query(WeldingLog).filter(WeldingLog.operator_id == user.id).update({WeldingLog.operator_id: None})
        db.query(ProductionLog).filter(ProductionLog.operator_id == user.id).update({ProductionLog.operator_id: None})
        db.query(AuditLog).filter(AuditLog.user_id == user.id).update({AuditLog.user_id: None})
        
        # Delete attendance logs and daily task assignments since user_id is non-nullable
        db.query(AttendanceLog).filter(AttendanceLog.user_id == user.id).delete(synchronize_session=False)
        db.query(DailyTaskAssignment).filter(DailyTaskAssignment.user_id == user.id).delete(synchronize_session=False)
        
        db.delete(user)
        db.commit()
        return {"success": True, "message": "User deleted successfully"}
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=400, detail=f"Cannot delete user: {str(e)}")


@router.get("/{user_id}/dashboard")
def get_worker_dashboard(
    user_id: int,
    period: str = "month",
    db: Session = Depends(get_db),
    current_user: dict = Depends(require_roles(SUPERVISORS)),
):
    today = date.today()
    if period == "quarter":
        from_date = today - timedelta(days=90)
    elif period == "year":
        from_date = today - timedelta(days=365)
    else:
        from_date = today - timedelta(days=30)

    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="Worker not found")

    # Attendance for period
    att_rows = (
        db.query(AttendanceLog)
        .filter(AttendanceLog.user_id == user_id, AttendanceLog.date >= from_date, AttendanceLog.date <= today)
        .order_by(AttendanceLog.date)
        .all()
    )
    att_by_status: dict = defaultdict(int)
    for a in att_rows:
        att_by_status[a.status] += 1
    present_count = att_by_status["Present"] + att_by_status["Overtime"]
    total_att = len(att_rows)

    # Work orders for period (eager-load project to avoid N+1)
    wo_rows = (
        db.query(WorkOrder)
        .options(joinedload(WorkOrder.project))
        .filter(WorkOrder.user_id == user_id, WorkOrder.date >= from_date, WorkOrder.date <= today)
        .all()
    )
    total_target = sum(wo.target_feet or 0 for wo in wo_rows)
    total_actual = sum(wo.actual_feet or 0 for wo in wo_rows)
    days_worked = len(set(str(wo.date) for wo in wo_rows))

    today_orders = [
        {
            "id": wo.id,
            "project": wo.project.quotation_no if wo.project else "—",
            "process_type": wo.process_type,
            "target_feet": wo.target_feet,
            "actual_feet": wo.actual_feet,
            "status": wo.status,
            "is_overtime": wo.is_overtime,
        }
        for wo in wo_rows if wo.date == today
    ]

    # Welding logs for period (daily footage series)
    wl_rows = (
        db.query(WeldingLog)
        .filter(WeldingLog.operator_id == user_id, WeldingLog.date >= from_date, WeldingLog.date <= today)
        .all()
    )
    daily_feet: dict = defaultdict(float)
    for wl in wl_rows:
        daily_feet[str(wl.date)] += wl.feet_done

    # Monthly totals — always last 12 full months
    twelve_ago = date(today.year - 1, today.month, 1)
    all_wl = (
        db.query(WeldingLog)
        .filter(WeldingLog.operator_id == user_id, WeldingLog.date >= twelve_ago)
        .all()
    )
    monthly_feet: dict = defaultdict(float)
    for wl in all_wl:
        key = f"{wl.date.year}-{wl.date.month:02d}"
        monthly_feet[key] += wl.feet_done

    # Production logs for period (step count — non-welders)
    pl_rows = (
        db.query(ProductionLog)
        .filter(ProductionLog.operator_id == user_id, ProductionLog.date >= from_date, ProductionLog.date <= today)
        .all()
    )
    daily_steps: dict = defaultdict(int)
    for pl in pl_rows:
        daily_steps[str(pl.date)] += 1

    # Process type split (TIG / MIG / Grinding) from welding logs
    process_feet: dict = defaultdict(float)
    for wl in wl_rows:
        process_feet[wl.process_type] += wl.feet_done

    # Project-wise contribution from work orders
    project_map: dict = {}
    for wo in wo_rows:
        if wo.project:
            key = wo.project.quotation_no
            if key not in project_map:
                project_map[key] = {
                    "quotation_no": key,
                    "project_name": wo.project.project_name or key,
                    "feet": 0.0,
                    "orders": 0,
                }
            project_map[key]["feet"] += wo.actual_feet or 0
            project_map[key]["orders"] += 1

    # Derived summary metrics
    completed_count = sum(1 for wo in wo_rows if wo.status == "Completed")
    total_wo = len(wo_rows)
    efficiency_pct = round(total_actual / total_target * 100, 1) if total_target else 0
    att_rate = round(present_count / total_att * 100, 1) if total_att else 0
    on_time_pct = round(completed_count / total_wo * 100, 1) if total_wo else 0
    avg_ft_per_day = round(total_actual / days_worked, 1) if days_worked else 0
    # Reliability = blend of attendance and efficiency (both equally weighted)
    reliability_pct = round((att_rate + efficiency_pct) / 2, 1)

    return {
        "profile": {
            "id": user.id,
            "name": user.full_name or f"Worker #{user.id}",
            "role": user.role,
            "skill": user.skill,
            "department": user.department,
            "experience": user.experience,
            "base_productivity": user.base_productivity,
        },
        "period": {"from": str(from_date), "to": str(today), "label": period},
        "attendance": {
            "total_days": total_att,
            "present": att_by_status["Present"],
            "overtime": att_by_status["Overtime"],
            "absent": att_by_status["Absent"],
            "leave": att_by_status["Leave"],
            "rate_pct": att_rate,
            "strip": [{"date": str(a.date), "status": a.status} for a in att_rows],
        },
        "work_orders": {
            "total": total_wo,
            "completed": completed_count,
            "pending": sum(1 for wo in wo_rows if wo.status == "Pending"),
            "blocked": sum(1 for wo in wo_rows if wo.status == "Blocked"),
            "target_feet": round(total_target, 1),
            "actual_feet": round(total_actual, 1),
            "efficiency_pct": efficiency_pct,
            "days_worked": days_worked,
            "avg_ft_per_day": avg_ft_per_day,
            "on_time_pct": on_time_pct,
            "overtime_days": att_by_status["Overtime"],
            "reliability_pct": reliability_pct,
        },
        "process_split": [
            {"process": p, "feet": round(f, 1)}
            for p, f in sorted(process_feet.items(), key=lambda x: x[1], reverse=True)
        ],
        "projects": sorted(
            [{"quotation_no": v["quotation_no"], "project_name": v["project_name"], "feet": round(v["feet"], 1), "orders": v["orders"]}
             for v in project_map.values()],
            key=lambda x: x["feet"], reverse=True,
        ),
        "today": today_orders,
        "daily_feet": [{"date": d, "feet": round(f, 1)} for d, f in sorted(daily_feet.items())],
        "monthly_feet": [{"month": m, "feet": round(f, 1)} for m, f in sorted(monthly_feet.items())],
        "daily_steps": [{"date": d, "steps": s} for d, s in sorted(daily_steps.items())],
    }
