# test_goods_receipt_bounds.py
"""Confirms goods receipt rejects non-positive qty, over-receipt, and receipt against an already-received PO. No pytest, no fixtures."""
import os
os.environ.setdefault("JWT_SECRET_KEY", "test-key-for-unit-tests")

from datetime import date
from fastapi import HTTPException
from pydantic import ValidationError
from backend.services.db_service import SessionLocal, PurchaseOrder, PurchaseOrderLine
from backend.app.procurement.router import log_receipt
from backend.app.procurement.schemas import ReceiptCreate, ReceiptLineCreate


def _make_sandbox_po_with_line(db, ordered_qty=20, po_status="raised", line_status="pending"):
    po = PurchaseOrder(po_number="QA_SANDBOX_RECEIPT_TEST", po_date=date.today(), status=po_status, raised_by_username="qa_test")
    db.add(po)
    db.flush()
    line = PurchaseOrderLine(purchase_order_id=po.id, material_name="QA_SANDBOX_MAT", size=50, joint_type="EJ",
                              ordered_qty=ordered_qty, received_qty=0, status=line_status)
    db.add(line)
    db.commit()
    db.refresh(po)
    db.refresh(line)
    return po, line


def test_negative_qty_rejected_by_schema():
    try:
        ReceiptLineCreate(po_line_id=1, qty_received=-50)
        assert False, "expected a ValidationError for negative qty_received"
    except ValidationError:
        print("PASS: negative qty_received rejected at the schema level")


def test_over_receipt_rejected():
    db = SessionLocal()
    po, line = _make_sandbox_po_with_line(db, ordered_qty=20)
    current_user = {"username": "qa_test", "role": "GM", "id": None}
    try:
        try:
            log_receipt(po.id, ReceiptCreate(lines=[ReceiptLineCreate(po_line_id=line.id, qty_received=999)]), db, current_user)
            assert False, "expected a 400 for receiving more than ordered_qty"
        except HTTPException as e:
            assert e.status_code == 400
            print("PASS: over-receipt (999 against ordered_qty=20) is rejected")
    finally:
        db.rollback()  # discard the GoodsReceipt row flushed before the over-receipt check raised
        db.query(PurchaseOrderLine).filter_by(purchase_order_id=po.id).delete()
        db.query(PurchaseOrder).filter_by(id=po.id).delete()
        db.commit()


def test_receipt_against_already_received_po_rejected():
    db = SessionLocal()
    po, line = _make_sandbox_po_with_line(db, ordered_qty=20, po_status="received", line_status="received")
    line.received_qty = 20
    db.commit()
    current_user = {"username": "qa_test", "role": "GM", "id": None}
    try:
        try:
            log_receipt(po.id, ReceiptCreate(lines=[ReceiptLineCreate(po_line_id=line.id, qty_received=5)]), db, current_user)
            assert False, "expected a 400 for receiving against an already-received PO"
        except HTTPException as e:
            assert e.status_code == 400
            print("PASS: receipt against an already-received PO is rejected")
    finally:
        db.query(PurchaseOrderLine).filter_by(purchase_order_id=po.id).delete()
        db.query(PurchaseOrder).filter_by(id=po.id).delete()
        db.commit()


test_negative_qty_rejected_by_schema()
test_over_receipt_rejected()
test_receipt_against_already_received_po_rejected()
print("All goods-receipt bounds tests passed.")
