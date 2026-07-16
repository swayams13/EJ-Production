"""Self-contained tests for Work Assignment feature. No pytest, no fixtures."""
import json
import os
from datetime import date

os.environ.setdefault("JWT_SECRET_KEY", "test-key-for-unit-tests")

from backend.services.db_service import WorkOrder, ChangeRequest, SessionLocal


def test_work_order_defaults():
    wo = WorkOrder(
        project_id=1,
        user_id=1,
        date=date.today(),
        process_type="TIG",
        target_feet=15.0,
        status="Pending",
        is_overtime=False,
    )
    assert wo.status == "Pending"
    assert wo.is_overtime is False
    assert wo.actual_feet is None
    assert wo.part_id is None
    assert wo.completed_part_process_id is None
    print("PASS: WorkOrder fields correct")


def test_change_request_defaults():
    cr = ChangeRequest(
        subject_type="employee_profile",
        subject_id=3,
        proposed_by=1,
        changes_json=json.dumps({"changes": {"skill_1": "TIG Welding"}}),
        status="pending_approval",
    )
    assert cr.status == "pending_approval"
    assert cr.rejection_note is None
    assert cr.resolved_at is None
    print("PASS: ChangeRequest fields correct")


def test_find_available_part_empty_project():
    """find_available_part returns None for a project with no production lines."""
    from backend.app.scheduler.router import find_available_part

    class FakeProject:
        production_lines = []

    db = SessionLocal()
    try:
        result = find_available_part(db, FakeProject(), "TIG")
        assert result is None
        print("PASS: find_available_part returns None for empty project")
    finally:
        db.close()


def test_employee_profile_changes_json():
    changes = {
        "employee_id": 3,
        "changes": {"skill_1": "TIG Welding", "target_per_day": 65.0, "active": True},
    }
    cr = ChangeRequest(
        subject_type="employee_profile",
        subject_id=3,
        proposed_by=1,
        changes_json=json.dumps(changes),
    )
    parsed = json.loads(cr.changes_json)
    assert "changes" in parsed
    assert parsed["changes"]["skill_1"] == "TIG Welding"
    assert parsed["changes"]["target_per_day"] == 65.0
    print("PASS: employee_profile changes_json structure valid")


def test_daily_plan_override_json():
    changes = {
        "exclude_user_ids": [5, 12],
        "capacity_overrides": {"3": 60.0},
        "notes": "Worker on leave",
    }
    cr = ChangeRequest(
        subject_type="daily_plan_override",
        target_date=date.today(),
        proposed_by=1,
        changes_json=json.dumps(changes),
    )
    parsed = json.loads(cr.changes_json)
    assert 5 in parsed["exclude_user_ids"]
    assert "3" in parsed["capacity_overrides"]
    print("PASS: daily_plan_override changes_json structure valid")


if __name__ == "__main__":
    test_work_order_defaults()
    test_change_request_defaults()
    test_find_available_part_empty_project()
    test_employee_profile_changes_json()
    test_daily_plan_override_json()
    print("\nAll work order tests passed.")
