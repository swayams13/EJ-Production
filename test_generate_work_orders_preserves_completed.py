# test_generate_work_orders_preserves_completed.py
"""Confirms re-running generate_work_orders for a date doesn't delete Completed rows. No pytest, no fixtures."""
import os
os.environ.setdefault("JWT_SECRET_KEY", "test-key-for-unit-tests")

from datetime import date, timedelta
from backend.services.db_service import SessionLocal, WorkOrder, Project
from backend.app.scheduler.router import generate_work_orders


def test_regenerate_preserves_completed_orders():
    db = SessionLocal()
    target_date = date.today() + timedelta(days=365)  # far-future date, safe sandbox
    proj = db.query(Project).first()
    assert proj is not None

    completed_wo = WorkOrder(
        project_id=proj.id, user_id=1, date=target_date, process_type="TIG",
        target_feet=10.0, actual_feet=10.0, status="Completed",
    )
    db.add(completed_wo)
    db.commit()
    db.refresh(completed_wo)

    current_user = {"username": "qa_test", "role": "Developer", "id": None}
    try:
        generate_work_orders(target_date, db, current_user)
    except Exception:
        pass  # may legitimately return "no operators found" etc. — we only care the Completed row survives

    survivor = db.query(WorkOrder).filter_by(id=completed_wo.id).first()
    assert survivor is not None, "Completed work order was deleted by a re-run of generate_work_orders"
    assert survivor.status == "Completed"
    assert survivor.actual_feet == 10.0
    print("PASS: re-running generate_work_orders preserves already-Completed rows")

    db.query(WorkOrder).filter(WorkOrder.date == target_date).delete()
    db.commit()


test_regenerate_preserves_completed_orders()
print("All generate_work_orders preservation tests passed.")
