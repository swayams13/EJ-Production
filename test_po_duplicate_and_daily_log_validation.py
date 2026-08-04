# test_po_duplicate_and_daily_log_validation.py
"""Confirms duplicate PO numbers 409 cleanly and daily-log validates part_id. No pytest, no fixtures."""
import os
os.environ.setdefault("JWT_SECRET_KEY", "test-key-for-unit-tests")

from datetime import date
from fastapi import HTTPException
from backend.services.db_service import SessionLocal, PurchaseOrder
from backend.app.procurement.router import create_po, upsert_daily_log
from backend.app.procurement.schemas import POCreate, DailyLogCreate


def test_duplicate_po_number_is_409_not_500():
    db = SessionLocal()
    current_user = {"username": "qa_test", "role": "GM", "id": None}
    try:
        create_po(POCreate(po_number="QA_SANDBOX_DUPE_PO", po_date=date.today(), lines=[]), db, current_user)
        try:
            create_po(POCreate(po_number="QA_SANDBOX_DUPE_PO", po_date=date.today(), lines=[]), db, current_user)
            assert False, "expected a 409 for a duplicate po_number"
        except HTTPException as e:
            assert e.status_code == 409
            print("PASS: duplicate po_number returns 409, not a raw 500")
    finally:
        db.query(PurchaseOrder).filter_by(po_number="QA_SANDBOX_DUPE_PO").delete()
        db.commit()


def test_daily_log_unknown_part_id_is_404():
    db = SessionLocal()
    current_user = {"username": "qa_test", "role": "GM", "id": None}
    try:
        upsert_daily_log(DailyLogCreate(part_id=999999999, qty_ordered=0, qty_received=0), db, current_user)
        assert False, "expected a 404 for a nonexistent part_id"
    except HTTPException as e:
        assert e.status_code == 404
        print("PASS: daily-log with unknown part_id returns 404, not a raw 500")


test_duplicate_po_number_is_409_not_500()
test_daily_log_unknown_part_id_is_404()
print("All PO-duplicate and daily-log validation tests passed.")
