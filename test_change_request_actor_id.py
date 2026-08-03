"""Confirms env-var (no-DB-row) actors can create/approve change requests without a KeyError. No pytest, no fixtures."""
import os
os.environ.setdefault("JWT_SECRET_KEY", "test-key-for-unit-tests")

import json
from backend.services.db_service import SessionLocal, ChangeRequest
from backend.app.scheduler.router import create_change_request, approve_change_request
from backend.app.scheduler.schemas import ChangeRequestCreate


def test_env_var_user_with_no_id_can_create_change_request():
    db = SessionLocal()
    try:
        current_user = {"username": "test_pm_envvar", "role": "Production Manager", "id": None}
        payload = ChangeRequestCreate(
            subject_type="daily_plan_override",
            subject_id=None,
            target_date=None,
            changes_json=json.dumps({"exclude_user_ids": [], "capacity_overrides": {}}),
        )
        cr = create_change_request(payload, db, current_user)
        assert cr.proposed_by is None
        assert cr.proposed_by_username == "test_pm_envvar"
        print("PASS: env-var user (id=None) created a change request without a KeyError")

        current_user_approver = {"username": "test_gm_envvar", "role": "GM", "id": None}
        approved = approve_change_request(cr.id, db, current_user_approver)
        assert approved.status == "approved"
        assert approved.approved_by is None
        assert approved.approved_by_username == "test_gm_envvar"
        print("PASS: env-var user (id=None) approved a change request without a KeyError")
    finally:
        db.query(ChangeRequest).filter(ChangeRequest.proposed_by_username == "test_pm_envvar").delete()
        db.commit()
        db.close()


test_env_var_user_with_no_id_can_create_change_request()
print("All change-request actor-id tests passed.")
