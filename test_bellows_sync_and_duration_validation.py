"""Confirms bellows-sync failures propagate as errors, and /duration 404s on unknown project. No pytest, no fixtures."""
import os
os.environ.setdefault("JWT_SECRET_KEY", "test-key-for-unit-tests")

from fastapi import HTTPException
from backend.services.db_service import SessionLocal
from backend.app.projects.router import update_project_bellows, get_duration
from backend.app.projects.schemas import BellowItem, DurationRequest


def test_bellows_update_on_unknown_project_errors():
    db = SessionLocal()
    current_user = {"username": "qa_test", "role": "Developer", "id": None}
    try:
        update_project_bellows(999999999, [BellowItem(size=50, qty=1, type="EJ")], db, current_user)
        assert False, "expected an error when syncing bellows for a nonexistent project"
    except HTTPException as e:
        assert e.status_code in (400, 404)
        print(f"PASS: bellows update on unknown project now errors ({e.status_code}) instead of reporting fake success")
    finally:
        db.close()


def test_duration_unknown_project_is_404():
    db = SessionLocal()
    current_user = {"username": "qa_test", "role": "Developer", "id": None}
    try:
        get_duration(DurationRequest(project_id=999999999, assigned_tig=1, assigned_mig=1, assigned_grinders=1), db, current_user)
        assert False, "expected a 404 for an unknown project_id"
    except HTTPException as e:
        assert e.status_code == 404
        print("PASS: /duration on an unknown project_id returns 404, not a raw 500")
    finally:
        db.close()


test_bellows_update_on_unknown_project_errors()
test_duration_unknown_project_is_404()
print("All bellows-sync and duration-validation tests passed.")
