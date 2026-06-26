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
    SessionLocal, Project, ProjectProductionLine, ProjectResourceAssignment, init_db, get_db
)
from backend.services.production_service import (
    get_company_capacity_status,
    get_welding_master_latest,
    import_welding_master_from_disk,
    calculate_project_duration,
    generate_master_production_register_excel
)

from backend.app.audit.router import router as audit_router
from backend.app.users.router import router as users_router
from backend.app.dashboard.router import router as dashboard_router
from backend.app.master.router import router as master_router
from backend.app.projects.router import router as projects_router

app = FastAPI(title="EJ Production Tracker API", version="1.0.0")

app.include_router(audit_router)
app.include_router(users_router)
app.include_router(dashboard_router)
app.include_router(master_router)
app.include_router(projects_router)

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
from backend.app.auth.router import router as auth_router

app.include_router(auth_router)

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

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("backend.main:app", host="0.0.0.0", port=8003, reload=True)
