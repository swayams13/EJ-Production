import os
os.environ.setdefault("JWT_SECRET_KEY", "test-key-for-unit-tests")

from types import SimpleNamespace
from backend.app.procurement.router import _resolve_allocation_trace


def test_resolves_project_and_job_tag():
    alloc = SimpleNamespace(
        part=SimpleNamespace(
            production_line=SimpleNamespace(
                joint_type_code="DEJ-F",
                project=SimpleNamespace(project_name="BPCL-44"),
            )
        )
    )
    project_name, job_tag = _resolve_allocation_trace(alloc)
    assert project_name == "BPCL-44"
    assert job_tag == "DEJ-F"


def test_missing_part_returns_none():
    alloc = SimpleNamespace(part=None)
    project_name, job_tag = _resolve_allocation_trace(alloc)
    assert project_name is None
    assert job_tag is None


def test_missing_project_returns_none_name_but_keeps_tag():
    alloc = SimpleNamespace(
        part=SimpleNamespace(
            production_line=SimpleNamespace(joint_type_code="U-EJ-F-S-L", project=None)
        )
    )
    project_name, job_tag = _resolve_allocation_trace(alloc)
    assert project_name is None
    assert job_tag == "U-EJ-F-S-L"


test_resolves_project_and_job_tag()
test_missing_part_returns_none()
test_missing_project_returns_none_name_but_keeps_tag()
print("All PO allocation trace tests passed.")
