import os
from datetime import datetime, date
from sqlalchemy import create_engine, Column, Integer, String, Float, Boolean, DateTime, Date, ForeignKey, Text
from sqlalchemy.orm import declarative_base, sessionmaker, relationship
from sqlalchemy.exc import IntegrityError

PROJECT_ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

DATABASE_URL = os.getenv("DATABASE_URL")
if not DATABASE_URL:
    # Use a generic default if none provided, but strictly postgres
    DATABASE_URL = "postgresql://user:password@localhost:5432/ej_tracker"

if DATABASE_URL.startswith("postgres://"):
    DATABASE_URL = DATABASE_URL.replace("postgres://", "postgresql://", 1)

engine = create_engine(DATABASE_URL)

SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
Base = declarative_base()

# --- Models ---

class User(Base):
    __tablename__ = "users"
    id = Column(Integer, primary_key=True, index=True)
    username = Column(String, unique=True, index=True, nullable=False)
    hashed_password = Column(String, nullable=False)
    full_name = Column(String)
    role = Column(String, nullable=False)
    experience = Column(String, nullable=True)
    skill = Column(String, nullable=True)
    department = Column(String, nullable=True)
    base_productivity = Column(Float, nullable=True)
    is_active = Column(Boolean, default=True)
    created_at = Column(DateTime, default=datetime.utcnow)

class AttendanceLog(Base):
    __tablename__ = "attendance_logs"
    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    date = Column(Date, default=date.today, nullable=False)
    status = Column(String, nullable=False) # Present, Absent, Leave, Overtime
    hours = Column(Float, nullable=True) # Used for overtime tracking
    created_at = Column(DateTime, default=datetime.utcnow)
    
    user = relationship("User")

class Project(Base):
    __tablename__ = "projects"
    id = Column(Integer, primary_key=True, index=True)
    quotation_no = Column(String, unique=True, index=True, nullable=False)
    project_name = Column(String)
    client_name = Column(String)
    contact_person = Column(String)
    phone = Column(String, index=True)
    email = Column(String, index=True)
    client_address = Column(Text)
    status = Column(String, default="Active")
    status_note = Column(Text, nullable=True)
    hold_type = Column(String, nullable=True)
    hold_until_date = Column(Date, nullable=True)
    target_date = Column(Date, nullable=True)
    payroll = Column(String, default="Company", nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    
    production_lines = relationship("ProjectProductionLine", back_populates="project", cascade="all, delete-orphan")
    resource_assignment = relationship("ProjectResourceAssignment", uselist=False, back_populates="project", cascade="all, delete-orphan")

class WeldingMaster(Base):
    __tablename__ = "welding_master"
    id = Column(Integer, primary_key=True, index=True)
    size = Column(Integer, index=True)
    tig_inches = Column(Float, default=0.0)
    tig_feet = Column(Float, default=0.0)
    mig_inches = Column(Float, default=0.0)
    mig_feet = Column(Float, default=0.0)
    total_welding_inches = Column(Float, default=0.0)
    total_welding_feet = Column(Float, default=0.0)
    grinding_feet = Column(Float, default=0.0)
    joint_type = Column(String, default="EJ")
    version = Column(Integer, default=1)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

class ProjectProductionLine(Base):
    __tablename__ = "project_production_lines"
    id = Column(Integer, primary_key=True, index=True)
    project_id = Column(Integer, ForeignKey("projects.id"))
    size = Column(Integer)
    quantity = Column(Integer)
    tig_feet = Column(Float, default=0.0)
    mig_feet = Column(Float, default=0.0)
    grinding_feet = Column(Float, default=0.0)
    joint_type = Column(String, default="EJ")
    pn_rating = Column(String, nullable=True)
    
    project = relationship("Project", back_populates="production_lines")
    parts = relationship("Part", back_populates="production_line", cascade="all, delete-orphan")

class Part(Base):
    __tablename__ = "parts"
    id = Column(Integer, primary_key=True, index=True)
    production_line_id = Column(Integer, ForeignKey("project_production_lines.id"), nullable=False)
    name = Column(String, nullable=False) # e.g. "Bellows (B)", "Collar (C)"
    weight_percentage = Column(Float, nullable=False, default=0.0)
    
    production_line = relationship("ProjectProductionLine", back_populates="parts")
    processes = relationship("PartProcess", back_populates="part", cascade="all, delete-orphan")

class PartProcess(Base):
    __tablename__ = "part_processes"
    id = Column(Integer, primary_key=True, index=True)
    part_id = Column(Integer, ForeignKey("parts.id"), nullable=False)
    process_name = Column(String, nullable=False) # e.g. "Cutting", "Welding"
    completed_qty = Column(Integer, nullable=False, default=0)
    
    part = relationship("Part", back_populates="processes")
    production_logs = relationship("ProductionLog", back_populates="part_process", cascade="all, delete-orphan")

class ProductionLog(Base):
    __tablename__ = "production_logs"
    id = Column(Integer, primary_key=True, index=True)
    part_process_id = Column(Integer, ForeignKey("part_processes.id"), nullable=False)
    operator_id = Column(Integer, ForeignKey("users.id"))
    qty_done = Column(Integer, nullable=False)
    feet_done = Column(Float, nullable=True)
    date = Column(Date, default=date.today)
    created_at = Column(DateTime, default=datetime.utcnow)
    
    part_process = relationship("PartProcess", back_populates="production_logs")
    operator = relationship("User")

class WeldingLog(Base):
    __tablename__ = "welding_logs"
    id = Column(Integer, primary_key=True, index=True)
    production_line_id = Column(Integer, ForeignKey("project_production_lines.id"), nullable=False)
    operator_id = Column(Integer, ForeignKey("users.id"))
    process_type = Column(String, nullable=False) # "TIG", "MIG", "Grinding"
    feet_done = Column(Float, nullable=False)
    date = Column(Date, default=date.today)
    created_at = Column(DateTime, default=datetime.utcnow)
    
    production_line = relationship("ProjectProductionLine")
    operator = relationship("User")

class AuditLog(Base):
    __tablename__ = "audit_logs"
    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=True)
    username = Column(String, nullable=True) # For dev/PM users without an ID
    action = Column(String, nullable=False)
    table_name = Column(String, nullable=False)
    record_id = Column(Integer, nullable=True)
    details = Column(Text)
    timestamp = Column(DateTime, default=datetime.utcnow)

class RawMaterialInventory(Base):
    __tablename__ = "raw_material_inventory"
    id = Column(Integer, primary_key=True, index=True)
    material_name = Column(String, index=True, nullable=False) # e.g. Bellows, Collar, Flange
    size = Column(Integer, index=True, nullable=False)
    joint_type = Column(String, index=True, nullable=False) # EJ, DJ
    current_stock = Column(Integer, default=0, nullable=False)
    minimum_required_stock = Column(Integer, default=0, nullable=False)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

class WorkforceMaster(Base):
    __tablename__ = "workforce_master"
    id = Column(Integer, primary_key=True, index=True)
    resource_type = Column(String, unique=True, index=True)
    avg_productivity_per_day = Column(Float)
    active = Column(Boolean, default=True)


class ProjectHoldHistory(Base):
    __tablename__ = "project_hold_history"
    id = Column(Integer, primary_key=True, index=True)
    project_id = Column(Integer, ForeignKey("projects.id"))
    hold_type = Column(String, nullable=False)
    comments = Column(Text, nullable=True)
    hold_date = Column(DateTime, default=datetime.utcnow)
    resume_date = Column(DateTime, nullable=True)

class ProjectResourceAssignment(Base):
    __tablename__ = "project_resource_assignments"
    id = Column(Integer, primary_key=True, index=True)
    project_id = Column(Integer, ForeignKey("projects.id"), unique=True)
    assigned_tig_welders = Column(Integer, default=0)
    assigned_mig_welders = Column(Integer, default=0)
    assigned_grinders = Column(Integer, default=0)
    estimated_duration_days = Column(Integer, default=0)
    target_days = Column(Integer, default=15)
    target_date = Column(DateTime, nullable=True)
    forecast_date = Column(DateTime, nullable=True)
    
    project = relationship("Project", back_populates="resource_assignment")

class DailyTaskAssignment(Base):
    __tablename__ = "daily_task_assignments"
    id = Column(Integer, primary_key=True, index=True)
    project_id = Column(Integer, ForeignKey("projects.id"), nullable=False)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    process_type = Column(String, nullable=False) # TIG, MIG, Grinding
    date = Column(Date, default=date.today, nullable=False)
    target_feet = Column(Float, nullable=False)
    status = Column(String, default="Pending") # Pending, Completed, Blocked
    is_overtime = Column(Boolean, default=False)
    notes = Column(Text, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    
    project = relationship("Project")
    user = relationship("User")

class Employee(Base):
    __tablename__ = "employees"
    id = Column(Integer, primary_key=True, index=True)
    emp_id = Column(String, unique=True, index=True, nullable=False)
    name = Column(String, nullable=False)
    company = Column(String, nullable=False)  # D2 or P1
    skill_1 = Column(String, nullable=True)
    skill_2 = Column(String, nullable=True)
    skill_3 = Column(String, nullable=True)
    skill_4 = Column(String, nullable=True)
    experience_years = Column(Integer, default=0)
    target_per_day = Column(Float, default=0.0)
    active = Column(Boolean, default=True)

class CompanyResourcePool(Base):
    __tablename__ = "company_resource_pool"
    id = Column(Integer, primary_key=True, index=True)
    total_tig_welders = Column(Integer, default=0)
    total_mig_welders = Column(Integer, default=0)
    total_grinders = Column(Integer, default=0)
    working_hours_per_day = Column(Float, default=8.0)
    overtime_pct = Column(Float, default=0.0)

# --- Service Functions ---

def init_db():
    Base.metadata.create_all(bind=engine)
    
    from sqlalchemy import text
    try:
        with engine.begin() as conn:
            conn.execute(text("ALTER TABLE projects ADD COLUMN target_date DATE;"))
    except Exception:
        pass # Column might already exist
        
    
    try:
        with engine.begin() as conn:
            conn.execute(text("ALTER TABLE projects ADD COLUMN hold_type VARCHAR;"))
    except Exception:
        pass
    try:
        with engine.begin() as conn:
            conn.execute(text("ALTER TABLE production_logs ADD COLUMN feet_done FLOAT;"))
    except Exception:
        pass # Column might already exist
        
    columns = [
        "ALTER TABLE users ADD COLUMN experience VARCHAR;",
        "ALTER TABLE users ADD COLUMN skill VARCHAR;",
        "ALTER TABLE users ADD COLUMN department VARCHAR;",
        "ALTER TABLE users ADD COLUMN base_productivity FLOAT;",
        "ALTER TABLE welding_master ADD COLUMN joint_type VARCHAR DEFAULT 'EJ';",
        "ALTER TABLE project_production_lines ADD COLUMN joint_type VARCHAR DEFAULT 'EJ';",
        "ALTER TABLE audit_logs ADD COLUMN username VARCHAR;",
        "ALTER TABLE projects ADD COLUMN payroll VARCHAR DEFAULT 'Company';"
    ]
    
    for query in columns:
        try:
            with engine.begin() as conn:
                conn.execute(text(query))
        except Exception:
            pass
            
    # Safe migration for workforce_master
    try:
        with engine.begin() as conn:
            conn.execute(text("ALTER TABLE workforce_master RENAME COLUMN avg_productivity_per_hour TO avg_productivity_per_day;"))
            conn.execute(text("UPDATE workforce_master SET avg_productivity_per_day = avg_productivity_per_day * 8.0;"))
    except Exception:
        pass
        
    session = SessionLocal()
    try:
        # Initialize Default Workforce
        if session.query(WorkforceMaster).count() == 0:
            session.add_all([
                WorkforceMaster(resource_type="TIG Welder", avg_productivity_per_day=180.0),
                WorkforceMaster(resource_type="MIG Welder", avg_productivity_per_day=120.0),
                WorkforceMaster(resource_type="Grinder", avg_productivity_per_day=80.0)
            ])
            try:
                session.commit()
            except IntegrityError:
                session.rollback()
                
        # Initialize Default Company Resource Pool
        if session.query(CompanyResourcePool).count() == 0:
            session.add(CompanyResourcePool(
                total_tig_welders=5,
                total_mig_welders=5,
                total_grinders=3,
                working_hours_per_day=8.0,
                overtime_pct=0.0
            ))
            try:
                session.commit()
            except IntegrityError:
                session.rollback()
    finally:
        session.close()

if __name__ == "__main__":
    init_db()
    print("Database initialized successfully.")

def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
