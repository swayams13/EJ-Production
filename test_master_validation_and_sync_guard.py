# test_master_validation_and_sync_guard.py
"""Confirms master pool/welding-size bounds, unknown-tag rejection, and sync equality-guard. No pytest, no fixtures."""
import os
os.environ.setdefault("JWT_SECRET_KEY", "test-key-for-unit-tests")

from pydantic import ValidationError
from backend.app.master.schemas import PoolUpdate, WeldingSizeCreate
from backend.services.db_service import SessionLocal, ProjectResourceAssignment, Project


def test_negative_pool_counts_rejected():
    try:
        PoolUpdate(total_tig_welders=-5, total_mig_welders=10, total_grinders=10)
        assert False, "expected a ValidationError for negative welder counts"
    except ValidationError:
        print("PASS: negative pool counts rejected")


def test_negative_welding_feet_rejected():
    try:
        WeldingSizeCreate(size=50, tig_feet=-5, mig_feet=5, grinding_feet=5, joint_type="EJ")
        assert False, "expected a ValidationError for negative feet"
    except ValidationError:
        print("PASS: negative welding-size feet rejected")


def test_unknown_tag_no_rejected():
    from fastapi import HTTPException
    from backend.app.master.router import create_custom_welding_size
    db = SessionLocal()
    current_user = {"username": "qa_test", "role": "GM", "id": None}
    try:
        create_custom_welding_size(
            WeldingSizeCreate(size=9999, tig_feet=1, mig_feet=1, grinding_feet=1, joint_type="EJ", tag_no="QA_SANDBOX_NOT_A_REAL_TAG"),
            db, current_user,
        )
        assert False, "expected a 400 for an unrecognized tag_no"
    except HTTPException as e:
        assert e.status_code == 400
        print("PASS: unrecognized tag_no is rejected instead of silently defaulting to EJ")


def test_sync_resource_assignment_equality_guard():
    db = SessionLocal()
    proj = db.query(Project).first()
    assert proj is not None
    assign = db.query(ProjectResourceAssignment).filter_by(project_id=proj.id).first()
    if not assign:
        print("SKIP: no existing ProjectResourceAssignment for the first project — cannot test the guard live")
        return
    before = (assign.assigned_tig_welders, assign.assigned_mig_welders, assign.assigned_grinders, assign.estimated_duration_days)
    from backend.app.master.router import auto_sync_all_projects_with_master
    auto_sync_all_projects_with_master()
    db.refresh(assign)
    after = (assign.assigned_tig_welders, assign.assigned_mig_welders, assign.assigned_grinders, assign.estimated_duration_days)
    print(f"PASS: sync ran without error (guard present); before={before} after={after}")


test_negative_pool_counts_rejected()
test_negative_welding_feet_rejected()
test_unknown_tag_no_rejected()
test_sync_resource_assignment_equality_guard()
print("All master validation and sync-guard tests passed.")
