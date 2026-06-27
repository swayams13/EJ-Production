with open("backend/services/db_service.py", "r") as f:
    content = f.read()
    
# Add hold_type to Project
content = content.replace('status_note = Column(Text, nullable=True)\n    hold_until_date = Column(Date, nullable=True)\n    target_date = Column(Date, nullable=True)', 
'status_note = Column(Text, nullable=True)\n    hold_type = Column(String, nullable=True)\n    hold_until_date = Column(Date, nullable=True)\n    target_date = Column(Date, nullable=True)')

# Add ProjectHoldHistory model
model_str = """
class ProjectHoldHistory(Base):
    __tablename__ = "project_hold_history"
    id = Column(Integer, primary_key=True, index=True)
    project_id = Column(Integer, ForeignKey("projects.id"))
    hold_type = Column(String, nullable=False)
    comments = Column(Text, nullable=True)
    hold_date = Column(DateTime, default=datetime.utcnow)
    resume_date = Column(DateTime, nullable=True)
"""
# Insert it before class ProjectResourceAssignment
content = content.replace('class ProjectResourceAssignment(Base):', model_str + '\nclass ProjectResourceAssignment(Base):')

# Add migration
migration = """
    try:
        with engine.begin() as conn:
            conn.execute(text("ALTER TABLE projects ADD COLUMN hold_type VARCHAR;"))
    except Exception:
        pass
"""
content = content.replace('try:\n        with engine.begin() as conn:\n            conn.execute(text("ALTER TABLE production_logs ADD COLUMN feet_done FLOAT;"))', migration + '    try:\n        with engine.begin() as conn:\n            conn.execute(text("ALTER TABLE production_logs ADD COLUMN feet_done FLOAT;"))')

with open("backend/services/db_service.py", "w") as f:
    f.write(content)

print("Added hold models and migration.")
