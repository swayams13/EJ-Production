from datetime import date, timedelta
from sqlalchemy.orm import Session, subqueryload
from sqlalchemy import func

from backend.services.db_service import (
    Project, ProjectProductionLine, Part, PartProcess,
    PurchaseOrderLineAllocation, PurchaseOrderLine, PurchaseOrder,
    WarehouseStock, MaterialLeadTime, GoodsReceipt
)


def _get_effective_priority(project: Project) -> str:
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


def _bucket(days_to_order_by: int, priority: str) -> str:
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
    Returns parts needing procurement action, sorted by priority_score DESC.

    Old approach: 5+ DB queries per part (N+1 across projects × lines × parts).
    New approach: ~6 bulk queries up front, then pure dict lookups in the hot loop.
    Scales to 500+ projects without degradation.
    """
    # ── 1. Eager-load the full hierarchy in one pass ─────────────────────────
    projects = (
        db.query(Project)
        .filter(Project.status.in_(["Active", "Planning"]))
        .options(
            subqueryload(Project.production_lines)
            .subqueryload(ProjectProductionLine.parts)
            .subqueryload(Part.processes)
        )
        .all()
    )
    if not projects:
        return []

    # ── 2. Scalar lookups (each is one query) ────────────────────────────────
    avg_ov_raw = db.query(func.avg(Project.order_value)).filter(Project.order_value.isnot(None)).scalar()
    avg_ov = float(avg_ov_raw) if avg_ov_raw else 100_000.0

    # repeat-client set
    client_counts = db.query(Project.client_name, func.count(Project.id)).group_by(Project.client_name).all()
    repeat_clients = {name for name, cnt in client_counts if (cnt or 0) > 1}

    # lead times: material_name → days
    lead_time_map = {lt.material_name: lt.lead_time_days for lt in db.query(MaterialLeadTime).all()}

    # available warehouse stock: (material, size, joint_type) → available qty
    stock_map = {
        (s.material_name, s.size, s.joint_type): max(0, (s.qty_on_hand or 0) - (s.reserved_qty or 0))
        for s in db.query(WarehouseStock).all()
    }

    # open-PO allocated qty per part_id (single aggregate query)
    open_alloc_rows = (
        db.query(
            PurchaseOrderLineAllocation.part_id,
            func.sum(PurchaseOrderLineAllocation.allocated_qty),
        )
        .join(PurchaseOrderLine, PurchaseOrderLineAllocation.po_line_id == PurchaseOrderLine.id)
        .join(PurchaseOrder, PurchaseOrderLine.purchase_order_id == PurchaseOrder.id)
        .filter(PurchaseOrder.status.notin_(["cancelled", "received"]))
        .group_by(PurchaseOrderLineAllocation.part_id)
        .all()
    )
    open_po_qty_map = {pid: int(qty or 0) for pid, qty in open_alloc_rows}

    # most recent received-PO vendor per (material, size, joint_type)
    # ponytail: order ascending so the last row written wins (= highest PO id = most recent)
    vendor_by_mat: dict[tuple, int] = {}
    for mat, size, jt, vid, _ in (
        db.query(
            PurchaseOrderLine.material_name,
            PurchaseOrderLine.size,
            PurchaseOrderLine.joint_type,
            PurchaseOrder.vendor_id,
            PurchaseOrder.id,
        )
        .join(PurchaseOrder, PurchaseOrderLine.purchase_order_id == PurchaseOrder.id)
        .filter(PurchaseOrder.status == "received", PurchaseOrder.vendor_id.isnot(None))
        .order_by(PurchaseOrder.id)
        .all()
    ):
        vendor_by_mat[(mat, size, jt)] = vid

    # lazy-cache vendor lateness — at most 1 DB call per distinct vendor, not per part
    vendor_lateness_cache: dict[int, float] = {}

    def _vendor_penalty(mat: str, size: int, jt: str) -> float:
        vid = vendor_by_mat.get((mat, size, jt))
        if not vid:
            return 0.0
        if vid not in vendor_lateness_cache:
            vendor_lateness_cache[vid] = _vendor_avg_days_late(db, vid)
        return vendor_lateness_cache[vid] * -8

    # ── 3. Hot loop — no DB calls inside ────────────────────────────────────
    today = date.today()
    items = []

    for project in projects:
        status = getattr(project, "status", "Active") or ""
        if "hold" in status.lower():
            continue

        priority = _get_effective_priority(project)
        tier = {"P1": 1000, "P2": 600, "P3": 300}.get(priority, 300)
        active_bonus = 200 if status == "Active" else 0
        is_repeat = project.client_name in repeat_clients
        repeat_bonus = 50 if is_repeat else 0

        days_to_target = (project.target_date - today).days if project.target_date else 30
        dispatch_date = getattr(project, "committed_dispatch_date", None)
        days_to_dispatch = (dispatch_date - today).days if dispatch_date else None
        order_value = getattr(project, "order_value", None) or 0.0
        value_factor = (order_value / avg_ov * 20) if avg_ov else 0
        advance_pct = getattr(project, "advance_received", 0.0) or 0.0
        total_joints = sum(ln.quantity for ln in project.production_lines) if project.production_lines else 1
        qty_factor = (1 / total_joints) * 100

        for line in project.production_lines:
            for part in line.parts:
                mat_proc = next((p for p in part.processes if p.process_name == "Material Received"), None)
                if not mat_proc:
                    continue

                # uncovered qty (dict lookup, no DB)
                already_received = mat_proc.completed_qty or 0
                remaining = part.total_qty - already_received
                if remaining <= 0:
                    continue
                on_open_po = open_po_qty_map.get(part.id, 0)
                uncovered = max(0, remaining - on_open_po)

                avail_stock = stock_map.get((part.name, line.size, line.joint_type), 0)
                still_needs = max(0, uncovered - avail_stock)
                if still_needs <= 0:
                    continue

                lt = lead_time_map.get(part.name, 5)
                order_by = (project.target_date - timedelta(days=lt)) if project.target_date else None
                days_to_order_by = (order_by - today).days if order_by else 7
                bucket = _bucket(days_to_order_by, priority)
                if bucket == "NONE":
                    continue

                days_overdue = max(0, -days_to_order_by)
                fab_procs = [p for p in part.processes if p.process_name not in ("PO", "Material Received", "Inward Insp", "Ready")]
                pct = (
                    sum(p.completed_qty for p in fab_procs) / (len(fab_procs) * (part.total_qty or 1))
                    if fab_procs else 0.0
                )
                remaining_feet_ratio = 1.0 - min(pct, 1.0)
                vendor_penalty = _vendor_penalty(part.name, line.size, line.joint_type)

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
                    "received_qty": already_received,
                    "still_needs_ordering": still_needs,
                    "available_from_stock": min(avail_stock, uncovered),
                    "order_by_date": order_by.isoformat() if order_by else None,
                    "days_to_order_by": days_to_order_by,
                    "days_overdue": days_overdue,
                    "bucket": bucket,
                    "priority_score": round(score, 2),
                    "delay_reason": None,
                })

    items.sort(key=lambda x: x["priority_score"], reverse=True)
    return items
