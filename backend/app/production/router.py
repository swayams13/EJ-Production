from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from datetime import datetime, date
from pydantic import BaseModel
from typing import Optional

from backend.services.db_service import get_db, ProjectProductionLine, PartProcess, ProductionLog, User, AuditLog, JobFinalCheck, AssemblyStep
from backend.app.production.schemas import TransactionCreate, FinalCheckUpdate
from backend.app.auth.rbac import require_roles, SUPERVISORS
from backend.services import joint_catalog
from backend.services.templates import route_for

router = APIRouter(prefix="/api/v1/production", tags=["Production"])

@router.get("/requirements/{project_id}")
def get_requirements(project_id: int, db: Session = Depends(get_db), current_user: dict = Depends(require_roles(SUPERVISORS))):
    lines = db.query(ProjectProductionLine).filter_by(project_id=project_id).all()
    return {"success": True, "data": [{
        "id": l.id,
        "type": getattr(l, 'joint_type', 'EJ'),
        "size": str(l.size),
        "total_qty": l.quantity,
        "tag_no": getattr(l, 'joint_type_code', None),
        "joint_category": getattr(l, 'joint_category', None),
        "description": (joint_catalog.get_type(l.joint_type_code) or {}).get("description") if getattr(l, 'joint_type_code', None) else None,
        "paint_status": getattr(l, 'paint_status', None),
    } for l in lines]}

@router.get("/parts/{req_id}")
def get_requirement_parts(req_id: int, db: Session = Depends(get_db), current_user: dict = Depends(require_roles(SUPERVISORS))):
    line = db.query(ProjectProductionLine).filter_by(id=req_id).first()
    if not line:
        raise HTTPException(status_code=404, detail="Requirement not found")
    parts_data = []
    for part in line.parts:
        part_target = getattr(part, 'total_qty', 0) or line.quantity
        proc_data = []
        _route = route_for(part.name)
        for proc in sorted(part.processes, key=lambda p: _route.index(p.process_name) if p.process_name in _route else 999):
            proc_data.append({
                "id": proc.id,
                "process_name": proc.process_name,
                "completed_qty": proc.completed_qty,
                "qty_pending": max(0, (getattr(part, 'total_qty', 0) or (line.quantity or 0)) - proc.completed_qty),
                "status": getattr(proc, "status", "pending"),
                "date_ready": proc.date_ready.isoformat() if getattr(proc, "date_ready", None) else None,
                "date_pending": proc.date_pending.isoformat() if getattr(proc, "date_pending", None) else None,
                "po_number": getattr(proc, "po_number", None),
            })
        parts_data.append({
            "id": part.id,
            "name": part.name,
            "weight_percentage": part.weight_percentage,
            "qty_per_unit": getattr(part, 'qty_per_unit', 1.0),
            "total_qty": part_target,
            "processes": proc_data
        })
    checks = db.query(JobFinalCheck).filter_by(production_line_id=line.id).all()
    checks_data = [{
        "id": c.id, "check_type": c.check_type, "is_required": c.is_required,
        "test_method": c.test_method, "paint_spec": c.paint_spec,
        "weight_kgs": c.weight_kgs, "marking_type": c.marking_type,
        "status": c.status,
        "date_ready": c.date_ready.isoformat() if c.date_ready else None,
        "date_pending": c.date_pending.isoformat() if c.date_pending else None,
        "notes": c.notes,
    } for c in checks]
    steps = db.query(AssemblyStep).filter_by(production_line_id=line.id).order_by(AssemblyStep.step_no).all()
    steps_data = [{
        "id": s.id, "step_no": s.step_no, "label": s.label, "status": s.status,
        "completed_qty": getattr(s, "completed_qty", 0) or 0,
        "date_ready": s.date_ready.isoformat() if s.date_ready else None, "notes": s.notes,
    } for s in steps]
    return {"success": True, "data": {
        "requirement_id": line.id,
        "total_qty": line.quantity,
        "parts": parts_data,
        "final_checks": checks_data,
        "assembly_steps": steps_data,
        "joint_type_code": getattr(line, 'joint_type_code', None),
        "joint_category": getattr(line, 'joint_category', None),
        "paint_status": getattr(line, 'paint_status', None),
        "tag_no": getattr(line, 'joint_type_code', None),
    }}

@router.post("/processes/{process_id}/transactions")
def add_transaction(process_id: int, tx: TransactionCreate, db: Session = Depends(get_db), current_user: dict = Depends(require_roles(SUPERVISORS))):
    proc = db.query(PartProcess).filter_by(id=process_id).first()
    if not proc:
        raise HTTPException(status_code=404, detail="Process not found")
        
    if tx.operator_id is not None:
        user = db.query(User).filter_by(id=tx.operator_id).first()
        if not user:
            raise HTTPException(status_code=400, detail="Invalid operator")
        
    line = proc.part.production_line

    target = getattr(proc.part, 'total_qty', 0) or line.quantity

    if proc.completed_qty + tx.quantity_completed > target:
        raise HTTPException(status_code=400, detail=f"Cannot exceed part target quantity ({target})")

    proc.completed_qty += tx.quantity_completed

    from backend.services.progress_status import compute_process_status
    proc.status = compute_process_status(proc.completed_qty, target)
    if proc.status == "ready":
        proc.date_ready = tx.date_ready or date.today()
    if tx.po_number:
        proc.po_number = tx.po_number

    log = ProductionLog(
        part_process_id=process_id,
        operator_id=tx.operator_id,
        qty_done=tx.quantity_completed,
        feet_done=tx.feet_completed
    )
    db.add(log)
    
    db_user = db.query(User).filter_by(username=current_user["username"]).first() if current_user else None
    
    audit = AuditLog(
        user_id=db_user.id if db_user else None,
        username=current_user["username"] if current_user else None,
        action="Update",
        table_name="part_processes",
        record_id=proc.id,
        details=f"Produced {tx.quantity_completed}x of size {line.size} for {proc.process_name}. Feet: {tx.feet_completed}"
    )
    db.add(audit)
    
    db.commit()
    return {"success": True, "message": f"Added {tx.quantity_completed} to {proc.process_name}"}

class PaintStatusUpdate(BaseModel):
    status: str

@router.put("/requirements/{req_id}/paint-status")
def update_paint_status(req_id: int, body: PaintStatusUpdate, db: Session = Depends(get_db), current_user: dict = Depends(require_roles(SUPERVISORS))):
    line = db.query(ProjectProductionLine).filter_by(id=req_id).first()
    if not line:
        raise HTTPException(status_code=404, detail="Requirement not found")
    if body.status not in joint_catalog.PAINT_STATES:
        raise HTTPException(status_code=400, detail=f"status must be one of {joint_catalog.PAINT_STATES}")
    line.paint_status = body.status
    db.commit()
    return {"success": True, "message": f"Paint status set to {body.status}"}

@router.put("/final-checks/{check_id}")
def update_final_check(check_id: int, body: FinalCheckUpdate, db: Session = Depends(get_db),
                       current_user: dict = Depends(require_roles(SUPERVISORS))):
    check = db.query(JobFinalCheck).filter_by(id=check_id).first()
    if not check:
        raise HTTPException(status_code=404, detail="Final check not found")
    for field, value in body.model_dump(exclude_unset=True).items():
        setattr(check, field, value)
    db_user = db.query(User).filter_by(username=current_user["username"]).first() if current_user else None
    if db_user:
        check.updated_by = db_user.id
    db.add(AuditLog(
        user_id=db_user.id if db_user else None,
        username=current_user["username"] if current_user else None,
        action="Update", table_name="job_final_checks", record_id=check.id,
        details=f"Updated {check.check_type} -> status={check.status}",
    ))
    db.commit()
    return {"success": True, "message": f"Updated {check.check_type}"}

class AssemblyStepUpdate(BaseModel):
    status: Optional[str] = None
    completed_qty: Optional[int] = None
    date_ready: Optional[date] = None
    notes: Optional[str] = None

@router.put("/assembly-steps/{step_id}")
def update_assembly_step(step_id: int, body: AssemblyStepUpdate, db: Session = Depends(get_db),
                         current_user: dict = Depends(require_roles(SUPERVISORS))):
    step = db.query(AssemblyStep).filter_by(id=step_id).first()
    if not step:
        raise HTTPException(status_code=404, detail="Assembly step not found")
    for field, value in body.model_dump(exclude_unset=True).items():
        setattr(step, field, value)
    db_user = db.query(User).filter_by(username=current_user["username"]).first() if current_user else None
    db.add(AuditLog(
        user_id=db_user.id if db_user else None,
        username=current_user["username"] if current_user else None,
        action="Update", table_name="assembly_steps", record_id=step.id,
        details=f"Updated assembly step {step.step_no} -> status={step.status}",
    ))
    db.commit()
    return {"success": True, "message": f"Updated assembly step {step.step_no}"}

from backend.app.production.schemas import WeldingLogCreate
from backend.services.db_service import WeldingLog

@router.get("/requirements/{req_id}/welding_summary")
def get_welding_summary(req_id: int, db: Session = Depends(get_db), current_user: dict = Depends(require_roles(SUPERVISORS))):
    line = db.query(ProjectProductionLine).filter_by(id=req_id).first()
    if not line:
        raise HTTPException(status_code=404, detail="Requirement not found")
        
    logs = db.query(WeldingLog).filter_by(production_line_id=req_id).all()
    
    completed = {"TIG": 0.0, "MIG": 0.0, "Grinding": 0.0}
    for log in logs:
        if log.process_type in completed:
            completed[log.process_type] += log.feet_done
            
    return {"success": True, "data": {
        "joint_type": getattr(line, 'joint_type', 'EJ'),
        "targets": {
            "TIG": line.tig_feet,
            "MIG": line.mig_feet,
            "Grinding": line.grinding_feet
        },
        "completed": completed
    }}

VALID_WELDING_PROCESS_TYPES = ("TIG", "MIG", "Grinding")

@router.post("/requirements/{req_id}/welding_logs")
def add_welding_log(req_id: int, tx: WeldingLogCreate, db: Session = Depends(get_db), current_user: dict = Depends(require_roles(SUPERVISORS))):
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

    if tx.operator_id is not None:
        user = db.query(User).filter_by(id=tx.operator_id).first()
        if not user:
            raise HTTPException(status_code=400, detail="Invalid operator")

    log = WeldingLog(
        production_line_id=req_id,
        operator_id=tx.operator_id,
        process_type=tx.process_type,
        feet_done=tx.feet_done
    )
    db.add(log)
    
    db_user = db.query(User).filter_by(username=current_user["username"]).first() if current_user else None
    
    audit = AuditLog(
        user_id=db_user.id if db_user else None,
        username=current_user["username"] if current_user else None,
        action="Update",
        table_name="welding_logs",
        record_id=req_id,
        details=f"Added {tx.feet_done} feet of {tx.process_type} for requirement {req_id}"
    )
    db.add(audit)
    
    db.commit()

    # Recalculate required resources so pending feet + welder counts stay current
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
        pass  # never fail the log submission over a recalc error

    return {"success": True, "message": f"Added {tx.feet_done} feet to {tx.process_type}"}
