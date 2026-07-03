from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from datetime import datetime, date
import math
from typing import List, Optional
from pydantic import BaseModel

from backend.services.db_service import get_db, Project, ProjectResourceAssignment, ProjectProductionLine, WorkforceMaster, ProjectHoldHistory
from backend.services.production_service import sync_project_production_lines, calculate_project_duration, get_welding_master_latest, calculate_required_resources_for_deadline
from backend.app.projects.schemas import ProjectCreate, ProjectUpdate, SimulationRequest, DurationRequest, SimulateDurationRequest, BellowItem

router = APIRouter(prefix="/api/v1/projects", tags=["Projects"])

@router.get("/debug_reload_feet")
def debug_reload_feet(db: Session = Depends(get_db)):
    """Temporary endpoint to reload existing project lines with live master values."""
    master_records = get_welding_master_latest()
    master_data = {(m.size, m.joint_type): m for m in master_records}
    lines = db.query(ProjectProductionLine).all()
    updated_count = 0
    for line in lines:
        size = line.size
        qty = line.quantity
        j_type = getattr(line, 'joint_type', 'EJ')
        m = master_data.get((size, j_type))
        if not m and j_type == 'DJ':
            m = master_data.get((size, 'EJ'))
        if m:
            if j_type == 'DJ':
                new_tig = 0.0
                new_mig = ((m.tig_feet or 0.0) + (m.mig_feet or 0.0)) * qty
                new_grind = (m.grinding_feet or 0.0) * qty
            else:
                new_tig = (m.tig_feet or 0.0) * qty
                new_mig = (m.mig_feet or 0.0) * qty
                new_grind = (m.grinding_feet or 0.0) * qty
            if line.tig_feet != new_tig or line.mig_feet != new_mig or line.grinding_feet != new_grind:
                line.tig_feet = new_tig
                line.mig_feet = new_mig
                line.grinding_feet = new_grind
                updated_count += 1
    db.commit()
    
    # Recalculate resources for all projects
    from backend.services.db_service import Project, ProjectResourceAssignment
    from backend.services.production_service import calculate_project_duration
    
    projects = db.query(Project).all()
    res_updated = 0
    for p in projects:
        assign = db.query(ProjectResourceAssignment).filter_by(project_id=p.id).first()
        if assign:
            calculate_project_duration(
                p.id, 
                assign.assigned_tig_welders, 
                assign.assigned_mig_welders, 
                assign.assigned_grinders
            )
            res_updated += 1
            
    return {"success": True, "message": f"Successfully reloaded {updated_count} project production lines and recalculated metrics for {res_updated} projects."}

@router.get("")
def get_projects(db: Session = Depends(get_db)):
    projects = db.query(Project).all()
    results = []
    from backend.services.mes_service import MESService
    from datetime import date
    
    for p in projects:
        assign = db.query(ProjectResourceAssignment).filter_by(project_id=p.id).first()
        lines = db.query(ProjectProductionLine).filter_by(project_id=p.id).all()
        
        bellows = [{
            "size": l.size,
            "quantity": l.quantity,
            "type": getattr(l, "joint_type", "EJ"),
            "pn_rating": getattr(l, "pn_rating", None),
            "tig_feet": round(l.tig_feet, 2) if l.tig_feet else 0,
            "mig_feet": round(l.mig_feet, 2) if l.mig_feet else 0,
            "grinding_feet": round(l.grinding_feet, 2) if l.grinding_feet else 0
        } for l in lines]
        
        progress = MESService.calculate_project_progress(db, p.id)
        
        target_date = p.target_date if getattr(p, "target_date", None) else (assign.target_date if assign else None)
        
        priority = "P3"
        if target_date:
            today_date = date.today()
            t_date = target_date.date() if isinstance(target_date, datetime) else target_date
            days_away = (t_date - today_date).days
            if days_away <= 21:
                priority = "P1"
            elif days_away <= 60:
                priority = "P2"
                
        results.append({
            "id": p.id,
            "quotation_no": p.quotation_no,
            "project_name": p.project_name,
            "status": getattr(p, "status", "Active"),
            "status_note": getattr(p, "status_note", None),
            "hold_until_date": getattr(p, "hold_until_date", None),
            "hold_type": getattr(p, "hold_type", None),
            "target_date": target_date,
            "payroll": getattr(p, "payroll", "Company"),
            "priority": priority,
            "estimated_duration_days": assign.estimated_duration_days if assign else 0,
            "assigned_tig": assign.assigned_tig_welders if assign else 0,
            "assigned_mig": assign.assigned_mig_welders if assign else 0,
            "assigned_grinders": assign.assigned_grinders if assign else 0,
            "bellows": bellows,
            "progress_percentage": round(progress, 2)
        })
    return {"success": True, "message": "Projects retrieved", "data": results}


@router.get("/holds")
def get_holds(db: Session = Depends(get_db)):
    active_holds = db.query(ProjectHoldHistory).filter(ProjectHoldHistory.resume_date == None).all()
    results = []
    for h in active_holds:
        proj = db.query(Project).filter(Project.id == h.project_id).first()
        days_on_hold = (datetime.utcnow() - h.hold_date).days
        results.append({
            "id": h.id,
            "project_id": h.project_id,
            "project_name": proj.project_name if proj else "Unknown",
            "quotation_no": proj.quotation_no if proj else "Unknown",
            "hold_type": h.hold_type,
            "comments": h.comments,
            "hold_date": h.hold_date,
            "days_on_hold": days_on_hold
        })
    return {"success": True, "message": "Holds retrieved", "data": results}

@router.post("")

def create_project(req: ProjectCreate, db: Session = Depends(get_db)):
    existing = db.query(Project).filter(Project.quotation_no == req.quotation_no).first()
    if existing:
        raise HTTPException(status_code=400, detail="Project Code already exists")
        
    new_proj = Project(
        quotation_no=req.quotation_no,
        client_name="",
        project_name=req.project_name or req.quotation_no,
        contact_person="Production User",
        target_date=req.target_date,
        payroll=req.payroll,
        created_at=datetime.utcnow(),
        status="Active"
    )
    db.add(new_proj)
    db.commit()
    
    dt_deadline = datetime.combine(req.target_date, datetime.min.time()) if req.target_date else datetime.utcnow()
    assign = ProjectResourceAssignment(
        project_id=new_proj.id, 
        target_date=dt_deadline,
        assigned_tig_welders=req.assigned_tig,
        assigned_mig_welders=req.assigned_mig,
        assigned_grinders=req.assigned_grinders
    )
    db.add(assign)
    db.commit()
    
    if req.bellows:
        bellows_data = [{"size": b.size, "qty": b.qty, "type": getattr(b, "type", "EJ"), "pn_rating": getattr(b, "pn_rating", None)} for b in req.bellows]
        sync_project_production_lines(new_proj.id, bellows_data)
        
        target_days = (dt_deadline.date() - datetime.utcnow().date()).days if req.target_date else 15
        target_days = max(1, target_days)
        
        if req.assigned_tig in (0, None) or req.assigned_mig in (0, None) or req.assigned_grinders in (0, None):
            req_tig, req_mig, req_grind = calculate_required_resources_for_deadline(new_proj.id, target_days)
            if req.assigned_tig in (0, None): assign.assigned_tig_welders = req_tig
            if req.assigned_mig in (0, None): assign.assigned_mig_welders = req_mig
            if req.assigned_grinders in (0, None): assign.assigned_grinders = req_grind
            db.commit()
            
        calculate_project_duration(new_proj.id, assign.assigned_tig_welders or 0, assign.assigned_mig_welders or 0, assign.assigned_grinders or 0)
        
    return {"success": True, "message": "Project created successfully", "data": {"id": new_proj.id}}

@router.put("/{project_id}")
def update_project(project_id: int, req: ProjectUpdate, db: Session = Depends(get_db)):
    proj = db.query(Project).filter(Project.id == project_id).first()
    if not proj:
        raise HTTPException(status_code=404, detail="Project not found")
        

    if req.status:
        if req.status == "Hold" and proj.status != "Hold":
            hold = ProjectHoldHistory(
                project_id=project_id,
                hold_type=req.hold_type or "General Hold",
                comments=req.status_note,
                hold_date=datetime.utcnow()
            )
            db.add(hold)
            proj.hold_type = req.hold_type or "General Hold"
        elif req.status != "Hold" and proj.status == "Hold":
            active_hold = db.query(ProjectHoldHistory).filter(ProjectHoldHistory.project_id == project_id, ProjectHoldHistory.resume_date == None).first()
            if active_hold:
                active_hold.resume_date = datetime.utcnow()
            proj.hold_type = None
            proj.status_note = None
        proj.status = req.status
        
    if req.status_note is not None:
        proj.status_note = req.status_note
        if proj.status == "Hold":
            active_hold = db.query(ProjectHoldHistory).filter(ProjectHoldHistory.project_id == project_id, ProjectHoldHistory.resume_date == None).first()
            if active_hold:
                active_hold.comments = req.status_note
                
    if req.hold_type is not None:
        proj.hold_type = req.hold_type
        if proj.status == "Hold":
            active_hold = db.query(ProjectHoldHistory).filter(ProjectHoldHistory.project_id == project_id, ProjectHoldHistory.resume_date == None).first()
            if active_hold:
                active_hold.hold_type = req.hold_type

        
    if req.hold_until_date is not None:
        proj.hold_until_date = req.hold_until_date
        
    if req.target_date is not None:
        proj.target_date = req.target_date
        
    if req.payroll is not None:
        proj.payroll = req.payroll
        
    assign = db.query(ProjectResourceAssignment).filter(ProjectResourceAssignment.project_id == project_id).first()
    if assign:
        if req.assigned_tig is not None:
            assign.assigned_tig_welders = req.assigned_tig
        if req.assigned_mig is not None:
            assign.assigned_mig_welders = req.assigned_mig
        if req.assigned_grinders is not None:
            assign.assigned_grinders = req.assigned_grinders
            
        db.commit()
        calculate_project_duration(
            project_id, 
            assign.assigned_tig_welders or 0, 
            assign.assigned_mig_welders or 0, 
            assign.assigned_grinders or 0
        )
    else:
        db.commit()

    return {"success": True, "message": "Project updated successfully", "data": {}}

@router.delete("/{project_id}")
def delete_project(project_id: int, db: Session = Depends(get_db)):
    proj = db.query(Project).filter(Project.id == project_id).first()
    if not proj:
        raise HTTPException(status_code=404, detail="Project not found")
        
    from backend.services.db_service import ProjectHoldHistory, DailyTaskAssignment, WeldingLog
    
    # 1. Delete manual dependencies not tracked by SQLAlchemy cascades
    db.query(ProjectHoldHistory).filter(ProjectHoldHistory.project_id == project_id).delete(synchronize_session=False)
    db.query(DailyTaskAssignment).filter(DailyTaskAssignment.project_id == project_id).delete(synchronize_session=False)
    
    line_ids = [l.id for l in db.query(ProjectProductionLine.id).filter(ProjectProductionLine.project_id == project_id).all()]
    if line_ids:
        db.query(WeldingLog).filter(WeldingLog.production_line_id.in_(line_ids)).delete(synchronize_session=False)
        
    # 2. Use SQLAlchemy python-level cascade to delete proj -> production_lines -> parts -> processes -> logs
    db.delete(proj)
    db.commit()
    return {"success": True, "message": "Project deleted successfully", "data": {}}

@router.post("/simulate")
def simulate_project(req: SimulationRequest, db: Session = Depends(get_db)):
    tot_tig, tot_mig, tot_grind = 0, 0, 0
    master_data = {(m.size, m.joint_type or 'EJ'): m for m in get_welding_master_latest()}
    
    for b in req.bellows:
        b_type = getattr(b, 'type', 'EJ')
        m = master_data.get((b.size, b_type))
        
        if not m and b_type == 'DJ':
            m = master_data.get((b.size, 'EJ'))
                
        if m:
            if b_type == 'DJ':
                tot_mig += ((m.tig_feet or 0) + (m.mig_feet or 0)) * b.qty
                tot_grind += (m.grinding_feet or 0) * b.qty
            else:
                tot_tig += (m.tig_feet or 0) * b.qty
                tot_mig += (m.mig_feet or 0) * b.qty
                tot_grind += (m.grinding_feet or 0) * b.qty
            
    workforce = db.query(WorkforceMaster).all()
    prod = {w.resource_type: w.avg_productivity_per_day for w in workforce}
    
    tig_prod = prod.get("TIG Welder", 180.0)
    mig_prod = prod.get("MIG Welder", 120.0)
    grind_prod = prod.get("Grinder", 80.0)
    
    effective_target_days = max(1, req.target_days)
    req_tig = math.ceil(tot_tig / (effective_target_days * tig_prod)) if tig_prod > 0 else 0
    req_mig = math.ceil(tot_mig / (effective_target_days * mig_prod)) if mig_prod > 0 else 0
    req_grind = math.ceil(tot_grind / (effective_target_days * grind_prod)) if grind_prod > 0 else 0
    
    return {"success": True, "message": "Simulation successful", "data": {
        "req_tig": req_tig,
        "req_mig": req_mig,
        "req_grind": req_grind,
        "tot_tig": tot_tig,
        "tot_mig": tot_mig,
        "tot_grind": tot_grind
    }}

@router.get("/{project_id}/bellows")
def get_project_bellows(project_id: int, db: Session = Depends(get_db)):
    lines = db.query(ProjectProductionLine).filter(ProjectProductionLine.project_id == project_id).all()
    return {"success": True, "message": "Bellows retrieved", "data": [{"size": l.size, "qty": l.quantity, "type": getattr(l, "joint_type", "EJ"), "pn_rating": getattr(l, "pn_rating", None)} for l in lines]}

@router.put("/{project_id}/bellows")
def update_project_bellows(project_id: int, req: List[BellowItem], db: Session = Depends(get_db)):
    bellows_data = [{"size": b.size, "qty": b.qty, "type": getattr(b, "type", "EJ"), "pn_rating": getattr(b, "pn_rating", None)} for b in req]
    sync_project_production_lines(project_id, bellows_data)
    
    assign = db.query(ProjectResourceAssignment).filter(ProjectResourceAssignment.project_id == project_id).first()
    if assign:
        calculate_project_duration(project_id, assign.assigned_tig_welders or 0, assign.assigned_mig_welders or 0, assign.assigned_grinders or 0)
    return {"success": True, "message": "Bellows updated", "data": {}}

@router.post("/duration")
def get_duration(req: DurationRequest, db: Session = Depends(get_db)):
    dur, t, m, g = calculate_project_duration(req.project_id, req.assigned_tig, req.assigned_mig, req.assigned_grinders)
    return {"success": True, "message": "Duration retrieved", "data": {"estimated_duration_days": dur}}

@router.post("/simulate_duration")
def simulate_duration(req: SimulateDurationRequest, db: Session = Depends(get_db)):
    tot_tig, tot_mig, tot_grind = 0, 0, 0
    master_data = {(m.size, m.joint_type or 'EJ'): m for m in get_welding_master_latest()}
    for b in req.bellows:
        b_type = getattr(b, 'type', 'EJ')
        m = master_data.get((b.size, b_type))
        
        if not m and b_type == 'DJ':
            m = master_data.get((b.size, 'EJ'))
                
        if m:
            if b_type == 'DJ':
                tot_mig += ((m.tig_feet or 0) + (m.mig_feet or 0)) * b.qty
                tot_grind += (m.grinding_feet or 0) * b.qty
            else:
                tot_tig += (m.tig_feet or 0) * b.qty
                tot_mig += (m.mig_feet or 0) * b.qty
                tot_grind += (m.grinding_feet or 0) * b.qty
            
    workforce = db.query(WorkforceMaster).all()
    prod = {w.resource_type: w.avg_productivity_per_day for w in workforce}
    tig_prod = prod.get("TIG Welder", 180.0)
    mig_prod = prod.get("MIG Welder", 120.0)
    grind_prod = prod.get("Grinder", 80.0)
    
    days_tig = (tot_tig / (req.assigned_tig * tig_prod)) if req.assigned_tig > 0 and tig_prod > 0 else (tot_tig / tig_prod if tig_prod > 0 else 0)
    days_mig = (tot_mig / (req.assigned_mig * mig_prod)) if req.assigned_mig > 0 and mig_prod > 0 else (tot_mig / mig_prod if mig_prod > 0 else 0)
    days_grind = (tot_grind / (req.assigned_grinders * grind_prod)) if req.assigned_grinders > 0 and grind_prod > 0 else (tot_grind / grind_prod if grind_prod > 0 else 0)
    
    if req.assigned_tig == 0 and tot_tig > 0: days_tig = 999
    if req.assigned_mig == 0 and tot_mig > 0: days_mig = 999
    if req.assigned_grinders == 0 and tot_grind > 0: days_grind = 999
    
    dur = math.ceil(max(days_tig, days_mig, days_grind))
    if dur == 999: dur = 0
    return {"success": True, "message": "Duration simulated", "data": {"estimated_duration_days": dur}}

class SimulateResourcesRequest(BaseModel):
    bellows: List[BellowItem]
    target_date: Optional[date] = None

@router.post("/simulate_resources")
def simulate_resources(req: SimulateResourcesRequest, db: Session = Depends(get_db)):
    tot_tig, tot_mig, tot_grind = 0, 0, 0
    master_data = {(m.size, m.joint_type or 'EJ'): m for m in get_welding_master_latest()}
    for b in req.bellows:
        b_type = getattr(b, 'type', 'EJ')
        m = master_data.get((b.size, b_type))
        
        if not m and b_type == 'DJ':
            m = master_data.get((b.size, 'EJ'))
                
        if m:
            if b_type == 'DJ':
                tot_mig += ((m.tig_feet or 0) + (m.mig_feet or 0)) * b.qty
                tot_grind += (m.grinding_feet or 0) * b.qty
            else:
                tot_tig += (m.tig_feet or 0) * b.qty
                tot_mig += (m.mig_feet or 0) * b.qty
                tot_grind += (m.grinding_feet or 0) * b.qty
            
    workforce = db.query(WorkforceMaster).all()
    prod = {w.resource_type: w.avg_productivity_per_day for w in workforce}
    tig_prod = prod.get("TIG Welder", 180.0)
    mig_prod = prod.get("MIG Welder", 120.0)
    grind_prod = prod.get("Grinder", 80.0)
    
    target_days = 15
    if req.target_date:
        days_away = (req.target_date - date.today()).days
        if days_away > 0:
            target_days = days_away
            
    req_tig = math.ceil(tot_tig / (target_days * tig_prod)) if tig_prod > 0 else 0
    req_mig = math.ceil(tot_mig / (target_days * mig_prod)) if mig_prod > 0 else 0
    req_grind = math.ceil(tot_grind / (target_days * grind_prod)) if grind_prod > 0 else 0
    
    return {"success": True, "message": "Resources simulated", "data": {
        "assigned_tig": req_tig,
        "assigned_mig": req_mig,
        "assigned_grinders": req_grind
    }}


@router.get("/{project_id}/requirements")
def get_requirements(project_id: int, db: Session = Depends(get_db)):
    lines = db.query(ProjectProductionLine).filter_by(project_id=project_id).all()
    return {"success": True, "message": "Requirements retrieved", "data": [{"id": l.id, "type": "EJ", "size": str(l.size), "total_qty": l.quantity} for l in lines]}
