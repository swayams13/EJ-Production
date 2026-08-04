# test_procurement_business_rules.py
"""Confirms lead-time 404s on unknown material, and vendor delete blocks when referenced. No pytest, no fixtures."""
import os
os.environ.setdefault("JWT_SECRET_KEY", "test-key-for-unit-tests")

from datetime import date
from fastapi import HTTPException
from backend.services.db_service import SessionLocal, Vendor, PurchaseOrder, MaterialLeadTime
from backend.app.procurement.router import update_lead_time, delete_vendor
from backend.app.procurement.schemas import LeadTimeUpdate


def test_lead_time_unknown_material_is_404():
    db = SessionLocal()
    current_user = {"username": "qa_test", "role": "GM", "id": None}
    try:
        update_lead_time("QA_SANDBOX_NOT_A_REAL_MATERIAL", LeadTimeUpdate(lead_time_days=5), db, current_user)
        assert False, "expected a 404 for an unrecognized material name"
    except HTTPException as e:
        assert e.status_code == 404
        print("PASS: lead-time PATCH on an unknown material 404s instead of silently upserting")
    finally:
        db.query(MaterialLeadTime).filter_by(material_name="QA_SANDBOX_NOT_A_REAL_MATERIAL").delete()
        db.commit()


def test_vendor_delete_blocked_when_referenced():
    db = SessionLocal()
    vendor = Vendor(name="QA_SANDBOX_VENDOR_DELETE_TEST")
    db.add(vendor)
    db.flush()
    po = PurchaseOrder(po_number="QA_SANDBOX_VENDOR_DELETE_PO", po_date=date.today(), status="draft", vendor_id=vendor.id, raised_by_username="qa_test")
    db.add(po)
    db.commit()
    db.refresh(vendor)

    current_user = {"username": "qa_test", "role": "GM", "id": None}
    try:
        try:
            delete_vendor(vendor.id, db, current_user)
            assert False, "expected a 400 when the vendor is referenced by a PO"
        except HTTPException as e:
            assert e.status_code == 400
            print("PASS: vendor delete is blocked when a PO still references it")
    finally:
        db.query(PurchaseOrder).filter_by(id=po.id).delete()
        db.query(Vendor).filter_by(id=vendor.id).delete()
        db.commit()


test_lead_time_unknown_material_is_404()
test_vendor_delete_blocked_when_referenced()
print("All procurement business-rule tests passed.")
