# test_work_order_complete_bounds.py
"""Confirms actual_feet rejects negative values. No pytest, no fixtures."""
from pydantic import ValidationError
from backend.app.scheduler.schemas import WorkOrderComplete


def test_negative_actual_feet_rejected():
    try:
        WorkOrderComplete(actual_feet=-999999.0, status="Completed")
        assert False, "expected a ValidationError for negative actual_feet"
    except ValidationError:
        print("PASS: negative actual_feet is rejected")


def test_zero_and_positive_actual_feet_accepted():
    WorkOrderComplete(actual_feet=0.0, status="Completed")
    WorkOrderComplete(actual_feet=42.5, status="Completed")
    print("PASS: zero and positive actual_feet are accepted")


test_negative_actual_feet_rejected()
test_zero_and_positive_actual_feet_accepted()
print("All WorkOrderComplete bounds tests passed.")
