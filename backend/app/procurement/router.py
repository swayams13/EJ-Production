from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session, subqueryload
from typing import List
from datetime import datetime

from backend.services.db_service import (
    get_db, Vendor, WarehouseStock, MaterialLeadTime,
    PurchaseOrder, PurchaseOrderLine, PurchaseOrderLineAllocation,
    GoodsReceipt, GoodsReceiptLine, PartProcess, Part, User,
    DailyProcurementLog, MaterialHold, ProjectProductionLine,
)
from backend.app.auth.rbac import require_roles, SUPERVISORS, MANAGEMENT
from backend.app.procurement.schemas import (
    VendorCreate, VendorUpdate, VendorResponse,
    StockAdjust, StockResponse,
    LeadTimeUpdate, LeadTimeResponse,
    POCreate, POStatusUpdate, POResponse,
    ReceiptCreate, ReceiptResponse,
    DelayReasonCreate, DailyLogCreate,
)
from backend.services.procurement_service import _vendor_avg_days_late
from backend.services.notification_service import create_notification

router = APIRouter(prefix="/api/v1/procurement", tags=["Procurement"])

PO_ALLOWED_TRANSITIONS = {
    "draft": {"raised", "cancelled"},
    "raised": {"sent", "cancelled"},
    "sent": {"cancelled"},
}


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
    referencing_pos = db.query(PurchaseOrder).filter_by(vendor_id=vendor_id).count()
    if referencing_pos > 0:
        raise HTTPException(400, f"Cannot delete vendor: {referencing_pos} purchase order(s) still reference it. Reassign or cancel them first.")
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
        raise HTTPException(status_code=404, detail=f"No lead-time record exists for material '{material_name}'")
    lt.lead_time_days = body.lead_time_days
    db.commit()
    db.refresh(lt)
    return lt


# ── Purchase Orders ──────────────────────────────────────────────────────────

@router.get("/po", response_model=List[POResponse])
def list_pos(db: Session = Depends(get_db), _=Depends(require_roles(SUPERVISORS))):
    return db.query(PurchaseOrder).order_by(PurchaseOrder.id.desc()).all()


@router.post("/po", response_model=POResponse)
def create_po(body: POCreate, db: Session = Depends(get_db), user=Depends(require_roles(MANAGEMENT))):
    if db.query(PurchaseOrder).filter_by(po_number=body.po_number).first():
        raise HTTPException(status_code=409, detail=f"PO number '{body.po_number}' already exists")
    u = db.query(User).filter_by(username=user["username"]).first()
    po = PurchaseOrder(
        po_number=body.po_number,
        vendor_id=body.vendor_id,
        po_date=body.po_date,
        expected_delivery_date=body.expected_delivery_date,
        total_value=body.total_value,
        notes=body.notes,
        status="draft",
        raised_by=u.id if u else None,
        raised_by_username=user["username"],
    )
    db.add(po)
    db.flush()  # get po.id before adding lines

    for line_data in body.lines:
        line = PurchaseOrderLine(
            purchase_order_id=po.id,
            material_name=line_data.material_name,
            size=line_data.size,
            joint_type=line_data.joint_type,
            ordered_qty=line_data.ordered_qty,
            unit_price=line_data.unit_price,
        )
        db.add(line)
        db.flush()  # get line.id before adding allocations
        for alloc in line_data.allocations:
            db.add(PurchaseOrderLineAllocation(
                po_line_id=line.id,
                part_id=alloc.part_id,
                allocated_qty=alloc.allocated_qty,
            ))
            # Reserve warehouse stock if a matching row exists
            stock = db.query(WarehouseStock).filter_by(
                material_name=line_data.material_name,
                size=line_data.size,
                joint_type=line_data.joint_type,
            ).first()
            if stock:
                stock.reserved_qty = (stock.reserved_qty or 0) + alloc.allocated_qty

    db.commit()
    db.refresh(po)
    return po


def _resolve_allocation_trace(alloc):
    """(project_name, job_tag) for a PO line allocation, via its part's production line."""
    part = alloc.part
    line = part.production_line if part else None
    if not line:
        return None, None
    project_name = line.project.project_name if line.project else None
    return project_name, line.joint_type_code


@router.get("/po/{po_id}", response_model=POResponse)
def get_po(po_id: int, db: Session = Depends(get_db), _=Depends(require_roles(SUPERVISORS))):
    po = (
        db.query(PurchaseOrder)
        .filter_by(id=po_id)
        .options(
            subqueryload(PurchaseOrder.lines)
            .subqueryload(PurchaseOrderLine.allocations)
            .subqueryload(PurchaseOrderLineAllocation.part)
            .subqueryload(Part.production_line)
            .subqueryload(ProjectProductionLine.project)
        )
        .first()
    )
    if not po:
        raise HTTPException(404, "PO not found")

    response = POResponse.model_validate(po)
    for line, line_resp in zip(po.lines, response.lines):
        for alloc, alloc_resp in zip(line.allocations, line_resp.allocations):
            alloc_resp.project_name, alloc_resp.job_tag = _resolve_allocation_trace(alloc)
    return response


@router.patch("/po/{po_id}/status")
def update_po_status(po_id: int, body: POStatusUpdate, db: Session = Depends(get_db), _=Depends(require_roles(MANAGEMENT))):
    po = db.query(PurchaseOrder).filter_by(id=po_id).first()
    if not po:
        raise HTTPException(404, "PO not found")
    if po.status == "received":
        raise HTTPException(400, "Cannot change status of a fully received PO")
    allowed_next = PO_ALLOWED_TRANSITIONS.get(po.status, set())
    if body.status not in allowed_next:
        raise HTTPException(400, f"Cannot move a PO from '{po.status}' to '{body.status}'. Allowed: {sorted(allowed_next) or 'none'}")

    old_status = po.status
    po.status = body.status
    if body.delay_reason:
        po.delay_reason = body.delay_reason

    # On cancel: release reserved stock
    if body.status == "cancelled" and old_status != "cancelled":
        for line in po.lines:
            stock = db.query(WarehouseStock).filter_by(
                material_name=line.material_name, size=line.size, joint_type=line.joint_type
            ).first()
            if stock:
                total_allocated = sum(a.allocated_qty for a in line.allocations)
                already_rcvd = line.received_qty or 0
                stock.reserved_qty = max(0, (stock.reserved_qty or 0) - (total_allocated - already_rcvd))

    # On raised: mark PartProcess("PO") status=ready for all allocated parts
    if body.status == "raised":
        for line in po.lines:
            for alloc in line.allocations:
                part = db.query(Part).filter_by(id=alloc.part_id).first()
                if part:
                    po_proc = next((p for p in part.processes if p.process_name == "PO"), None)
                    if po_proc:
                        po_proc.status = "ready"
                        po_proc.po_number = po.po_number

    po.updated_at = datetime.utcnow()
    db.commit()
    return {"ok": True, "status": po.status}


# ── Goods Receipt + FIFO Shop Floor Sync ─────────────────────────────────────

def _fifo_sync(db: Session, po_line: PurchaseOrderLine, qty_this_receipt: int):
    """Distribute qty_this_receipt across allocations in insertion order (FIFO).
    Updates allocation.already_received and PartProcess("Material Received").completed_qty."""
    remaining = qty_this_receipt
    allocations = sorted(po_line.allocations, key=lambda a: a.id)

    for alloc in allocations:
        if remaining <= 0:
            break
        capacity = alloc.allocated_qty - alloc.already_received
        if capacity <= 0:
            continue
        fill = min(remaining, capacity)
        alloc.already_received += fill
        remaining -= fill

        part = db.query(Part).filter_by(id=alloc.part_id).first()
        if part:
            mat_proc = next((p for p in part.processes if p.process_name == "Material Received"), None)
            if mat_proc:
                mat_proc.completed_qty = min(
                    (mat_proc.completed_qty or 0) + fill,
                    part.total_qty,
                )


def _cascade_material_received(db: Session, material_name: str, size: int, joint_type: str) -> int:
    """Resolve active MaterialHolds for this spec whose required_qty is now covered by current stock."""
    active = db.query(MaterialHold).filter_by(
        material_name=material_name,
        size=size,
        joint_type=joint_type,
        status="active",
    ).all()
    if not active:
        return 0
    stock = db.query(WarehouseStock).filter_by(
        material_name=material_name, size=size, joint_type=joint_type
    ).first()
    avail = max(0, (stock.qty_on_hand or 0) - (stock.reserved_qty or 0)) if stock else 0
    resolved = 0
    for h in active:
        if avail >= h.required_qty:
            h.status = "resolved"
            h.resolved_at = datetime.utcnow()
            resolved += 1
    return resolved


@router.post("/po/{po_id}/receipt", response_model=ReceiptResponse)
def log_receipt(po_id: int, body: ReceiptCreate, db: Session = Depends(get_db), user=Depends(require_roles(MANAGEMENT))):
    po = db.query(PurchaseOrder).filter_by(id=po_id).first()
    if not po:
        raise HTTPException(404, "PO not found")
    if po.status in ("cancelled", "received"):
        raise HTTPException(400, f"Cannot receive against a {po.status} PO")

    u = db.query(User).filter_by(username=user["username"]).first()

    from datetime import date as _date
    receipt = GoodsReceipt(
        purchase_order_id=po_id,
        receipt_date=body.receipt_date or _date.today(),
        received_by=u.id if u else None,
        received_by_username=user["username"],
        notes=body.notes,
    )
    db.add(receipt)
    db.flush()

    for rl in body.lines:
        po_line = db.query(PurchaseOrderLine).filter_by(id=rl.po_line_id, purchase_order_id=po_id).first()
        if not po_line:
            raise HTTPException(404, f"PO line {rl.po_line_id} not found on this PO")

        remaining = po_line.ordered_qty - (po_line.received_qty or 0)
        if rl.qty_received > remaining:
            raise HTTPException(400, f"Cannot receive {rl.qty_received} against PO line {rl.po_line_id} — only {remaining} remaining (ordered {po_line.ordered_qty}, already received {po_line.received_qty or 0})")

        db.add(GoodsReceiptLine(receipt_id=receipt.id, po_line_id=rl.po_line_id, qty_received=rl.qty_received))

        po_line.received_qty = (po_line.received_qty or 0) + rl.qty_received
        po_line.status = "received" if po_line.received_qty >= po_line.ordered_qty else "partially_received"

        stock = db.query(WarehouseStock).filter_by(
            material_name=po_line.material_name, size=po_line.size, joint_type=po_line.joint_type
        ).first()
        if stock:
            stock.qty_on_hand = (stock.qty_on_hand or 0) + rl.qty_received
            stock.reserved_qty = max(0, (stock.reserved_qty or 0) - rl.qty_received)
            stock.updated_at = datetime.utcnow()

        _fifo_sync(db, po_line, rl.qty_received)

    all_lines = po.lines
    if all(ln.status == "received" for ln in all_lines):
        po.status = "received"
    elif any((ln.received_qty or 0) > 0 for ln in all_lines):
        po.status = "partially_received"
    po.updated_at = datetime.utcnow()

    # Cascade: resolve MaterialHolds for each received material spec
    total_resolved = 0
    for rl in body.lines:
        po_line = db.query(PurchaseOrderLine).filter_by(id=rl.po_line_id).first()
        if po_line:
            total_resolved += _cascade_material_received(
                db, po_line.material_name, po_line.size, po_line.joint_type
            )

    db.commit()
    create_notification(
        db, "Production Manager", "po_received",
        f"PO received: {po.po_number}",
        f"Goods receipt logged for PO {po.po_number}.",
        "/procurement/po",
    )
    db.refresh(receipt)
    from backend.app.procurement.schemas import ReceiptResponse
    return ReceiptResponse(
        id=receipt.id,
        purchase_order_id=receipt.purchase_order_id,
        receipt_date=receipt.receipt_date,
        received_by=receipt.received_by,
        notes=receipt.notes,
        resolved_holds=total_resolved,
    )


# ── Delay Reason ──────────────────────────────────────────────────────────────

@router.post("/delay-reason")
def log_delay_reason(body: DelayReasonCreate, db: Session = Depends(get_db), _=Depends(require_roles(MANAGEMENT))):
    """Create or update a draft PO placeholder to log a delay reason for a part."""
    existing_draft = (
        db.query(PurchaseOrder)
        .join(PurchaseOrderLine)
        .join(PurchaseOrderLineAllocation)
        .filter(
            PurchaseOrderLineAllocation.part_id == body.part_id,
            PurchaseOrder.status == "draft",
            PurchaseOrder.delay_reason.isnot(None),
        )
        .first()
    )
    if existing_draft:
        existing_draft.delay_reason = body.reason
        db.commit()
        return {"ok": True, "po_id": existing_draft.id}

    from datetime import date as _date
    po = PurchaseOrder(
        po_number=f"DELAY-{body.part_id}-{_date.today().isoformat()}",
        status="draft",
        delay_reason=body.reason,
    )
    db.add(po)
    db.flush()

    part = db.query(Part).filter_by(id=body.part_id).first()
    if part:
        line_obj = part.production_line
        po_line = PurchaseOrderLine(
            purchase_order_id=po.id,
            material_name=part.name,
            size=line_obj.size,
            joint_type=line_obj.joint_type,
            ordered_qty=part.total_qty,
        )
        db.add(po_line)
        db.flush()
        db.add(PurchaseOrderLineAllocation(po_line_id=po_line.id, part_id=body.part_id, allocated_qty=part.total_qty))

    db.commit()
    return {"ok": True, "po_id": po.id}


# ── Morning List ──────────────────────────────────────────────────────────────

@router.get("/morning-list")
def morning_list(db: Session = Depends(get_db), _=Depends(require_roles(SUPERVISORS))):
    from backend.services.procurement_service import get_morning_list
    from datetime import date as _date
    items = get_morning_list(db)

    part_delay_map = {}
    draft_pos = (
        db.query(PurchaseOrder)
        .filter(PurchaseOrder.status == "draft", PurchaseOrder.delay_reason.isnot(None))
        .options(
            subqueryload(PurchaseOrder.lines).subqueryload(PurchaseOrderLine.allocations)
        )
        .all()
    )
    for po in draft_pos:
        for line in po.lines:
            for alloc in line.allocations:
                part_delay_map[alloc.part_id] = po.delay_reason

    today = _date.today()
    today_logs = {
        log.part_id: log
        for log in db.query(DailyProcurementLog).filter_by(log_date=today).all()
    }

    for item in items:
        item["delay_reason"] = part_delay_map.get(item["part_id"])
        log = today_logs.get(item["part_id"])
        item["qty_ordered_today"] = log.qty_ordered if log else 0
        item["qty_received_today"] = log.qty_received if log else 0
        # Reduce still_needs_ordering by what the PM has already ordered today
        item["still_needs_ordering"] = max(0, item["still_needs_ordering"] - item["qty_ordered_today"])

    from sqlalchemy import func as _func
    material_holds_count = (
        db.query(_func.count(MaterialHold.id))
        .filter(MaterialHold.status == "active")
        .scalar()
    ) or 0

    return {"items": items, "material_holds_count": material_holds_count}


# ── Daily Procurement Log ──────────────────────────────────────────────────────

@router.post("/daily-log")
def upsert_daily_log(body: DailyLogCreate, db: Session = Depends(get_db), _=Depends(require_roles(MANAGEMENT))):
    if not db.query(Part).filter(Part.id == body.part_id).first():
        raise HTTPException(status_code=404, detail=f"Part {body.part_id} not found")

    from datetime import date as _date
    today = _date.today()
    log = db.query(DailyProcurementLog).filter_by(log_date=today, part_id=body.part_id).first()

    prev_received = log.qty_received if log else 0
    delta = body.qty_received - prev_received

    if log:
        log.qty_ordered = body.qty_ordered
        log.qty_received = body.qty_received
    else:
        log = DailyProcurementLog(
            log_date=today, part_id=body.part_id,
            qty_ordered=body.qty_ordered, qty_received=body.qty_received,
        )
        db.add(log)

    if delta != 0:
        part = db.query(Part).filter_by(id=body.part_id).first()
        if part:
            mat_proc = next((p for p in part.processes if p.process_name == "Material Received"), None)
            if mat_proc:
                mat_proc.completed_qty = max(0, (mat_proc.completed_qty or 0) + delta)
            if delta > 0:
                line = part.production_line
                if line:
                    stock = db.query(WarehouseStock).filter_by(
                        material_name=part.name, size=line.size, joint_type=line.joint_type
                    ).first()
                    if stock:
                        stock.qty_on_hand = (stock.qty_on_hand or 0) + delta
                        stock.updated_at = datetime.utcnow()
                    if delta > 0 and stock:
                        _cascade_material_received(db, part.name, line.size, line.joint_type)

    db.commit()
    return {"ok": True}
