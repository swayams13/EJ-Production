import os
from datetime import datetime
from sqlalchemy import create_engine, Column, Integer, String, Float, Boolean, DateTime, ForeignKey, Text
from sqlalchemy.orm import declarative_base, sessionmaker, relationship
from sqlalchemy.exc import IntegrityError

PROJECT_ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
DATA_DIR = os.path.join(PROJECT_ROOT, 'data')
os.makedirs(DATA_DIR, exist_ok=True)
DB_PATH = f"sqlite:///{os.path.join(DATA_DIR, 'production_tracker.db')}"
engine = create_engine(DB_PATH, connect_args={"check_same_thread": False})
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
Base = declarative_base()

# --- Models ---

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
    
    project = relationship("Project", back_populates="production_lines")

class WorkforceMaster(Base):
    __tablename__ = "workforce_master"
    id = Column(Integer, primary_key=True, index=True)
    resource_type = Column(String, unique=True, index=True)
    avg_productivity_per_day = Column(Float)
    active = Column(Boolean, default=True)

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
