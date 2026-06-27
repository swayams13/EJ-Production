import os
os.environ["DATABASE_URL"] = "sqlite:///./test.db"
from backend.services.db_service import SessionLocal, Project, User, AttendanceLog, DailyTaskAssignment
import datetime

db = SessionLocal()

# Setup test data
db.query(DailyTaskAssignment).delete()
db.query(AttendanceLog).delete()
db.query(Project).delete()
db.query(User).delete()

u1 = User(id=1, username="test", hashed_password="test", role="Operator", skill="TIG", base_productivity=100.0)
db.add(u1)
p1 = Project(id=1, quotation_no="Q1", status="Active")
db.add(p1)
db.commit()

# Add attendance
log = AttendanceLog(user_id=1, date=datetime.date(2026, 7, 6), status="Present")
db.add(log)
db.commit()

# Run logic
from backend.app.scheduler.router import auto_assign_tasks
res = auto_assign_tasks(datetime.date(2026, 7, 6), db=db, current_user={"id": 1, "role": "Admin"})
print("AUTO_ASSIGN RESULT:", res)
print("ASSIGNMENTS:", len(db.query(DailyTaskAssignment).all()))
