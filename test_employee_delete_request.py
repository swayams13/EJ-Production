# test_employee_delete_request.py
"""Confirms the PM employee-deletion request/approval workflow. No pytest, no fixtures."""
import os
os.environ.setdefault("JWT_SECRET_KEY", "test-key-for-unit-tests")

import json
from fastapi import HTTPException
from backend.services.db_service import SessionLocal, ChangeRequest, Employee, Notification
from backend.app.scheduler.router import create_change_request, approve_change_request, reject_change_request
from backend.app.scheduler.schemas import ChangeRequestCreate, ChangeRequestReject


def _make_sandbox_employee(db):
    emp = Employee(emp_id="QA_SANDBOX_EMP_001", name="QA_SANDBOX_EMP_001", company="D2", target_per_day=50.0)
    db.add(emp)
    db.commit()
    db.refresh(emp)
    return emp


def test_pm_request_only_developer_gm_admin_can_approve():
    db = SessionLocal()
    emp = _make_sandbox_employee(db)
    try:
        pm_user = {"username": "test_pm", "role": "Production Manager", "id": None}
        payload = ChangeRequestCreate(
            subject_type="employee_delete",
            subject_id=emp.id,
            target_date=None,
            changes_json=json.dumps({"employee_name": emp.name}),
        )
        cr = create_change_request(payload, db, pm_user)
        assert cr.status == "pending_approval"

        # CEO and MD should each have gotten a notification about this request.
        notifs = db.query(Notification).filter_by(event_type="employee_delete_request").all()
        roles_notified = {n.for_role for n in notifs}
        assert {"CEO", "MD"}.issubset(roles_notified)
        print("PASS: CEO and MD notified when the deletion request was created")

        # PM cannot approve their own request.
        try:
            approve_change_request(cr.id, db, pm_user)
            assert False, "PM should not be able to approve an employee_delete request"
        except HTTPException as e:
            assert e.status_code == 403
            print("PASS: Production Manager cannot approve an employee_delete request")

        # GM can approve it, and the employee actually gets deleted.
        gm_user = {"username": "test_gm", "role": "GM", "id": None}
        approve_change_request(cr.id, db, gm_user)
        assert db.query(Employee).filter_by(id=emp.id).first() is None
        print("PASS: GM approval actually deletes the employee")
    finally:
        db.query(ChangeRequest).filter(ChangeRequest.subject_type == "employee_delete", ChangeRequest.subject_id == emp.id).delete()
        db.query(Notification).filter_by(event_type="employee_delete_request").delete()
        db.query(Employee).filter_by(id=emp.id).delete()
        db.commit()
        db.close()


def test_pm_cannot_reject_own_request_either():
    db = SessionLocal()
    emp = _make_sandbox_employee(db)
    try:
        pm_user = {"username": "test_pm", "role": "Production Manager", "id": None}
        cr = create_change_request(
            ChangeRequestCreate(subject_type="employee_delete", subject_id=emp.id, target_date=None,
                                changes_json=json.dumps({"employee_name": emp.name})),
            db, pm_user,
        )
        try:
            reject_change_request(cr.id, ChangeRequestReject(rejection_note="no"), db, pm_user)
            assert False, "PM should not be able to reject an employee_delete request either"
        except HTTPException as e:
            assert e.status_code == 403
            print("PASS: Production Manager cannot reject an employee_delete request")
    finally:
        db.query(ChangeRequest).filter(ChangeRequest.subject_type == "employee_delete", ChangeRequest.subject_id == emp.id).delete()
        db.query(Notification).filter_by(event_type="employee_delete_request").delete()
        db.query(Employee).filter_by(id=emp.id).delete()
        db.commit()
        db.close()


test_pm_request_only_developer_gm_admin_can_approve()
test_pm_cannot_reject_own_request_either()
print("All employee-delete-request workflow tests passed.")
