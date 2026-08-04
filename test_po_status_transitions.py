# test_po_status_transitions.py
"""Confirms PO status updates reject invalid transitions and garbage strings. No pytest, no fixtures."""
from datetime import date
from fastapi import HTTPException
from pydantic import ValidationError
from backend.services.db_service import SessionLocal, PurchaseOrder
from backend.app.procurement.router import update_po_status
from backend.app.procurement.schemas import POStatusUpdate


def _make_sandbox_po(db, status="draft"):
    po = PurchaseOrder(po_number="QA_SANDBOX_PO_STATUS_TEST", po_date=date.today(), status=status, raised_by_username="qa_test")
    db.add(po)
    db.commit()
    db.refresh(po)
    return po


def test_garbage_status_string_rejected_by_schema():
    try:
        POStatusUpdate(status="flibbertigibbet")
        assert False, "expected a ValidationError for an unrecognized status string"
    except ValidationError:
        print("PASS: garbage status string rejected at the schema level")


def test_received_is_not_a_constructible_manual_target():
    # "received"/"partially_received"/"draft" are system-set (by the receipt endpoint) or
    # the initial state — never a manual target — so the schema itself rejects them, one
    # layer before update_po_status's transition-table check would ever run.
    try:
        POStatusUpdate(status="received")
        assert False, "expected a ValidationError for 'received' as a manual status target"
    except ValidationError:
        print("PASS: 'received' is rejected at the schema level, not constructible as a manual target")


def test_draft_to_sent_directly_rejected():
    # "sent" is a valid Literal value, so this exercises the PO_ALLOWED_TRANSITIONS
    # business-logic check in update_po_status itself, not just the schema.
    db = SessionLocal()
    po = _make_sandbox_po(db, status="draft")
    current_user = {"username": "qa_test", "role": "GM", "id": None}
    try:
        try:
            update_po_status(po.id, POStatusUpdate(status="sent"), db, current_user)
            assert False, "expected a 400 for draft -> sent directly"
        except HTTPException as e:
            assert e.status_code == 400
            print("PASS: draft -> sent directly is rejected")
    finally:
        db.query(PurchaseOrder).filter_by(id=po.id).delete()
        db.commit()


def test_valid_transition_succeeds():
    db = SessionLocal()
    po = _make_sandbox_po(db, status="draft")
    current_user = {"username": "qa_test", "role": "GM", "id": None}
    try:
        result = update_po_status(po.id, POStatusUpdate(status="raised"), db, current_user)
        assert result["status"] == "raised"
        print("PASS: draft -> raised succeeds")
    finally:
        db.query(PurchaseOrder).filter_by(id=po.id).delete()
        db.commit()


test_garbage_status_string_rejected_by_schema()
test_received_is_not_a_constructible_manual_target()
test_draft_to_sent_directly_rejected()
test_valid_transition_succeeds()
print("All PO status transition tests passed.")
