# test_procurement_bounds.py
"""Confirms StockAdjust and LeadTimeUpdate reject negative values. No pytest, no fixtures."""
from pydantic import ValidationError
from backend.app.procurement.schemas import StockAdjust, LeadTimeUpdate


def test_negative_stock_on_hand_rejected():
    try:
        StockAdjust(material_name="QA_SANDBOX_MAT", size=50, joint_type="EJ", qty_on_hand=-5)
        assert False, "expected a ValidationError for negative qty_on_hand"
    except ValidationError:
        print("PASS: negative qty_on_hand rejected")


def test_negative_lead_time_rejected():
    try:
        LeadTimeUpdate(lead_time_days=-3)
        assert False, "expected a ValidationError for negative lead_time_days"
    except ValidationError:
        print("PASS: negative lead_time_days rejected")


test_negative_stock_on_hand_rejected()
test_negative_lead_time_rejected()
print("All procurement bounds tests passed.")
