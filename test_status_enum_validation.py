# test_status_enum_validation.py
"""Confirms WorkOrder.status and AttendanceLog.status reject garbage strings. No pytest, no fixtures."""
import os
os.environ.setdefault("JWT_SECRET_KEY", "test-key-for-unit-tests")

from pydantic import ValidationError
from backend.app.scheduler.schemas import WorkOrderComplete
from backend.app.workforce.router import AttendanceCreate


def test_work_order_garbage_status_rejected():
    try:
        WorkOrderComplete(actual_feet=1.0, status="QA_SANDBOX_BogusStatus")
        assert False, "expected a ValidationError for an unrecognized work-order status"
    except ValidationError:
        print("PASS: garbage WorkOrder status rejected")


def test_attendance_garbage_status_rejected():
    from datetime import date
    try:
        AttendanceCreate(user_id=1, date=date.today(), status="QA_SANDBOX_Bogus")
        assert False, "expected a ValidationError for an unrecognized attendance status"
    except ValidationError:
        print("PASS: garbage attendance status rejected")


test_work_order_garbage_status_rejected()
test_attendance_garbage_status_rejected()
print("All status-enum validation tests passed.")
