import sys
import os
sys.path.append(os.path.dirname(os.path.abspath(__file__)))
from backend.services.db_service import SessionLocal
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
