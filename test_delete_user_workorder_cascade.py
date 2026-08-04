# test_delete_user_workorder_cascade.py
"""Confirms deleting a user with a WorkOrder row nullifies it instead of 400ing with a raw SQL error. No pytest, no fixtures."""
from datetime import date
from backend.services.db_service import SessionLocal, User, WorkOrder, Project
from backend.app.users.router import delete_user


def test_delete_user_with_work_order():
    db = SessionLocal()
    user = User(username="QA_SANDBOX_wo_user", full_name="QA Sandbox WO User", role="Operator", hashed_password="x")
    db.add(user)
    db.commit()
    db.refresh(user)

    proj = db.query(Project).first()
    assert proj is not None, "Need at least one existing project in the dev DB to attach a WorkOrder to"

    wo = WorkOrder(project_id=proj.id, user_id=user.id, date=date.today(), process_type="TIG", target_feet=10.0, status="Pending")
    db.add(wo)
    db.commit()
    db.refresh(wo)

    current_user = {"username": "qa_test", "role": "Developer", "id": None}
    result = delete_user(user.id, db, current_user)
    assert result["success"] is True
    assert db.query(User).filter_by(id=user.id).first() is None

    refreshed_wo = db.query(WorkOrder).filter_by(id=wo.id).first()
    assert refreshed_wo is not None, "WorkOrder row should survive with user_id nulled, not be force-deleted"
    assert refreshed_wo.user_id is None
    print("PASS: deleting a user with a WorkOrder nullifies user_id instead of 400ing")

    db.query(WorkOrder).filter_by(id=wo.id).delete()
    db.commit()


test_delete_user_with_work_order()
print("All delete_user WorkOrder cascade tests passed.")
