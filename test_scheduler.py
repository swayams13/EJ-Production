import os
os.environ["DATABASE_URL"] = "sqlite:///./test.db"

from sqlalchemy import create_engine
from backend.services.db_service import init_db, SessionLocal, DailyTaskAssignment
init_db()

db = SessionLocal()
print(db.query(DailyTaskAssignment).all())
db.close()
