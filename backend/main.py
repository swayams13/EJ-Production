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
from backend.app.scheduler.router import router as scheduler_router
from backend.app.inventory.router import router as inventory_router

app = FastAPI(title="EJ Production Tracker API", version="1.0.0")

app.include_router(audit_router)
app.include_router(users_router)
app.include_router(dashboard_router)
app.include_router(master_router)
app.include_router(projects_router)
app.include_router(scheduler_router)
app.include_router(inventory_router)

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

# Auto-migrate new columns
try:
    from backend.services.db_service import engine
    from sqlalchemy import text
    with engine.connect() as conn:
        conn.execute(text("ALTER TABLE projects ADD COLUMN status_note TEXT"))
        conn.execute(text("ALTER TABLE projects ADD COLUMN hold_until_date DATE"))
        conn.commit()
except Exception:
    pass # Columns already exist

try:
    from backend.services.db_service import engine
    from sqlalchemy import text
    with engine.connect() as conn:
        conn.execute(text("ALTER TABLE projects ADD COLUMN hold_type TEXT"))
        conn.commit()
except Exception:
    pass

try:
    from backend.services.db_service import engine
    from sqlalchemy import text
    with engine.connect() as conn:
        conn.execute(text("ALTER TABLE projects ADD COLUMN payroll TEXT DEFAULT 'Company'"))
        conn.commit()
except Exception:
    pass

try:
    from backend.services.db_service import engine
    from sqlalchemy import text
    with engine.connect() as conn:
        conn.execute(text("ALTER TABLE project_production_lines ADD COLUMN pn_rating TEXT"))
        conn.commit()
except Exception:
    pass

# Migrate DJ feet from TIG to MIG
try:
    from backend.services.db_service import engine
    from sqlalchemy import text
    with engine.connect() as conn:
        # Move feet in production lines
        conn.execute(text("UPDATE project_production_lines SET mig_feet = COALESCE(mig_feet, 0) + COALESCE(tig_feet, 0), tig_feet = 0 WHERE joint_type = 'DJ' AND tig_feet > 0"))
        
        # Update process type in welding logs
        conn.execute(text("""
            UPDATE welding_logs 
            SET process_type = 'MIG' 
            WHERE process_type = 'TIG' 
            AND production_line_id IN (SELECT id FROM project_production_lines WHERE joint_type = 'DJ')
        """))
        
        # Migrate welders for DJ-only projects
        conn.execute(text("""
            UPDATE project_resource_assignments
            SET assigned_mig_welders = COALESCE(assigned_mig_welders, 0) + COALESCE(assigned_tig_welders, 0),
                assigned_tig_welders = 0
            WHERE assigned_tig_welders > 0
            AND project_id IN (
                SELECT project_id 
                FROM project_production_lines 
                WHERE joint_type = 'DJ'
            ) 
            AND project_id NOT IN (
                SELECT project_id 
                FROM project_production_lines 
                WHERE joint_type != 'DJ' OR joint_type IS NULL
            )
        """))
        
        conn.commit()
except Exception:
    pass
# Dependency

# Models
class LoginRequest(BaseModel):
    username: str
    password: str

class BellowItem(BaseModel):
    size: int
    qty: int
    type: Optional[str] = "EJ"
    pn_rating: Optional[str] = None

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
from backend.app.production.router import router as production_router
from backend.app.workforce.router import router as workforce_router
from backend.app.websocket.router import router as websocket_router

app.include_router(auth_router)
app.include_router(production_router)
app.include_router(workforce_router)
app.include_router(websocket_router)

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("backend.main:app", host="0.0.0.0", port=8003, reload=True)
