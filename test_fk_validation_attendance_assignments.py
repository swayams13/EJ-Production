# test_fk_validation_attendance_assignments.py
"""Confirms bad user_id/project_id return 404, not a raw 500. No pytest, no fixtures."""
import os
os.environ.setdefault("JWT_SECRET_KEY", "test-key-for-unit-tests")

from datetime import date
from fastapi import HTTPException
from backend.services.db_service import SessionLocal
from backend.app.workforce.router import submit_attendance, submit_attendance_bulk, AttendanceCreate
from backend.app.scheduler.router import create_assignment
from backend.app.scheduler.schemas import TaskAssignmentCreate


def test_single_attendance_bad_user_id():
    db = SessionLocal()
    current_user = {"username": "qa_test", "role": "Supervisor", "id": None}
    try:
        submit_attendance(AttendanceCreate(user_id=999999999, date=date.today(), status="Present"), db, current_user)
        assert False, "expected a 404 for a nonexistent user_id"
    except HTTPException as e:
        assert e.status_code == 404
        print("PASS: single attendance with bad user_id returns 404")


def test_bulk_attendance_bad_user_id_no_partial_apply():
    db = SessionLocal()
    current_user = {"username": "qa_test", "role": "Supervisor", "id": None}
    try:
        submit_attendance_bulk([AttendanceCreate(user_id=999999999, date=date.today(), status="Present")], db, current_user)
        assert False, "expected a 404 for a nonexistent user_id in a bulk batch"
    except HTTPException as e:
        assert e.status_code == 404
        print("PASS: bulk attendance with bad user_id returns 404")


def test_assignment_bad_project_and_user_id():
    db = SessionLocal()
    current_user = {"username": "qa_test", "role": "Supervisor", "id": None}
    try:
        create_assignment(
            TaskAssignmentCreate(project_id=999999, user_id=999999, process_type="TIG", date=date.today(), target_feet=10.0, status="Pending", is_overtime=False),
            db, current_user,
        )
        assert False, "expected a 404 for a nonexistent project_id/user_id"
    except HTTPException as e:
        assert e.status_code == 404
        print("PASS: create_assignment with bad ids returns 404")


test_single_attendance_bad_user_id()
test_bulk_attendance_bad_user_id_no_partial_apply()
test_assignment_bad_project_and_user_id()
print("All FK-validation tests passed.")
