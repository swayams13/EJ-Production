import os
import logging
from fastapi import FastAPI, HTTPException, Depends
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import List, Optional
from datetime import datetime, date
from dotenv import load_dotenv

load_dotenv()

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

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
from backend.app.procurement.router import router as procurement_router
from backend.app.projects.completion import router as completion_router
from backend.app.notifications.router import router as notifications_router

app = FastAPI(title="EJ Production Tracker API", version="1.0.0")

app.include_router(audit_router)
app.include_router(users_router)
app.include_router(dashboard_router)
app.include_router(master_router)
app.include_router(projects_router)
app.include_router(scheduler_router)
app.include_router(procurement_router)
app.include_router(completion_router)
app.include_router(notifications_router)

# Configure CORS — origins come from FRONTEND_ORIGINS (comma-separated),
# e.g. "https://ej-demo.up.railway.app,https://ej.example.com".
_origins = [
    o.strip()
    for o in os.getenv("FRONTEND_ORIGINS", "http://localhost:3000").split(",")
    if o.strip()
]
app.add_middleware(
    CORSMiddleware,
    allow_origins=_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Init DB
init_db()

def _run_startup_migration(label, statements):
    """
    Run a list of raw-SQL statements as a best-effort startup migration.
    Each statement is expected to be self-guarding (idempotent) - e.g. an
    ALTER TABLE ADD COLUMN that fails harmlessly if the column already
    exists, or an UPDATE whose WHERE clause only matches un-migrated rows.
    Failures are logged (not silently swallowed) so a genuine DB error is
    visible in the server logs instead of looking identical to the expected
    "already applied" case.
    """
    from backend.services.db_service import engine
    from sqlalchemy import text
    try:
        with engine.connect() as conn:
            for stmt in statements:
                conn.execute(text(stmt))
            conn.commit()
    except Exception as e:
        logger.warning("Startup migration '%s' skipped/failed (likely already applied): %s", label, e)


# Auto-migrate new columns
_run_startup_migration("projects.status_note/hold_until_date", [
    "ALTER TABLE projects ADD COLUMN status_note TEXT",
    "ALTER TABLE projects ADD COLUMN hold_until_date DATE",
])

_run_startup_migration("projects.hold_type", [
    "ALTER TABLE projects ADD COLUMN hold_type TEXT",
])

_run_startup_migration("projects.payroll", [
    "ALTER TABLE projects ADD COLUMN payroll TEXT DEFAULT 'Company'",
])

_run_startup_migration("project_production_lines.pn_rating", [
    "ALTER TABLE project_production_lines ADD COLUMN pn_rating TEXT",
])

# Migrate DJ feet from TIG to MIG
_run_startup_migration("DJ feet TIG->MIG", [
    "UPDATE project_production_lines SET mig_feet = COALESCE(mig_feet, 0) + COALESCE(tig_feet, 0), tig_feet = 0 WHERE joint_type = 'DJ' AND tig_feet > 0",
    """
    UPDATE welding_logs
    SET process_type = 'MIG'
    WHERE process_type = 'TIG'
    AND production_line_id IN (SELECT id FROM project_production_lines WHERE joint_type = 'DJ')
    """,
    """
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
    """,
])

# De-duplicate any attendance rows created by the pre-fix race condition
# (check-then-insert with no DB constraint), then enforce one row per
# worker per day going forward. Two separate migrations so a failure
# adding the constraint doesn't obscure whether the dedupe itself ran.
_run_startup_migration("attendance_logs dedupe", [
    """
    DELETE FROM attendance_logs a USING attendance_logs b
    WHERE a.user_id = b.user_id AND a.date = b.date AND a.id < b.id
    """,
])

_run_startup_migration("attendance_logs unique constraint", [
    "ALTER TABLE attendance_logs ADD CONSTRAINT uq_attendance_user_date UNIQUE (user_id, date)",
])

_run_startup_migration("part_processes.itemwise fields", [
    "ALTER TABLE part_processes ADD COLUMN status VARCHAR DEFAULT 'pending'",
    "ALTER TABLE part_processes ADD COLUMN date_ready DATE",
    "ALTER TABLE part_processes ADD COLUMN date_pending DATE",
    "ALTER TABLE part_processes ADD COLUMN po_number VARCHAR",
])

_run_startup_migration("joint tag columns", [
    "ALTER TABLE project_production_lines ADD COLUMN joint_category VARCHAR",
    "ALTER TABLE project_production_lines ADD COLUMN joint_type_code VARCHAR",
    "ALTER TABLE project_production_lines ADD COLUMN paint_status VARCHAR DEFAULT 'Yet to start'",
    "ALTER TABLE project_production_lines ADD COLUMN variable_qtys_json TEXT",
    "ALTER TABLE parts ADD COLUMN qty_per_unit DOUBLE PRECISION DEFAULT 1.0",
    "ALTER TABLE parts ADD COLUMN total_qty INTEGER DEFAULT 0",
])

_run_startup_migration("parts: backfill total_qty=0 from line quantity for legacy parts", [
    """
    UPDATE parts p
    SET total_qty = ppl.quantity
    FROM project_production_lines ppl
    WHERE p.production_line_id = ppl.id
      AND p.total_qty = 0
      AND ppl.quantity > 0
    """,
])

_run_startup_migration("job_final_checks table", [
    """
    CREATE TABLE IF NOT EXISTS job_final_checks (
        id SERIAL PRIMARY KEY,
        production_line_id INTEGER NOT NULL REFERENCES project_production_lines(id),
        check_type VARCHAR NOT NULL,
        is_required BOOLEAN DEFAULT TRUE,
        test_method VARCHAR,
        paint_spec TEXT,
        weight_kgs DOUBLE PRECISION,
        marking_type VARCHAR,
        status VARCHAR DEFAULT 'pending',
        date_ready DATE,
        date_pending DATE,
        notes TEXT,
        updated_by INTEGER REFERENCES users(id),
        updated_at TIMESTAMP DEFAULT NOW(),
        CONSTRAINT uq_final_check_line_type UNIQUE (production_line_id, check_type)
    )
    """,
])

_run_startup_migration("assembly_steps.completed_qty", [
    "ALTER TABLE assembly_steps ADD COLUMN completed_qty INTEGER DEFAULT 0",
])

_run_startup_migration("procurement: vendor + po tables", [
    """
    CREATE TABLE IF NOT EXISTS vendors (
        id SERIAL PRIMARY KEY,
        name VARCHAR NOT NULL,
        contact_person VARCHAR,
        phone VARCHAR,
        email VARCHAR,
        gstin VARCHAR,
        payment_terms VARCHAR,
        notes TEXT,
        created_at TIMESTAMP DEFAULT NOW()
    )
    """,
    """
    CREATE TABLE IF NOT EXISTS purchase_orders (
        id SERIAL PRIMARY KEY,
        po_number VARCHAR UNIQUE NOT NULL,
        vendor_id INTEGER REFERENCES vendors(id),
        po_date DATE,
        expected_delivery_date DATE,
        status VARCHAR DEFAULT 'draft',
        raised_by INTEGER REFERENCES users(id),
        total_value DOUBLE PRECISION,
        delay_reason TEXT,
        notes TEXT,
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
    )
    """,
    """
    CREATE TABLE IF NOT EXISTS purchase_order_lines (
        id SERIAL PRIMARY KEY,
        purchase_order_id INTEGER NOT NULL REFERENCES purchase_orders(id),
        material_name VARCHAR NOT NULL,
        size INTEGER NOT NULL,
        joint_type VARCHAR NOT NULL,
        ordered_qty INTEGER NOT NULL DEFAULT 0,
        unit_price DOUBLE PRECISION,
        received_qty INTEGER DEFAULT 0,
        status VARCHAR DEFAULT 'pending'
    )
    """,
    """
    CREATE TABLE IF NOT EXISTS purchase_order_line_allocations (
        id SERIAL PRIMARY KEY,
        po_line_id INTEGER NOT NULL REFERENCES purchase_order_lines(id),
        part_id INTEGER NOT NULL REFERENCES parts(id),
        allocated_qty INTEGER NOT NULL,
        already_received INTEGER DEFAULT 0
    )
    """,
    """
    CREATE TABLE IF NOT EXISTS goods_receipts (
        id SERIAL PRIMARY KEY,
        purchase_order_id INTEGER NOT NULL REFERENCES purchase_orders(id),
        receipt_date DATE DEFAULT CURRENT_DATE,
        received_by INTEGER REFERENCES users(id),
        notes TEXT,
        created_at TIMESTAMP DEFAULT NOW()
    )
    """,
    """
    CREATE TABLE IF NOT EXISTS goods_receipt_lines (
        id SERIAL PRIMARY KEY,
        receipt_id INTEGER NOT NULL REFERENCES goods_receipts(id),
        po_line_id INTEGER NOT NULL REFERENCES purchase_order_lines(id),
        qty_received INTEGER NOT NULL
    )
    """,
])

_run_startup_migration("procurement: warehouse_stock + lead_times", [
    """
    CREATE TABLE IF NOT EXISTS warehouse_stock (
        id SERIAL PRIMARY KEY,
        material_name VARCHAR NOT NULL,
        size INTEGER NOT NULL,
        joint_type VARCHAR NOT NULL,
        qty_on_hand INTEGER DEFAULT 0,
        reserved_qty INTEGER DEFAULT 0,
        minimum_stock INTEGER DEFAULT 0,
        updated_at TIMESTAMP DEFAULT NOW(),
        CONSTRAINT uq_warehouse_stock UNIQUE (material_name, size, joint_type)
    )
    """,
    """
    CREATE TABLE IF NOT EXISTS material_lead_times (
        id SERIAL PRIMARY KEY,
        material_name VARCHAR UNIQUE NOT NULL,
        lead_time_days INTEGER NOT NULL DEFAULT 5
    )
    """,
])

_run_startup_migration("procurement: migrate raw_material_inventory → warehouse_stock", [
    """
    INSERT INTO warehouse_stock (material_name, size, joint_type, qty_on_hand, minimum_stock)
    SELECT material_name, size, joint_type, current_stock, minimum_required_stock
    FROM raw_material_inventory
    WHERE NOT EXISTS (
        SELECT 1 FROM warehouse_stock ws
        WHERE ws.material_name = raw_material_inventory.material_name
          AND ws.size = raw_material_inventory.size
          AND ws.joint_type = raw_material_inventory.joint_type
    )
    """,
])

_run_startup_migration("procurement: seed material_lead_times defaults", [
    """
    INSERT INTO material_lead_times (material_name, lead_time_days) VALUES
        ('Element', 5), ('Collar', 5), ('Weldend', 5), ('Spool', 5),
        ('Flange', 7), ('Matching Flanges', 7), ('Liner', 4), ('Lug', 4),
        ('Limit rod', 5), ('Bolts, Nuts', 3), ('Gaskets', 4),
        ('Pipe-1', 5), ('Pipe-2', 5), ('Stopper Patti', 5),
        ('Pipe-1 flange', 7), ('Pipe-2 flange', 7), ('Stopper flange', 7),
        ('O-ring', 5), ('Studs Long', 4), ('Studs Short', 4), ('Box Packing', 3)
    ON CONFLICT (material_name) DO NOTHING
    """,
])

_run_startup_migration("warehouse_stock: normalize legacy material names to catalog names", [
    "UPDATE warehouse_stock SET material_name = 'Element'      WHERE LOWER(material_name) IN ('bellows', 'bellows (b)', 'element bellows')",
    "UPDATE warehouse_stock SET material_name = 'Limit rod'    WHERE LOWER(material_name) IN ('limit rods', 'limit rods (lr)', 'limit rod (lr)')",
    "UPDATE warehouse_stock SET material_name = 'Bolts, Nuts'  WHERE LOWER(material_name) IN ('mat. bolts, nut, washer set', 'bolts', 'bolts nuts', 'bolts & nuts', 'bolts,nuts')",
    "UPDATE warehouse_stock SET material_name = 'Gaskets'      WHERE LOWER(material_name) IN ('gasket', 'gasket (g)', 'gaskets (g)')",
    "UPDATE warehouse_stock SET material_name = 'Lug'          WHERE LOWER(material_name) IN ('lugs', 'lugs (l)', 'lug (l)')",
    "UPDATE warehouse_stock SET material_name = 'Liner'        WHERE LOWER(material_name) IN ('internal sleeve', 'internal sleeve (is)', 'liner (is)')",
    "UPDATE warehouse_stock SET material_name = 'Stopper Patti' WHERE LOWER(material_name) IN ('stopper', 'stopper (s)')",
    "UPDATE warehouse_stock SET material_name = 'Flange'       WHERE LOWER(material_name) IN ('compensator flanges', 'compensator flanges (f)', 'flange (f)')",
])

_run_startup_migration("projects: priority + order_value + advance + dispatch", [
    "ALTER TABLE projects ADD COLUMN priority VARCHAR",
    "ALTER TABLE projects ADD COLUMN order_value DOUBLE PRECISION",
    "ALTER TABLE projects ADD COLUMN advance_received DOUBLE PRECISION DEFAULT 0.0",
    "ALTER TABLE projects ADD COLUMN committed_dispatch_date DATE",
])

_run_startup_migration("welding_logs: work_order_id FK", [
    "ALTER TABLE welding_logs ADD COLUMN IF NOT EXISTS work_order_id INTEGER REFERENCES work_orders(id);",
])

_run_startup_migration("daily_procurement_log table", [
    """CREATE TABLE IF NOT EXISTS daily_procurement_log (
        id SERIAL PRIMARY KEY,
        log_date DATE NOT NULL DEFAULT CURRENT_DATE,
        part_id INTEGER REFERENCES parts(id),
        qty_ordered INTEGER DEFAULT 0,
        qty_received INTEGER DEFAULT 0,
        UNIQUE(log_date, part_id)
    );""",
])

_run_startup_migration("material_holds table", [
    """CREATE TABLE IF NOT EXISTS material_holds (
        id              SERIAL PRIMARY KEY,
        project_id      INTEGER NOT NULL REFERENCES projects(id),
        part_id         INTEGER REFERENCES parts(id),
        material_name   TEXT NOT NULL,
        size            INTEGER NOT NULL,
        joint_type      TEXT NOT NULL,
        required_qty    INTEGER NOT NULL DEFAULT 1,
        status          TEXT NOT NULL DEFAULT 'active',
        resolution_note TEXT,
        created_at      TIMESTAMP DEFAULT NOW(),
        resolved_at     TIMESTAMP
    )"""
])

_run_startup_migration("project_completion_requests table", [
    """
    CREATE TABLE IF NOT EXISTS project_completion_requests (
        id SERIAL PRIMARY KEY,
        project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        requested_by VARCHAR NOT NULL,
        requested_at TIMESTAMP DEFAULT NOW(),
        status VARCHAR DEFAULT 'pending',
        reviewed_by VARCHAR,
        reviewed_at TIMESTAMP,
        rejection_reason TEXT
    )
    """,
])

_run_startup_migration("notifications table", [
    """
    CREATE TABLE IF NOT EXISTS notifications (
        id SERIAL PRIMARY KEY,
        for_role VARCHAR NOT NULL,
        event_type VARCHAR NOT NULL,
        title VARCHAR NOT NULL,
        body TEXT,
        link VARCHAR,
        project_id INTEGER,
        is_read BOOLEAN DEFAULT FALSE,
        created_at TIMESTAMP DEFAULT NOW()
    )
    """,
])

from backend.services.db_service import SessionLocal
from backend.services.itemwise_backfill import backfill_itemwise
backfill_itemwise(SessionLocal)

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

app.include_router(auth_router)
app.include_router(production_router)
app.include_router(workforce_router)

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("backend.main:app", host="0.0.0.0", port=8003, reload=True)
