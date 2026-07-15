from datetime import date
from sqlalchemy.orm import Session
from sqlalchemy import func

from backend.services.db_service import (
    Project, ProjectProductionLine, Part, PartProcess,
    PurchaseOrderLineAllocation, PurchaseOrderLine, PurchaseOrder,
    WarehouseStock, MaterialLeadTime, GoodsReceipt
)


def _get_effective_priority(project: Project) -> str:
    """Explicit priority overrides; else compute from deadline."""
    if getattr(project, "priority", None):
        return project.priority
    if not project.target_date:
        return "P3"
    days = (project.target_date - date.today()).days
    if days <= 21:
        return "P1"
    if days <= 60:
        return "P2"
    return "P3"


def _vendor_avg_days_late(db: Session, vendor_id: int) -> float:
    """Rolling average of delivery lateness for a vendor (last 10 POs). 0 if < 3 data points."""
    completed = (
        db.query(PurchaseOrder)
        .filter(PurchaseOrder.vendor_id == vendor_id, PurchaseOrder.status == "received")
        .order_by(PurchaseOrder.id.desc())
        .limit(10)
        .all()
    )
    if len(completed) < 3:
        return 0.0
    deltas = []
    for po in completed:
        if po.expected_delivery_date:
            last_receipt = (
                db.query(GoodsReceipt)
                .filter(GoodsReceipt.purchase_order_id == po.id)
                .order_by(GoodsReceipt.receipt_date.desc())
                .first()
            )
            if last_receipt:
                deltas.append((last_receipt.receipt_date - po.expected_delivery_date).days)
    return sum(deltas) / len(deltas) if deltas else 0.0


def _is_repeat_client(db: Session, client_name: str) -> bool:
    count = db.query(func.count(Project.id)).filter(Project.client_name == client_name).scalar()
    return count > 1


def _avg_order_value(db: Session) -> float:
    avg = db.query(func.avg(Project.order_value)).filter(Project.order_value.isnot(None)).scalar()
    return float(avg) if avg else 100000.0


def _uncovered_qty(db: Session, part: Part) -> int:
    """How many units still need to be ordered (not on any open PO)."""
    mat_proc = next((p for p in part.processes if p.process_name == "Material Received"), None)
    already_received = mat_proc.completed_qty if mat_proc else 0
    remaining = part.total_qty - already_received
    if remaining <= 0:
        return 0

    on_open_po = (
        db.query(func.coalesce(func.sum(PurchaseOrderLineAllocation.allocated_qty), 0))
        .join(PurchaseOrderLine, PurchaseOrderLineAllocation.po_line_id == PurchaseOrderLine.id)
        .join(PurchaseOrder, PurchaseOrderLine.purchase_order_id == PurchaseOrder.id)
        .filter(
            PurchaseOrderLineAllocation.part_id == part.id,
            PurchaseOrder.status.notin_(["cancelled", "received"])
        )
        .scalar()
    )
    return max(0, remaining - int(on_open_po))


def _available_stock(db: Session, material_name: str, size: int, joint_type: str) -> int:
    stock = db.query(WarehouseStock).filter_by(
        material_name=material_name, size=size, joint_type=joint_type
    ).first()
    if not stock:
        return 0
    return max(0, stock.qty_on_hand - stock.reserved_qty)


def _lead_time(db: Session, material_name: str) -> int:
    lt = db.query(MaterialLeadTime).filter_by(material_name=material_name).first()
    return lt.lead_time_days if lt else 5


def compute_priority_score(
    db: Session,
    project: Project,
    line: ProjectProductionLine,
    part: Part,
    avg_ov: float,
    is_repeat: bool,
) -> float:
    status = getattr(project, "status", "Active")
    if status and "hold" in status.lower():
        return -9999.0

    uncovered = _uncovered_qty(db, part)
    avail_stock = _available_stock(db, part.name, line.size, line.joint_type)
    still_needs = max(0, uncovered - avail_stock)
    if still_needs <= 0:
        return -9999.0

    priority = _get_effective_priority(project)
    tier = {"P1": 1000, "P2": 600, "P3": 300}.get(priority, 300)
    is_active = status == "Active"
    active_bonus = 200 if is_active else 0

    today = date.today()
    days_to_target = (project.target_date - today).days if project.target_date else 999
    dispatch_date = getattr(project, "committed_dispatch_date", None)
    days_to_dispatch = (dispatch_date - today).days if dispatch_date else None

    lt = _lead_time(db, part.name)
    order_by = (project.target_date - __import__("datetime").timedelta(days=lt)) if project.target_date else None
    days_overdue = max(0, (today - order_by).days) if order_by else 0

    # Production completion
    all_procs = part.processes
    fab_procs = [p for p in all_procs if p.process_name not in ("PO", "Material Received", "Inward Insp", "Ready")]
    if fab_procs:
        pct = sum(p.completed_qty for p in fab_procs) / (len(fab_procs) * (part.total_qty or 1))
    else:
        pct = 0.0

    # Remaining welding feet ratio
    total_feet = (line.tig_feet or 0) + (line.mig_feet or 0) + (line.grinding_feet or 0)  # ponytail: kept for future use
    # Approximate remaining via completion pct
    remaining_feet_ratio = 1.0 - min(pct, 1.0)

    order_value = getattr(project, "order_value", None) or 0.0
    value_factor = (order_value / avg_ov * 20) if avg_ov else 0

    total_joints = sum(ln.quantity for ln in project.production_lines) if project.production_lines else 1
    qty_factor = (1 / total_joints) * 100

    advance_pct = getattr(project, "advance_received", 0.0) or 0.0
    repeat_bonus = 50 if is_repeat else 0

    vendor_penalty = 0.0  # populated by caller if vendor known

    score = (
        tier
        + active_bonus
        + max(0, 30 - days_to_target) * 5
        + (max(0, 20 - days_to_dispatch) * 6 if days_to_dispatch is not None else 0)
        + days_overdue * 15
        + pct * 30
        + remaining_feet_ratio * 20
        + value_factor
        + qty_factor
        + advance_pct * 0.15
        + repeat_bonus
        + vendor_penalty
    )
    return score


def _bucket(days_to_order_by: int, priority: str) -> str:
    """Return RED/ORANGE/GREEN/NONE based on urgency."""
    if days_to_order_by <= 0:
        return "RED"
    if priority == "P1" and days_to_order_by <= 2:
        return "RED"
    if days_to_order_by <= 3:
        return "ORANGE"
    if priority == "P1" and days_to_order_by <= 5:
        return "ORANGE"
    if days_to_order_by <= 7:
        return "GREEN"
    return "NONE"


def get_morning_list(db: Session) -> list:
    """
    Returns list of dicts, each representing a part that needs procurement action.
    Sorted by priority_score DESC within each bucket.
    Only includes Active and Planning projects. Excludes held + fully covered.
    """
    projects = db.query(Project).filter(Project.status.in_(["Active", "Planning"])).all()
    avg_ov = _avg_order_value(db)
    today = date.today()
    items = []

    for project in projects:
        is_repeat = _is_repeat_client(db, project.client_name or "")
        for line in project.production_lines:
            for part in line.parts:
                mat_proc = next((p for p in part.processes if p.process_name == "Material Received"), None)
                if not mat_proc:
                    continue  # part has no material tracking step

                score = compute_priority_score(db, project, line, part, avg_ov, is_repeat)
                if score <= -9000:
                    continue  # killed by stock/hold

                priority = _get_effective_priority(project)
                lt = _lead_time(db, part.name)
                order_by = (project.target_date - __import__("datetime").timedelta(days=lt)) if project.target_date else None
                days_to_order_by = (order_by - today).days if order_by else 999
                days_overdue = max(0, -days_to_order_by)
                bucket = _bucket(days_to_order_by, priority)

                if bucket == "NONE":
                    continue

                uncovered = _uncovered_qty(db, part)
                avail = _available_stock(db, part.name, line.size, line.joint_type)
                still_needs = max(0, uncovered - avail)

                items.append({
                    "project_id": project.id,
                    "quotation_no": project.quotation_no,
                    "project_name": project.project_name,
                    "client_name": project.client_name,
                    "target_date": project.target_date.isoformat() if project.target_date else None,
                    "committed_dispatch_date": project.committed_dispatch_date.isoformat() if getattr(project, "committed_dispatch_date", None) else None,
                    "priority": priority,
                    "line_id": line.id,
                    "size": line.size,
                    "joint_type": line.joint_type,
                    "part_id": part.id,
                    "material_name": part.name,
                    "total_qty": part.total_qty,
                    "received_qty": mat_proc.completed_qty,
                    "still_needs_ordering": still_needs,
                    "available_from_stock": min(avail, uncovered),
                    "order_by_date": order_by.isoformat() if order_by else None,
                    "days_to_order_by": days_to_order_by,
                    "days_overdue": days_overdue,
                    "bucket": bucket,
                    "priority_score": round(score, 2),
                    "delay_reason": None,  # populated by caller if draft PO exists
                })

    items.sort(key=lambda x: x["priority_score"], reverse=True)
    return items
