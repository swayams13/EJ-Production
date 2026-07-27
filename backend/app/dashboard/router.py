from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from typing import List, Optional
from sqlalchemy import func as sqlfunc
from sqlalchemy.orm import Session
from datetime import datetime
import io
import os

from backend.services.db_service import get_db, Project, ProjectProductionLine, MaterialHold, PurchaseOrder, PurchaseOrderLine, Part, PartProcess, WarehouseStock
from backend.services.notification_service import create_notification
from backend.services.production_service import get_company_capacity_status, generate_master_production_register_excel, aggregate_line_feet
from backend.app.auth.rbac import require_roles, SUPERVISORS, MANAGEMENT, EXECUTIVES

router = APIRouter(prefix="/api/v1/dashboard", tags=["Dashboard"])

@router.get("/status")
def dashboard_status(target_days: int = 15, current_user: dict = Depends(require_roles(SUPERVISORS))):
    status = get_company_capacity_status(target_days)
    return {"success": True, "message": "Status retrieved", "data": status}

@router.get("/export")
def export_dashboard(current_user: dict = Depends(require_roles(SUPERVISORS))):
    excel_bytes = generate_master_production_register_excel()
    if not excel_bytes:
        raise HTTPException(status_code=500, detail="Failed to generate excel")
    return StreamingResponse(
        io.BytesIO(excel_bytes),
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": "attachment; filename=Master_Production_Register.xlsx"}
    )

# Keyword -> shop mapping for MES part names (see backend/services/templates.py).
# Checked in order; first substring match wins. Anything unmatched falls back
# to "Fabrication Shop" (cutting/bending/forming/welding of raw sub-parts).
_PART_SHOP_KEYWORDS = [
    ("assembly", "Assembly Shop"),
    ("flange", "Machining Shop"),
    ("bellows", "Bellows Shop"),
    ("collar", "Bellows Shop"),
]


def _shop_for_part(part_name: str) -> str:
    name = (part_name or "").lower()
    for keyword, shop in _PART_SHOP_KEYWORDS:
        if keyword in name:
            return shop
    return "Fabrication Shop"


def _part_completion_pct(part, line_qty: int) -> float:
    if not part.processes or not line_qty:
        return 0.0
    total = sum(min(1.0, (proc.completed_qty or 0) / line_qty) for proc in part.processes)
    return total / len(part.processes)


def get_wip_dashboard(db: Session):
    from sqlalchemy.orm import selectinload
    from backend.services.db_service import Part

    active_projects = db.query(Project).filter(Project.status != "Completed").all()

    wip_data = {
        "Fabrication Shop": {"required": 0, "completed": 0},
        "Assembly Shop": {"required": 0, "completed": 0},
        "Bellows Shop": {"required": 0, "completed": 0},
        "Machining Shop": {"required": 0, "completed": 0}
    }

    for p in active_projects:
        lines = db.query(ProjectProductionLine).options(
            selectinload(ProjectProductionLine.parts).selectinload(Part.processes)
        ).filter_by(project_id=p.id).all()

        for line in lines:
            line_qty = line.quantity or 0
            if line_qty == 0:
                continue
            for part in line.parts:
                shop = _shop_for_part(part.name)
                required_units = line_qty * ((part.weight_percentage or 0.0) / 100.0)
                completed_units = required_units * _part_completion_pct(part, line_qty)
                wip_data[shop]["required"] += required_units
                wip_data[shop]["completed"] += completed_units

    for shop in wip_data:
        wip_data[shop]["required"] = round(wip_data[shop]["required"], 1)
        wip_data[shop]["completed"] = round(wip_data[shop]["completed"], 1)

    return wip_data

@router.get("/wip")
def get_wip_dashboard_api(db: Session = Depends(get_db), current_user: dict = Depends(require_roles(SUPERVISORS))):
    data = get_wip_dashboard(db)
    return {"success": True, "message": "WIP dashboard retrieved", "data": data}


def _current_stage_for_line(line) -> str:
    """Return the process_name of the first non-complete step across all parts."""
    for part in sorted(line.parts, key=lambda p: p.id):
        target = part.total_qty or line.quantity or 0
        if not target:
            continue
        for proc in sorted(part.processes, key=lambda pr: pr.id):
            if (proc.completed_qty or 0) < target:
                return proc.process_name
    return "Complete"


@router.get("/wip/lines")
def get_wip_lines(db: Session = Depends(get_db), current_user: dict = Depends(require_roles(SUPERVISORS))):
    from sqlalchemy.orm import selectinload
    from backend.services.db_service import Part

    active_projects = (
        db.query(Project)
        .filter(Project.status.in_(["Active", "Planning"]))
        .all()
    )
    rows = []
    for p in active_projects:
        lines = (
            db.query(ProjectProductionLine)
            .options(selectinload(ProjectProductionLine.parts).selectinload(Part.processes))
            .filter_by(project_id=p.id)
            .all()
        )
        for line in lines:
            rows.append({
                "project_name": p.project_name or p.quotation_no,
                "quotation_no": p.quotation_no,
                "line_type": line.joint_type,
                "size": line.size,
                "tag_no": getattr(line, "joint_type_code", None),
                "qty": line.quantity,
                "current_stage": _current_stage_for_line(line),
            })
    return {"success": True, "data": rows}


@router.get("/executive")
def executive_dashboard(
    db: Session = Depends(get_db),
    user=Depends(require_roles(EXECUTIVES + ["Developer"])),
):
    from backend.services.db_service import ProjectCompletionRequest
    from datetime import date as _date_today

    today = _date_today.today()
    projects = db.query(Project).all()

    total_active = sum(1 for p in projects if p.status == "Active")
    total_on_hold = sum(1 for p in projects if p.status == "Hold")
    total_completed = sum(1 for p in projects if p.status == "Completed")
    pipeline_value = sum((p.order_value or 0) for p in projects if p.status != "Completed")
    on_time = sum(
        1 for p in projects
        if p.status == "Active" and p.committed_dispatch_date and p.committed_dispatch_date >= today
    )
    delayed = sum(
        1 for p in projects
        if p.status == "Active" and p.committed_dispatch_date and p.committed_dispatch_date < today
    )

    project_rows = []
    for p in projects:
        line_ids = [l.id for l in db.query(ProjectProductionLine.id).filter_by(project_id=p.id).all()]
        part_ids = [pt.id for pt in db.query(Part.id).filter(Part.production_line_id.in_(line_ids)).all()] if line_ids else []
        processes = db.query(PartProcess).filter(PartProcess.part_id.in_(part_ids)).all() if part_ids else []

        if processes:
            total_qty_sum = 0
            completed_qty_sum = 0
            for pp in processes:
                part = db.query(Part).filter(Part.id == pp.part_id).first()
                if part and part.total_qty:
                    total_qty_sum += part.total_qty
                    completed_qty_sum += min(pp.completed_qty, part.total_qty)
            progress = round((completed_qty_sum / total_qty_sum * 100)) if total_qty_sum else 0
        else:
            progress = 100 if p.status == "Completed" else 0

        pending_req = db.query(ProjectCompletionRequest).filter_by(project_id=p.id, status="pending").first()

        project_rows.append({
            "id": p.id,
            "quotation_no": p.quotation_no,
            "project_name": p.project_name,
            "client_name": p.client_name,
            "status": p.status,
            "order_value": p.order_value,
            "advance_received": p.advance_received,
            "committed_dispatch_date": p.committed_dispatch_date.isoformat() if p.committed_dispatch_date else None,
            "target_date": p.target_date.isoformat() if p.target_date else None,
            "progress_pct": progress,
            "completion_request_status": "pending" if pending_req else None,
        })

    return {
        "kpis": {
            "total_active": total_active,
            "total_on_hold": total_on_hold,
            "total_completed": total_completed,
            "pipeline_value": pipeline_value,
            "on_time": on_time,
            "delayed": delayed,
        },
        "projects": project_rows,
    }

@router.get("/executive-briefing")
def executive_briefing(
    db: Session = Depends(get_db),
    user=Depends(require_roles(EXECUTIVES + ["Developer"])),
):
    from datetime import date as _date, timedelta
    from backend.services.db_service import (
        User, WeldingLog, WorkOrder, AuditLog, GoodsReceipt,
        ProjectHoldHistory, ProjectCompletionRequest,
    )
    from backend.services.briefing_service import (
        summarize_production, resolve_and_rank_activity, build_leaderboard, on_time_pct, resolve_role,
        summarize_material_risk,
    )

    today = _date.today()
    window_start = today - timedelta(days=14)
    # Management logins (GM/PM/CEO/MD/Developer) may be env-var-only, with no
    # `users` table row — resolve_role falls back to these when a DB User match fails.
    env_values = {k: os.getenv(k) for k in ("DEV_USER", "GM_USER", "PM_USER", "CEO_USER", "MD_USER")}

    # --- production feet: one 14-day query, yesterday/7d derived in Python ---
    feet_rows = (
        db.query(
            WeldingLog.date.label("date"),
            WeldingLog.process_type.label("process_type"),
            sqlfunc.sum(WeldingLog.feet_done).label("feet"),
            sqlfunc.count(WeldingLog.id).label("entries"),
        )
        .filter(WeldingLog.date >= window_start, WeldingLog.date <= today)
        .group_by(WeldingLog.date, WeldingLog.process_type)
        .all()
    )
    production = summarize_production(feet_rows, today)

    # --- today's allotted work ---
    today_wo_rows = (
        db.query(WorkOrder, Project.quotation_no, Project.project_name)
        .join(Project, Project.id == WorkOrder.project_id)
        .filter(WorkOrder.date == today)
        .all()
    )
    today_allotted = [
        {
            "project_id": wo.project_id,
            "quotation_no": quotation_no,
            "project_name": project_name,
            "process_type": wo.process_type,
            "target_feet": wo.target_feet,
            "actual_feet": wo.actual_feet or 0.0,
            "pct": round((wo.actual_feet or 0.0) / wo.target_feet * 100) if wo.target_feet else 0,
            "status": wo.status,
        }
        for wo, quotation_no, project_name in today_wo_rows
    ]

    # --- activity feed: union of 5 sources, normalized then ranked ---
    raw_events = []

    audit_rows = (
        db.query(AuditLog)
        .filter(AuditLog.timestamp >= window_start)
        .order_by(AuditLog.timestamp.desc())
        .limit(200)
        .all()
    )
    for a in audit_rows:
        raw_events.append({
            "timestamp": a.timestamp, "user_id": a.user_id, "username": a.username,
            "action": a.action, "detail": a.details, "project_ref": None,
        })

    po_rows = (
        db.query(PurchaseOrder)
        .filter(PurchaseOrder.raised_by_username.isnot(None), PurchaseOrder.created_at >= window_start)
        .all()
    )
    for po in po_rows:
        raw_events.append({
            "timestamp": po.created_at, "user_id": po.raised_by, "username": po.raised_by_username,
            "action": "PO raised", "detail": f"Raised PO {po.po_number}", "project_ref": None,
        })

    gr_rows = (
        db.query(GoodsReceipt)
        .filter(GoodsReceipt.received_by_username.isnot(None), GoodsReceipt.created_at >= window_start)
        .all()
    )
    for gr in gr_rows:
        raw_events.append({
            "timestamp": gr.created_at, "user_id": gr.received_by, "username": gr.received_by_username,
            "action": "Goods receipt recorded", "detail": f"Recorded receipt for PO #{gr.purchase_order_id}", "project_ref": None,
        })

    completion_rows = (
        db.query(ProjectCompletionRequest, Project.quotation_no)
        .join(Project, Project.id == ProjectCompletionRequest.project_id)
        .filter(ProjectCompletionRequest.requested_at >= window_start)
        .all()
    )
    for req, quotation_no in completion_rows:
        raw_events.append({
            "timestamp": req.requested_at, "user_id": None, "username": req.requested_by,
            "action": "Completion requested", "detail": f"Submitted completion for {quotation_no}", "project_ref": quotation_no,
        })
        if req.reviewed_at and req.reviewed_by:
            detail = f"{req.status.capitalize()} completion for {quotation_no}"
            if req.rejection_reason:
                detail += f" — {req.rejection_reason}"
            raw_events.append({
                "timestamp": req.reviewed_at, "user_id": None, "username": req.reviewed_by,
                "action": f"Completion {req.status}", "detail": detail, "project_ref": quotation_no,
            })

    # "Project created" events arrive via the audit_rows query above — create_project
    # writes an AuditLog row (action="Create", table_name="projects") alongside
    # Project.created_by, so the feed works even for env-var-only creators.

    event_user_ids = {e["user_id"] for e in raw_events if e.get("user_id")}
    event_usernames = {e["username"] for e in raw_events if e.get("username")}
    users_by_id = {u.id: u for u in db.query(User).filter(User.id.in_(event_user_ids)).all()} if event_user_ids else {}
    users_by_username = {u.username: u for u in db.query(User).filter(User.username.in_(event_usernames)).all()} if event_usernames else {}

    activity = resolve_and_rank_activity(raw_events, users_by_id, users_by_username, limit=50, env_values=env_values)

    # --- leaderboard: AuditLog entry counts per user ---
    yesterday = today - timedelta(days=1)
    week_start = today - timedelta(days=7)
    y_counts = dict(
        db.query(AuditLog.user_id, sqlfunc.count(AuditLog.id))
        .filter(sqlfunc.date(AuditLog.timestamp) == yesterday, AuditLog.user_id.isnot(None))
        .group_by(AuditLog.user_id).all()
    )
    w_counts = dict(
        db.query(AuditLog.user_id, sqlfunc.count(AuditLog.id))
        .filter(sqlfunc.date(AuditLog.timestamp) >= week_start, sqlfunc.date(AuditLog.timestamp) < today, AuditLog.user_id.isnot(None))
        .group_by(AuditLog.user_id).all()
    )
    leaderboard_ids = set(y_counts) | set(w_counts)
    leaderboard_users = {u.id: u for u in db.query(User).filter(User.id.in_(leaderboard_ids)).all()} if leaderboard_ids else {}
    leaderboard = build_leaderboard(y_counts, w_counts, leaderboard_users)

    # --- by_role rollups ---
    all_projects = db.query(Project).all()
    company_on_time_pct = on_time_pct(all_projects, today)

    # ProjectCompletionRequest submission/review is already RBAC-gated to a single role
    # each (submit: Production Manager/Developer; approve/reject: GM/Developer — see
    # backend/app/projects/completion.py), so no extra role join/lookup is needed here.
    pm_completions = db.query(ProjectCompletionRequest).count()
    gm_approved = db.query(ProjectCompletionRequest).filter(ProjectCompletionRequest.status == "approved").count()
    gm_rejected = db.query(ProjectCompletionRequest).filter(ProjectCompletionRequest.status == "rejected").count()

    # PO/GR raising IS open to all of MANAGEMENT (not PM-exclusive), so these do need
    # real role resolution, with the env-var fallback for management logins with no
    # `users` row.
    po_rows_all = db.query(PurchaseOrder).filter(PurchaseOrder.raised_by_username.isnot(None)).all()
    gr_rows_all = db.query(GoodsReceipt).filter(GoodsReceipt.received_by_username.isnot(None)).all()
    pm_related_usernames = {po.raised_by_username for po in po_rows_all} | {gr.received_by_username for gr in gr_rows_all}
    pm_related_users = {u.username: u for u in db.query(User).filter(User.username.in_(pm_related_usernames)).all()} if pm_related_usernames else {}

    def _role_for(username):
        u = pm_related_users.get(username)
        return resolve_role(username, u.role if u else None, env_values)

    pm_pos = sum(1 for po in po_rows_all if _role_for(po.raised_by_username) == "Production Manager")
    pm_grs = sum(1 for gr in gr_rows_all if _role_for(gr.received_by_username) == "Production Manager")
    holds_total = db.query(ProjectHoldHistory).count()
    resumes_total = db.query(ProjectHoldHistory).filter(ProjectHoldHistory.resume_date.isnot(None)).count()

    materials = summarize_material_risk(_compute_material_rows(db))

    return {
        "production": production,
        "today_allotted": today_allotted,
        "activity": activity,
        "materials": materials,
        "people": {
            "leaderboard": leaderboard,
            "by_role": {
                "pm": {
                    "pos_raised": pm_pos,
                    "goods_receipts": pm_grs,
                    "completion_requests_submitted": pm_completions,
                    "projects_on_time_pct": company_on_time_pct,
                },
                "gm": {
                    "completions_approved": gm_approved,
                    "completions_rejected": gm_rejected,
                    "holds_total": holds_total,
                    "resumes_total": resumes_total,
                    "projects_on_time_pct": company_on_time_pct,
                },
            },
        },
    }

@router.get("/planning")
def get_planning_dashboard(db: Session = Depends(get_db), current_user: dict = Depends(require_roles(SUPERVISORS))):
    from backend.services.mes_service import MESService
    from backend.services.db_service import User
    from datetime import date
    
    # 1. Capacity Calculation
    operators = db.query(User).filter(User.role == "Operator").all()
    daily_capacity = sum(op.base_productivity or 50.0 for op in operators)
    weekly_capacity = daily_capacity * 6 # Assume 6 day work week
    monthly_capacity = daily_capacity * 26 # Assume 26 working days in a month
    
    from datetime import date, timedelta
    today = date.today()
    monday = today - timedelta(days=today.weekday())
    
    weekly_buckets = []
    for i in range(4):
        start_date = monday + timedelta(days=i*7)
        end_date = start_date + timedelta(days=5)
        name = f"{start_date.strftime('%d/%m/%Y')} to {end_date.strftime('%d/%m/%Y')}"
        weekly_buckets.append({"id": i, "name": name, "capacity": weekly_capacity, "demand": 0})
        
    monthly_buckets = [{"id": i, "name": f"Month {i+1}", "capacity": monthly_capacity, "demand": 0} for i in range(3)]
    unscheduled_demand = 0
    
    # 2. Demand Calculation
    active_projects = db.query(Project).filter(Project.status != "Completed").all()
    total_target = 0
    today = date.today()
    late_projects = 0

    # Bulk-fetch all active holds — avoids N+1 per project
    all_active_holds = db.query(MaterialHold).filter_by(status="active").all()
    holds_by_project: dict = {}
    for h in all_active_holds:
        holds_by_project.setdefault(h.project_id, []).append(h)

    pacing_metrics = []

    for p in active_projects:
        # Top level metrics
        for line in p.production_lines:
            total_target += line.quantity
            
        if p.target_date and p.target_date < today:
            late_projects += 1
            
        # Forecasting metrics
        total_tig, total_mig, total_grind = aggregate_line_feet(p.production_lines)

        total_feet = total_tig + total_mig + total_grind
        progress_pct = MESService.calculate_project_progress(db, p.id)
        remaining_feet = total_feet * (1 - (progress_pct / 100))
        
        days_to_deadline = (p.target_date - today).days if p.target_date else None
        project_monthly = [0.0, 0.0, 0.0]

        if p.target_date:
            days_away = days_to_deadline
            if days_away < 0:
                weekly_buckets[0]["demand"] += remaining_feet
                monthly_buckets[0]["demand"] += remaining_feet
                project_monthly[0] += remaining_feet
            else:
                week_idx = days_away // 7
                if week_idx > 3:
                    week_idx = 3

                available_weeks = week_idx + 1
                weekly_portion = remaining_feet / available_weeks
                for i in range(available_weeks):
                    if i < 4:
                        weekly_buckets[i]["demand"] += weekly_portion

                month_idx = days_away // 30
                if month_idx > 2:
                    month_idx = 2

                available_months = month_idx + 1
                monthly_portion = remaining_feet / available_months
                for i in range(available_months):
                    if i < 3:
                        monthly_buckets[i]["demand"] += monthly_portion
                        project_monthly[i] += monthly_portion
        else:
            unscheduled_demand += remaining_feet
            
        # Pacing Engine Logic
        from backend.services.db_service import ProjectResourceAssignment
        assignment = db.query(ProjectResourceAssignment).filter(ProjectResourceAssignment.project_id == p.id).first()
        target_days = assignment.target_days if assignment and assignment.target_days else 15
        
        base_daily_target = total_feet / target_days if target_days > 0 else 0
        
        if p.created_at:
            import datetime
            if isinstance(p.created_at, str):
                created_date = datetime.datetime.strptime(p.created_at.split()[0], '%Y-%m-%d').date()
            else:
                created_date = p.created_at.date()
            days_elapsed = (today - created_date).days
        else:
            days_elapsed = 0
            
        if days_elapsed < 0:
            days_elapsed = 0
            
        expected_completed = min(total_feet, base_daily_target * days_elapsed)
        actual_completed = total_feet * (progress_pct / 100)
        
        backlog = max(0, expected_completed - actual_completed)
        today_requirement = base_daily_target + backlog
        
        tig_req = today_requirement * (total_tig / total_feet) if total_feet > 0 else 0
        mig_req = today_requirement * (total_mig / total_feet) if total_feet > 0 else 0
        grind_req = today_requirement * (total_grind / total_feet) if total_feet > 0 else 0

        from backend.services.db_service import WeldingLog
        today_logged_ft = (
            db.query(sqlfunc.sum(WeldingLog.feet_done))
            .join(ProjectProductionLine, WeldingLog.production_line_id == ProjectProductionLine.id)
            .filter(ProjectProductionLine.project_id == p.id)
            .filter(WeldingLog.date == today)
            .scalar()
        ) or 0.0

        # Material blocks for this project
        project_holds = holds_by_project.get(p.id, [])
        blocks_map: dict = {}
        for h in project_holds:
            key = (h.material_name, h.size, h.joint_type)
            blocks_map.setdefault(key, 0)
            blocks_map[key] += 1

        material_blocks = []
        for (mat, sz, jt), count in blocks_map.items():
            # ponytail: one query per unique material spec — acceptable given holds are rare
            po = (
                db.query(PurchaseOrder)
                .join(PurchaseOrderLine, PurchaseOrderLine.purchase_order_id == PurchaseOrder.id)
                .filter(
                    PurchaseOrderLine.material_name == mat,
                    PurchaseOrderLine.size == sz,
                    PurchaseOrderLine.joint_type == jt,
                    PurchaseOrder.status.in_(["raised", "sent", "partially_received"]),
                )
                .order_by(PurchaseOrder.expected_delivery_date.asc())
                .first()
            )
            material_blocks.append({
                "material_name": mat,
                "size": sz,
                "joint_type": jt,
                "parts_blocked": count,
                "earliest_po_eta": po.expected_delivery_date.isoformat() if po and po.expected_delivery_date else None,
                "po_number": po.po_number if po else None,
            })

        pacing_metrics.append({
            "project_id": p.id,
            "project_number": p.quotation_no,
            "project_name": p.project_name or p.quotation_no,
            "total_feet": round(total_feet, 1),
            "remaining_feet": round(total_feet - actual_completed, 1),
            "days_to_deadline": days_to_deadline,
            "base_daily_target": round(base_daily_target, 1),
            "days_elapsed": days_elapsed,
            "expected_completed": round(expected_completed, 1),
            "actual_completed": round(actual_completed, 1),
            "backlog": round(backlog, 1),
            "today_requirement": round(today_requirement, 1),
            "today_logged_ft": round(today_logged_ft, 1),
            "gap_today": round(today_requirement - today_logged_ft, 1),
            "tig_req": round(tig_req, 1),
            "mig_req": round(mig_req, 1),
            "grind_req": round(grind_req, 1),
            "monthly_feet": [round(x, 1) for x in project_monthly],
            "material_blocks": material_blocks,
        })
            
    # Clean up floats
    for b in weekly_buckets:
        b["demand"] = round(b["demand"], 1)
    for b in monthly_buckets:
        b["demand"] = round(b["demand"], 1)
        
    unscheduled_demand = round(unscheduled_demand, 1)
            
    total_progress = 0
    if active_projects:
        total_progress = sum([MESService.calculate_project_progress(db, p.id) for p in active_projects]) / len(active_projects)
        
    current_load = round(100 - total_progress, 1) if active_projects else 0

    total_projects = len(active_projects)
    on_time = 100
    if total_projects > 0:
        on_time = round(((total_projects - late_projects) / total_projects) * 100, 1)

    result = {
        "weekly_target": total_target,
        "current_load": current_load,
        "on_time_delivery": on_time,
        "weekly_forecast": weekly_buckets,
        "monthly_forecast": monthly_buckets,
        "unscheduled_demand": unscheduled_demand,
        "factory_weekly_capacity": weekly_capacity,
        "pacing_metrics": pacing_metrics
    }
    return {"success": True, "message": "Planning dashboard retrieved", "data": result}


# ---------------------------------------------------------------------------
# Material Intelligence Dashboard
# ---------------------------------------------------------------------------

class MaterialProjectItem(BaseModel):
    id: int
    name: str
    qty_needed: int
    delivery_date: Optional[str]


class MaterialRow(BaseModel):
    material_name: str
    size: Optional[int]
    joint_type: Optional[str]
    qty_on_hand: int
    reserved_qty: int
    minimum_stock: int
    incoming_qty: int
    expected_delivery_date: Optional[str]
    total_demand: int
    net_gap: int
    status: str
    projects: List[MaterialProjectItem]


def _compute_material_rows(db: Session) -> List[MaterialRow]:
    # Pre-fetch A: all warehouse stock rows
    stock_rows = db.query(WarehouseStock).all()
    stock_map: dict = {(r.material_name, r.size, r.joint_type): r for r in stock_rows}

    # Pre-fetch B: open PO lines (status not received/cancelled)
    open_lines = (
        db.query(PurchaseOrderLine, PurchaseOrder.expected_delivery_date)
        .join(PurchaseOrder, PurchaseOrderLine.purchase_order_id == PurchaseOrder.id)
        .filter(PurchaseOrder.status.notin_(["received", "cancelled"]))
        .all()
    )
    # {spec -> {incoming_qty, expected_delivery_date}}
    po_map: dict = {}
    for line, po_edd in open_lines:
        remaining = (line.ordered_qty or 0) - (line.received_qty or 0)
        if remaining <= 0:
            continue
        key = (line.material_name, line.size, line.joint_type)
        if key not in po_map:
            po_map[key] = {"incoming_qty": 0, "expected_delivery_date": None}
        po_map[key]["incoming_qty"] += remaining
        if po_edd is not None:
            cur = po_map[key]["expected_delivery_date"]
            if cur is None or po_edd < cur:
                po_map[key]["expected_delivery_date"] = po_edd

    # Pre-fetch C: parts from active projects, with their processes and parent line/project
    # Single query: Part JOIN ProjectProductionLine JOIN Project + all PartProcesses bulk-loaded
    from sqlalchemy.orm import selectinload

    active_project_ids = [
        row[0]
        for row in db.query(Project.id).filter(Project.status != "Completed").all()
    ]

    if active_project_ids:
        parts_with_line = (
            db.query(Part, ProjectProductionLine, Project)
            .join(ProjectProductionLine, Part.production_line_id == ProjectProductionLine.id)
            .join(Project, ProjectProductionLine.project_id == Project.id)
            .filter(Project.id.in_(active_project_ids))
            .all()
        )

        # Bulk-fetch all PartProcess rows for these parts in one query
        part_ids = [p.id for p, _, _ in parts_with_line]
        all_processes = db.query(PartProcess).filter(PartProcess.part_id.in_(part_ids)).all()
        procs_by_part: dict = {}
        for proc in all_processes:
            procs_by_part.setdefault(proc.part_id, []).append(proc)
    else:
        parts_with_line = []
        procs_by_part = {}

    # {spec -> {total_demand, projects: [{id, name, qty_needed, delivery_date}]}}
    demand_map: dict = {}
    for part, line, project in parts_with_line:
        processes = procs_by_part.get(part.id, [])
        mr_proc = next((p for p in processes if p.process_name == "Material Received"), None)
        unmet_qty = (part.total_qty or 0) - (mr_proc.completed_qty if mr_proc else 0)
        if unmet_qty <= 0:
            continue
        key = (part.name, line.size, line.joint_type)
        if key not in demand_map:
            demand_map[key] = {"total_demand": 0, "projects": []}
        demand_map[key]["total_demand"] += unmet_qty
        demand_map[key]["projects"].append({
            "id": project.id,
            "name": project.project_name or project.quotation_no,
            "qty_needed": unmet_qty,
            "delivery_date": project.target_date.isoformat() if project.target_date else None,
        })

    # Union all specs and compute coverage
    all_specs = set(stock_map) | set(po_map) | set(demand_map)

    rows: List[MaterialRow] = []
    for spec in all_specs:
        material_name, size, joint_type = spec
        stock = stock_map.get(spec)
        qty_on_hand = stock.qty_on_hand if stock else 0
        reserved_qty = stock.reserved_qty if stock else 0
        minimum_stock = stock.minimum_stock if stock else 0

        po_entry = po_map.get(spec, {})
        incoming_qty = po_entry.get("incoming_qty", 0)
        edd = po_entry.get("expected_delivery_date")

        dem_entry = demand_map.get(spec, {})
        total_demand = dem_entry.get("total_demand", 0)
        projects_raw = dem_entry.get("projects", [])

        # Only include specs that have some demand (specs with only stock/PO but no demand are noise)
        if total_demand == 0:
            continue

        available_stock = qty_on_hand - reserved_qty
        net_gap = total_demand - available_stock - incoming_qty

        if net_gap > 0:
            status = "red"
        elif available_stock < minimum_stock:
            status = "amber"
        else:
            status = "green"

        # Sort projects by delivery_date ascending (None last)
        projects_sorted = sorted(
            projects_raw,
            key=lambda p: (p["delivery_date"] is None, p["delivery_date"] or ""),
        )

        rows.append(MaterialRow(
            material_name=material_name,
            size=size,
            joint_type=joint_type,
            qty_on_hand=qty_on_hand,
            reserved_qty=reserved_qty,
            minimum_stock=minimum_stock,
            incoming_qty=incoming_qty,
            expected_delivery_date=edd.isoformat() if edd else None,
            total_demand=total_demand,
            net_gap=net_gap,
            status=status,
            projects=[MaterialProjectItem(**p) for p in projects_sorted],
        ))

    # Sort: red (highest net_gap first) → amber → green
    _order = {"red": 0, "amber": 1, "green": 2}
    rows.sort(key=lambda r: (_order[r.status], -r.net_gap))

    return rows


@router.get("/materials", response_model=List[MaterialRow])
def get_materials_dashboard(
    db: Session = Depends(get_db),
    current_user: dict = Depends(require_roles(SUPERVISORS)),
):
    rows = _compute_material_rows(db)

    from datetime import timedelta
    from backend.services.db_service import Notification as NotifModel
    red_specs = [r for r in rows if r.status == "red"]
    if red_specs:
        cutoff = datetime.utcnow() - timedelta(hours=24)
        for spec in red_specs[:5]:
            spec_key = f"{spec.material_name}/{spec.size}/{spec.joint_type}"
            already = (
                db.query(NotifModel)
                .filter(
                    NotifModel.event_type == "material_red",
                    NotifModel.body.like(f"%{spec_key}%"),
                    NotifModel.created_at > cutoff,
                )
                .first()
            )
            if not already:
                for role in ["GM", "Production Manager"]:
                    create_notification(
                        db, role, "material_red",
                        f"Material shortage: {spec.material_name} {spec.size}",
                        f"Stock gap for {spec_key}. Net gap: {spec.net_gap} units.",
                        "/dashboard/materials",
                    )

    return rows
