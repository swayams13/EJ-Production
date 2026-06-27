import os
os.environ["DATABASE_URL"] = "sqlite:///./test.db"
from backend.services.db_service import SessionLocal, Project, User, AttendanceLog, DailyTaskAssignment
import datetime

db = SessionLocal()
from backend.app.dashboard.router import get_planning_dashboard
res = get_planning_dashboard(db)
print(res)
