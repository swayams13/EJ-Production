from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from typing import List
from datetime import datetime

from backend.services.db_service import get_db, Vendor, WarehouseStock, MaterialLeadTime
from backend.app.auth.rbac import require_roles, SUPERVISORS, MANAGEMENT
from backend.app.procurement.schemas import (
    VendorCreate, VendorUpdate, VendorResponse,
    StockAdjust, StockResponse,
    LeadTimeUpdate, LeadTimeResponse,
)
from backend.services.procurement_service import _vendor_avg_days_late

router = APIRouter(prefix="/api/v1/procurement", tags=["Procurement"])


# ── Vendors ────────────────────────────────────────────────────────────────

@router.get("/vendors", response_model=List[VendorResponse])
def list_vendors(db: Session = Depends(get_db), _=Depends(require_roles(SUPERVISORS))):
    vendors = db.query(Vendor).all()
    out = []
    for v in vendors:
        d = VendorResponse.model_validate(v)
        d.avg_days_late = _vendor_avg_days_late(db, v.id)
        out.append(d)
    return out

@router.post("/vendors", response_model=VendorResponse)
def create_vendor(body: VendorCreate, db: Session = Depends(get_db), _=Depends(require_roles(MANAGEMENT))):
    v = Vendor(**body.model_dump())
    db.add(v)
    db.commit()
    db.refresh(v)
    return v

@router.patch("/vendors/{vendor_id}", response_model=VendorResponse)
def update_vendor(vendor_id: int, body: VendorUpdate, db: Session = Depends(get_db), _=Depends(require_roles(MANAGEMENT))):
    v = db.query(Vendor).filter_by(id=vendor_id).first()
    if not v:
        raise HTTPException(404, "Vendor not found")
    for k, val in body.model_dump(exclude_none=True).items():
        setattr(v, k, val)
    db.commit()
    db.refresh(v)
    return v

@router.delete("/vendors/{vendor_id}")
def delete_vendor(vendor_id: int, db: Session = Depends(get_db), _=Depends(require_roles(MANAGEMENT))):
    v = db.query(Vendor).filter_by(id=vendor_id).first()
    if not v:
        raise HTTPException(404, "Vendor not found")
    db.delete(v)
    db.commit()
    return {"ok": True}


# ── Warehouse Stock ─────────────────────────────────────────────────────────

@router.get("/stock", response_model=List[StockResponse])
def list_stock(db: Session = Depends(get_db), _=Depends(require_roles(SUPERVISORS))):
    return db.query(WarehouseStock).order_by(WarehouseStock.material_name, WarehouseStock.size).all()

@router.post("/stock/adjust")
def adjust_stock(body: StockAdjust, db: Session = Depends(get_db), _=Depends(require_roles(MANAGEMENT))):
    item = db.query(WarehouseStock).filter_by(
        material_name=body.material_name, size=body.size, joint_type=body.joint_type
    ).first()
    if not item:
        item = WarehouseStock(
            material_name=body.material_name, size=body.size,
            joint_type=body.joint_type, qty_on_hand=0, reserved_qty=0, minimum_stock=0
        )
        db.add(item)
    if body.qty_on_hand is not None:
        item.qty_on_hand = body.qty_on_hand
    if body.minimum_stock is not None:
        item.minimum_stock = body.minimum_stock
    item.updated_at = datetime.utcnow()
    db.commit()
    db.refresh(item)
    return item


# ── Lead Times ──────────────────────────────────────────────────────────────

@router.get("/lead-times", response_model=List[LeadTimeResponse])
def list_lead_times(db: Session = Depends(get_db), _=Depends(require_roles(SUPERVISORS))):
    return db.query(MaterialLeadTime).order_by(MaterialLeadTime.material_name).all()

@router.patch("/lead-times/{material_name}")
def update_lead_time(material_name: str, body: LeadTimeUpdate, db: Session = Depends(get_db), _=Depends(require_roles(MANAGEMENT))):
    lt = db.query(MaterialLeadTime).filter_by(material_name=material_name).first()
    if not lt:
        lt = MaterialLeadTime(material_name=material_name, lead_time_days=body.lead_time_days)
        db.add(lt)
    else:
        lt.lead_time_days = body.lead_time_days
    db.commit()
    db.refresh(lt)
    return lt
