from backend.database import SessionLocal
from backend.app.dashboard.router import get_planning_dashboard

db = SessionLocal()
try:
    res = get_planning_dashboard(db)
    print(res)
except Exception as e:
    import traceback
    traceback.print_exc()
finally:
    db.close()
