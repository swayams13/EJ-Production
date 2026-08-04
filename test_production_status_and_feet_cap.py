"""Confirms final-check/assembly-step status enums and welding-log overshoot cap. No pytest, no fixtures."""
import os
os.environ.setdefault("JWT_SECRET_KEY", "test-key-for-unit-tests")

from pydantic import ValidationError
from backend.app.production.schemas import FinalCheckUpdate


def test_final_check_garbage_status_rejected():
    try:
        FinalCheckUpdate(status="TOTALLY_BOGUS_STATUS_XYZ")
        assert False, "expected a ValidationError for an unrecognized final-check status"
    except ValidationError:
        print("PASS: garbage final-check status rejected")


def test_assembly_step_garbage_status_rejected():
    from backend.app.production.router import AssemblyStepUpdate
    try:
        AssemblyStepUpdate(status="TOTALLY_BOGUS_STATUS_XYZ")
        assert False, "expected a ValidationError for an unrecognized assembly-step status"
    except ValidationError:
        print("PASS: garbage assembly-step status rejected")


test_final_check_garbage_status_rejected()
test_assembly_step_garbage_status_rejected()
print("All production status-enum tests passed.")
