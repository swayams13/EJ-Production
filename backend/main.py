import os
from fastapi import FastAPI, HTTPException, Depends
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import List, Optional
from datetime import datetime, date
from dotenv import load_dotenv

load_dotenv()

from sqlalchemy.orm import Session
from backend.services.db_service import (
    SessionLocal, Project, ProjectProductionLine, ProjectResourceAssignment, init_db
)
from backend.services.production_service import (
    get_company_capacity_status,
    get_welding_master_latest,
    import_welding_master_from_disk,
    calculate_project_duration,
    generate_master_production_register_excel
)

app = FastAPI(title="EJ Production API")

# Configure CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # In production, specify exactly Next.js domain
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Init DB
init_db()

# Dependency
def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()

# Models
class LoginRequest(BaseModel):
    username: str
    password: str

class BellowItem(BaseModel):
    size: int
    qty: int

class ProjectCreate(BaseModel):
    quotation_no: str
    project_name: Optional[str] = None
    target_date: Optional[date] = None
    bellows: List[BellowItem] = []
    assigned_tig: Optional[int] = 0
    assigned_mig: Optional[int] = 0
    assigned_grinders: Optional[int] = 0

class ProjectUpdate(BaseModel):
    status: Optional[str] = None
    assigned_tig: Optional[int] = None
    assigned_mig: Optional[int] = None
    assigned_grinders: Optional[int] = None

class SimulationRequest(BaseModel):
    target_days: int
    bellows: List[BellowItem] = []

class WorkforceUpdate(BaseModel):
    productivity: float

class PoolUpdate(BaseModel):
    total_tig_welders: int
    total_mig_welders: int
    total_grinders: int

class DurationRequest(BaseModel):
    project_id: int
    assigned_tig: int
    assigned_mig: int
    assigned_grinders: int

class SimulateDurationRequest(BaseModel):
    bellows: List[BellowItem] = []
    assigned_tig: int
    assigned_mig: int
    assigned_grinders: int

# Endpoints
@app.post("/api/auth/login")
def login(req: LoginRequest):
    # Check hardcoded roles first for specific role names
    if req.username == os.getenv("DEV_USER") and req.password == os.getenv("DEV_PASS"):
        return {"role": "Developer"}
    elif req.username == os.getenv("GM_USER") and req.password == os.getenv("GM_PASS"):
        return {"role": "GM"}
    elif req.username == os.getenv("PM_USER") and req.password == os.getenv("PM_PASS"):
        return {"role": "Production Manager"}
        
    # Dynamically check any other custom users added to Railway variables
    for key, value in os.environ.items():
        if key.endswith("_USER") and value == req.username:
            prefix = key[:-5]
            pass_key = f"{prefix}_PASS"
            if os.getenv(pass_key) == req.password:
                role_name = prefix.replace("_", " ").title()
                return {"role": role_name}
                
    raise HTTPException(status_code=401, detail="Invalid credentials")

@app.get("/api/dashboard/status")
def dashboard_status(target_days: int = 15):
    status = get_company_capacity_status(target_days)
    return status

@app.get("/api/projects")
def get_projects(db = Depends(get_db)):
    projects = db.query(Project).all()
    results = []
    from backend.services.mes_service import MESService
    for p in projects:
        assign = db.query(ProjectResourceAssignment).filter_by(project_id=p.id).first()
        lines = db.query(ProjectProductionLine).filter_by(project_id=p.id).all()
        
        bellows = [{
            "size": l.size,
            "quantity": l.quantity,
            "tig_feet": round(l.tig_feet, 2) if l.tig_feet else 0,
            "mig_feet": round(l.mig_feet, 2) if l.mig_feet else 0,
            "grinding_feet": round(l.grinding_feet, 2) if l.grinding_feet else 0
        } for l in lines]
        
        progress = MESService.calculate_project_progress(db, p.id)
        
        results.append({
            "id": p.id,
            "quotation_no": p.quotation_no,
            "project_name": p.project_name,
            "status": getattr(p, "status", "Active"),
            "target_date": assign.target_date if assign else None,
            "estimated_duration_days": assign.estimated_duration_days if assign else 0,
            "assigned_tig": assign.assigned_tig_welders if assign else 0,
            "assigned_mig": assign.assigned_mig_welders if assign else 0,
            "assigned_grinders": assign.assigned_grinders if assign else 0,
            "bellows": bellows,
            "progress_percentage": round(progress, 2)
        })
    return results

@app.get("/api/master/welding")
def get_welding_master():
    data = get_welding_master_latest()
    return [{"size": d.size, "tig_feet": round(d.tig_feet, 2) if d.tig_feet else 0, "mig_feet": round(d.mig_feet, 2) if d.mig_feet else 0, "grinding_feet": round(d.grinding_feet, 2) if d.grinding_feet else 0} for d in data]

@app.post("/api/master/sync")
def sync_master():
    success, msg = import_welding_master_from_disk()
    if not success:
        raise HTTPException(status_code=500, detail=msg)
    return {"message": msg}

from backend.services.production_service import sync_project_production_lines

@app.post("/api/projects")
def create_project(req: ProjectCreate, db = Depends(get_db)):
    existing = db.query(Project).filter(Project.quotation_no == req.quotation_no).first()
    if existing:
        raise HTTPException(status_code=400, detail="Project Code already exists")
        
    new_proj = Project(
        quotation_no=req.quotation_no,
        client_name="",
        project_name=req.project_name or req.quotation_no,
        contact_person="Production User",
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
        bellows_data = [{"size": b.size, "qty": b.qty} for b in req.bellows]
        sync_project_production_lines(new_proj.id, bellows_data)
        
        target_days = (dt_deadline.date() - datetime.utcnow().date()).days if req.target_date else 15
        target_days = max(1, target_days)
        
        if req.assigned_tig in (0, None) or req.assigned_mig in (0, None) or req.assigned_grinders in (0, None):
            from backend.services.production_service import calculate_required_resources_for_deadline
            req_tig, req_mig, req_grind = calculate_required_resources_for_deadline(new_proj.id, target_days)
            if req.assigned_tig in (0, None): assign.assigned_tig_welders = req_tig
            if req.assigned_mig in (0, None): assign.assigned_mig_welders = req_mig
            if req.assigned_grinders in (0, None): assign.assigned_grinders = req_grind
            db.commit()
            
        calculate_project_duration(new_proj.id, assign.assigned_tig_welders or 0, assign.assigned_mig_welders or 0, assign.assigned_grinders or 0)
        
    return {"id": new_proj.id, "message": "Project created successfully"}

@app.put("/api/projects/{project_id}")
def update_project(project_id: int, req: ProjectUpdate, db = Depends(get_db)):
    proj = db.query(Project).filter(Project.id == project_id).first()
    if not proj:
        raise HTTPException(status_code=404, detail="Project not found")
        
    if req.status:
        proj.status = req.status
        
    assign = db.query(ProjectResourceAssignment).filter(ProjectResourceAssignment.project_id == project_id).first()
    if assign:
        if req.assigned_tig is not None:
            assign.assigned_tig_welders = req.assigned_tig
        if req.assigned_mig is not None:
            assign.assigned_mig_welders = req.assigned_mig
        if req.assigned_grinders is not None:
            assign.assigned_grinders = req.assigned_grinders
            
        db.commit()
        # Recalculate duration
        calculate_project_duration(
            project_id, 
            assign.assigned_tig_welders or 0, 
            assign.assigned_mig_welders or 0, 
            assign.assigned_grinders or 0
        )
    else:
        db.commit()

    return {"message": "Project updated successfully"}

@app.delete("/api/projects/{project_id}")
def delete_project(project_id: int, db = Depends(get_db)):
    proj = db.query(Project).filter(Project.id == project_id).first()
    if not proj:
        raise HTTPException(status_code=404, detail="Project not found")
        
    db.query(ProjectResourceAssignment).filter(ProjectResourceAssignment.project_id == project_id).delete()
    db.query(ProjectProductionLine).filter(ProjectProductionLine.project_id == project_id).delete()
    db.delete(proj)
    db.commit()
    return {"message": "Project deleted successfully"}

import math
from backend.services.db_service import WorkforceMaster

@app.post("/api/projects/simulate")
def simulate_project(req: SimulationRequest, db = Depends(get_db)):
    # Calculate live workforce suggestions based on bellows array and target_days
    tot_tig, tot_mig, tot_grind = 0, 0, 0
    master_data = {m.size: m for m in get_welding_master_latest()}
    
    for b in req.bellows:
        m = master_data.get(b.size)
        if m:
            tot_tig += (m.tig_feet or 0) * b.qty
            tot_mig += (m.mig_feet or 0) * b.qty
            tot_grind += (m.grinding_feet or 0) * b.qty
            
    workforce = db.query(WorkforceMaster).all()
    prod = {w.resource_type: w.avg_productivity_per_day for w in workforce}
    
    tig_prod = prod.get("TIG Welder", 180)
    mig_prod = prod.get("MIG Welder", 120)
    grind_prod = prod.get("Grinder", 80)
    
    effective_target_days = max(1, req.target_days)
    req_tig = math.ceil(tot_tig / (effective_target_days * tig_prod)) if tig_prod > 0 else 0
    req_mig = math.ceil(tot_mig / (effective_target_days * mig_prod)) if mig_prod > 0 else 0
    req_grind = math.ceil(tot_grind / (effective_target_days * grind_prod)) if grind_prod > 0 else 0
    
    return {
        "req_tig": req_tig,
        "req_mig": req_mig,
        "req_grind": req_grind,
        "tot_tig": tot_tig,
        "tot_mig": tot_mig,
        "tot_grind": tot_grind
    }

from fastapi.responses import StreamingResponse
import io

@app.get("/api/dashboard/export")
def export_dashboard():
    excel_bytes = generate_master_production_register_excel()
    if not excel_bytes:
        raise HTTPException(status_code=500, detail="Failed to generate excel")
        
    return StreamingResponse(
        io.BytesIO(excel_bytes),
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": "attachment; filename=Master_Production_Register.xlsx"}
    )

from backend.services.db_service import CompanyResourcePool

@app.get("/api/master/workforce")
def get_workforce(db = Depends(get_db)):
    wf = db.query(WorkforceMaster).all()
    return [{"id": w.id, "resource_type": w.resource_type, "productivity": w.avg_productivity_per_day} for w in wf]

@app.put("/api/master/workforce/{wf_id}")
def update_workforce(wf_id: int, req: WorkforceUpdate, db = Depends(get_db)):
    w = db.query(WorkforceMaster).filter(WorkforceMaster.id == wf_id).first()
    if w:
        w.avg_productivity_per_day = req.productivity
        db.commit()
    return {"message": "Success"}

@app.get("/api/master/pool")
def get_pool(db = Depends(get_db)):
    pool = db.query(CompanyResourcePool).first()
    if not pool:
        return {"total_tig_welders": 0, "total_mig_welders": 0, "total_grinders": 0}
    return {
        "total_tig_welders": pool.total_tig_welders,
        "total_mig_welders": pool.total_mig_welders,
        "total_grinders": pool.total_grinders
    }

@app.put("/api/master/pool")
def update_pool(req: PoolUpdate, db = Depends(get_db)):
    pool = db.query(CompanyResourcePool).first()
    if not pool:
        pool = CompanyResourcePool()
        db.add(pool)
    pool.total_tig_welders = req.total_tig_welders
    pool.total_mig_welders = req.total_mig_welders
    pool.total_grinders = req.total_grinders
    db.commit()
    return {"message": "Success"}

@app.get("/api/projects/{project_id}/bellows")
def get_project_bellows(project_id: int, db = Depends(get_db)):
    lines = db.query(ProjectProductionLine).filter(ProjectProductionLine.project_id == project_id).all()
    return [{"size": l.size, "qty": l.quantity} for l in lines]

@app.put("/api/projects/{project_id}/bellows")
def update_project_bellows(project_id: int, req: List[BellowItem], db = Depends(get_db)):
    bellows_data = [{"size": b.size, "qty": b.qty} for b in req]
    sync_project_production_lines(project_id, bellows_data)
    
    assign = db.query(ProjectResourceAssignment).filter(ProjectResourceAssignment.project_id == project_id).first()
    if assign:
        calculate_project_duration(project_id, assign.assigned_tig_welders or 0, assign.assigned_mig_welders or 0, assign.assigned_grinders or 0)
    return {"message": "Success"}

@app.post("/api/projects/duration")
def get_duration(req: DurationRequest, db = Depends(get_db)):
    dur, t, m, g = calculate_project_duration(req.project_id, req.assigned_tig, req.assigned_mig, req.assigned_grinders)
    return {"estimated_duration_days": dur}

@app.post("/api/projects/simulate_duration")
def simulate_duration(req: SimulateDurationRequest, db = Depends(get_db)):
    tot_tig, tot_mig, tot_grind = 0, 0, 0
    master_data = {m.size: m for m in get_welding_master_latest()}
    for b in req.bellows:
        m = master_data.get(b.size)
        if m:
            tot_tig += (m.tig_feet or 0) * b.qty
            tot_mig += (m.mig_feet or 0) * b.qty
            tot_grind += (m.grinding_feet or 0) * b.qty
            
    workforce = db.query(WorkforceMaster).all()
    prod = {w.resource_type: w.avg_productivity_per_day for w in workforce}
    tig_prod = prod.get("TIG Welder", 180)
    mig_prod = prod.get("MIG Welder", 120)
    grind_prod = prod.get("Grinder", 80)
    
    days_tig = (tot_tig / (req.assigned_tig * tig_prod)) if req.assigned_tig > 0 and tig_prod > 0 else (tot_tig / tig_prod if tig_prod > 0 else 0)
    days_mig = (tot_mig / (req.assigned_mig * mig_prod)) if req.assigned_mig > 0 and mig_prod > 0 else (tot_mig / mig_prod if mig_prod > 0 else 0)
    days_grind = (tot_grind / (req.assigned_grinders * grind_prod)) if req.assigned_grinders > 0 and grind_prod > 0 else (tot_grind / grind_prod if grind_prod > 0 else 0)
    
    if req.assigned_tig == 0 and tot_tig > 0: days_tig = 999
    if req.assigned_mig == 0 and tot_mig > 0: days_mig = 999
    if req.assigned_grinders == 0 and tot_grind > 0: days_grind = 999
    
    import math
    dur = math.ceil(max(days_tig, days_mig, days_grind))
    if dur == 999: dur = 0
    return {"estimated_duration_days": dur}

# --- MES Endpoints ---

from backend.services.db_service import Part, PartProcess, ProductionLog, User, AuditLog

class TransactionCreate(BaseModel):
    operator_id: int
    quantity_completed: int

class UserCreate(BaseModel):
    username: str
    full_name: str
    password: str
    role: str = "Operator"

@app.get("/api/projects/{project_id}/requirements")
def get_requirements(project_id: int, db = Depends(get_db)):
    lines = db.query(ProjectProductionLine).filter_by(project_id=project_id).all()
    return [{"id": l.id, "type": "EJ", "size": str(l.size), "total_qty": l.quantity} for l in lines]

@app.get("/api/requirements/{req_id}/parts")
def get_requirement_parts(req_id: int, db = Depends(get_db)):
    line = db.query(ProjectProductionLine).filter_by(id=req_id).first()
    if not line:
        raise HTTPException(status_code=404)
    parts_data = []
    for part in line.parts:
        proc_data = []
        for proc in part.processes:
            proc_data.append({
                "id": proc.id,
                "process_name": proc.process_name,
                "completed_qty": proc.completed_qty
            })
        parts_data.append({
            "id": part.id,
            "name": part.name,
            "weight_percentage": part.weight_percentage,
            "processes": proc_data
        })
    return {"requirement_id": line.id, "total_qty": line.quantity, "parts": parts_data}

@app.post("/api/processes/{process_id}/transactions")
def add_transaction(process_id: int, tx: TransactionCreate, db = Depends(get_db)):
    proc = db.query(PartProcess).filter_by(id=process_id).first()
    if not proc:
        raise HTTPException(status_code=404, detail="Process not found")
        
    user = db.query(User).filter_by(id=tx.operator_id).first()
    if not user:
        raise HTTPException(status_code=400, detail="Invalid operator")
        
    line = proc.part.production_line
    
    if proc.completed_qty + tx.quantity_completed > line.quantity:
        raise HTTPException(status_code=400, detail=f"Cannot exceed total line quantity ({line.quantity})")
        
    proc.completed_qty += tx.quantity_completed
    
    log = ProductionLog(
        part_process_id=process_id,
        operator_id=tx.operator_id,
        qty_done=tx.quantity_completed
    )
    db.add(log)
    
    audit = AuditLog(
        user_id=tx.operator_id,
        action="Update",
        table_name="part_processes",
        record_id=proc.id,
        details=f"Produced {tx.quantity_completed}x of size {line.size} for {proc.process_name}"
    )
    db.add(audit)
    
    db.commit()
    return {"message": f"Added {tx.quantity_completed} to {proc.process_name}"}

@app.get("/api/dashboard/wip")
def get_wip_dashboard(db = Depends(get_db)):
    active_projects = db.query(Project).filter(Project.status != "Completed").all()
    
    wip_data = {
        "Bellows Shop": {"required": 0, "completed": 0, "pending": 0},
        "Fabrication Shop": {"required": 0, "completed": 0, "pending": 0},
        "Machining Shop": {"required": 0, "completed": 0, "pending": 0},
        "Assembly Shop": {"required": 0, "completed": 0, "pending": 0},
        "QC": {"required": 0, "completed": 0, "pending": 0},
        "Stores": {"required": 0, "completed": 0, "pending": 0},
        "Dispatch": {"required": 0, "completed": 0, "pending": 0}
    }
    
    for p in active_projects:
        for line in db.query(ProjectProductionLine).filter(ProjectProductionLine.project_id == p.id).all():
            for part in line.parts:
                for proc in part.processes:
                    shop = "Fabrication Shop"
                    name_lower = part.name.lower()
                    proc_lower = proc.process_name.lower()
                    
                    if "assembly" in name_lower:
                        shop = "Assembly Shop"
                    elif "bellow" in name_lower:
                        shop = "Bellows Shop"
                    
                    if proc_lower in ["m/c", "drilling", "machining"]:
                        shop = "Machining Shop"
                    elif "test" in proc_lower or "insp" in proc_lower or "qc" in proc_lower:
                        shop = "QC"
                        
                    wip_data[shop]["required"] += line.quantity
                    wip_data[shop]["completed"] += proc.completed_qty
                    
    for shop in wip_data:
        wip_data[shop]["pending"] = max(0, wip_data[shop]["required"] - wip_data[shop]["completed"])
        
    return wip_data

@app.get("/api/users")
def get_users(db = Depends(get_db)):
    users = db.query(User).all()
    return [{"id": u.id, "name": u.full_name, "role": u.role, "username": u.username} for u in users]

@app.get("/api/dashboard/executive")
def get_executive_dashboard(db = Depends(get_db)):
    total_active = db.query(Project).filter(Project.status != "Completed").count()
    critical = 0 # Priority not yet tracked in unified schema
    
    active_projects = db.query(Project).filter(Project.status != "Completed").all()
    avg_progress = 0
    if active_projects:
        from backend.services.mes_service import MESService
        total_p = sum([MESService.calculate_project_progress(db, p.id) for p in active_projects])
        avg_progress = round(total_p / len(active_projects), 1)
        
    wip = get_wip_dashboard(db)
    dept_loads = []
    colors = ["orange", "emerald", "blue", "purple"]
    for i, shop in enumerate(["Fabrication Shop", "Assembly Shop", "Bellows Shop", "Machining Shop"]):
        data = wip.get(shop, {"required": 0, "completed": 0})
        load = 0
        if data["required"] > 0:
            load = round(((data["required"] - data["completed"]) / data["required"]) * 100)
        dept_loads.append({"name": shop, "load": load, "color": colors[i]})
    
    return {
        "kpis": [
            {"label": "Active Projects", "value": str(total_active), "trend": "Ongoing jobs", "color": "blue"},
            {"label": "Avg Progress", "value": f"{avg_progress}%", "trend": "Overall completion", "color": "emerald"},
            {"label": "Critical Projects", "value": str(critical), "trend": "High priority", "color": "rose"},
            {"label": "Completed", "value": str(db.query(Project).filter(Project.status == "Completed").count()), "trend": "All time", "color": "amber"}
        ],
        "departments": dept_loads
    }

@app.get("/api/dashboard/planning")
def get_planning_dashboard(db: Session = Depends(get_db)):
    from backend.services.mes_service import MESService
    active_projects = db.query(Project).filter(Project.status != "Completed").all()
    total_target = 0
    
    for p in active_projects:
        for line in p.production_lines:
            total_target += line.quantity
            
    total_progress = 0
    if active_projects:
        total_progress = sum([MESService.calculate_project_progress(db, p.id) for p in active_projects]) / len(active_projects)
        
    current_load = round(100 - total_progress, 1) if active_projects else 0

    late_projects = 0
    today = datetime.utcnow()
    for p in active_projects:
        if p.resource_assignment and p.resource_assignment.target_date:
            if p.resource_assignment.target_date < today:
                late_projects += 1
            
    total_projects = db.query(Project).count()
    on_time = 100
    if total_projects > 0:
        on_time = round(((total_projects - late_projects) / total_projects) * 100, 1)

    return {
        "weekly_target": total_target,
        "current_load": current_load,
        "on_time_delivery": on_time
    }


@app.get("/api/audit")
def get_audit_logs(db: Session = Depends(get_db)):
    logs = db.query(AuditLog, User).join(User, AuditLog.user_id == User.id).order_by(AuditLog.timestamp.desc()).limit(50).all()
    result = []
    for log, user in logs:
        result.append({
            "id": log.id,
            "user": user.full_name,
            "role": user.role,
            "action": log.action,
            "entity": log.table_name,
            "details": log.details,
            "time": log.timestamp.strftime("%Y-%m-%d %H:%M:%S")
        })
    return result


class UserCreate(BaseModel):
    username: str
    full_name: str
    password: str
    role: str = "Operator"

from passlib.context import CryptContext
pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")

@app.post("/api/users")
def create_user(user: UserCreate, db: Session = Depends(get_db)):
    existing = db.query(User).filter_by(username=user.username).first()
    if existing:
        raise HTTPException(status_code=400, detail="Username already exists")
        
    hashed_pw = pwd_context.hash(user.password)
    new_user = User(
        username=user.username,
        full_name=user.full_name,
        hashed_password=hashed_pw,
        role=user.role
    )
    db.add(new_user)
    db.commit()
    return {"message": "User created successfully", "id": new_user.id}

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("backend.main:app", host="0.0.0.0", port=8003, reload=True)
