# QA_SANDBOX: no DB rows created, pure Pydantic schema validation.
"""Confirms User role is constrained to known roles and names have a length cap. No pytest, no fixtures."""
from pydantic import ValidationError
from backend.app.users.schemas import UserCreate


def test_garbage_role_rejected():
    try:
        UserCreate(full_name="QA Sandbox", role="QA_SANDBOX_NotARealRole")
        assert False, "expected a ValidationError for an unrecognized role"
    except ValidationError:
        print("PASS: garbage role rejected")


def test_known_roles_accepted():
    for role in ["Developer", "GM", "Production Manager", "CEO", "MD", "Admin", "Supervisor", "Operator"]:
        UserCreate(full_name="QA Sandbox", role=role)
    print("PASS: all known roles accepted")


def test_overlong_name_rejected():
    try:
        UserCreate(full_name="A" * 20000, role="Operator")
        assert False, "expected a ValidationError for a 20,000-char full_name"
    except ValidationError:
        print("PASS: overlong full_name rejected")


test_garbage_role_rejected()
test_known_roles_accepted()
test_overlong_name_rejected()
print("All User schema validation tests passed.")
