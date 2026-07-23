from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from sqlalchemy import func as sqlfunc
from sqlalchemy.orm import Session
from datetime import datetime
import io

from backend.services.db_service import get_db, Project, ProjectProductionLine, MaterialHold, PurchaseOrder, PurchaseOrderLine
from backend.services.production_service import get_company_capacity_status, generate_master_production_register_excel, aggregate_line_feet
from backend.app.auth.rbac import require_roles, SUPERVISORS

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
def get_executive_dashboard(db: Session = Depends(get_db), current_user: dict = Depends(require_roles(SUPERVISORS))):
    total_active = db.query(Project).filter(Project.status == "Active").count()
    total_hold = db.query(Project).filter(Project.status == "Hold").count()
    total_completed = db.query(Project).filter(Project.status == "Completed").count()
    
    active_projects = db.query(Project).filter(Project.status != "Completed").all()
    avg_progress = 0
    if active_projects:
        from backend.services.mes_service import MESService
        total_p = sum([MESService.calculate_project_progress(db, p.id) for p in active_projects])
        avg_progress = round(total_p / len(active_projects), 1)
        
    wip = get_wip_dashboard(db)
    dept_loads = []
    colors = ["orange", "emerald", "blue", "purple"]
    for i, shop in enumerate(["Fabrication Shop", "Assembly Shop", "Bellows Shop", "Machining Shop"]):
        data = wip.get(shop, {"required": 0, "completed": 0})
        load = 0
        if data["required"] > 0:
            load = round(((data["required"] - data["completed"]) / data["required"]) * 100)
        dept_loads.append({"name": shop, "load": load, "color": colors[i]})
    
    result = {
        "kpis": [
            {"label": "Active Projects", "value": str(total_active), "trend": "Ongoing jobs", "color": "blue"},
            {"label": "Projects at Hold", "value": str(total_hold), "trend": "Pending clarification", "color": "rose"},
            {"label": "Avg Progress", "value": f"{avg_progress}%", "trend": "Overall completion", "color": "emerald"},
            {"label": "Completed", "value": str(total_completed), "trend": "All time", "color": "amber"}
        ],
        "departments": dept_loads
    }
    return {"success": True, "message": "Executive dashboard retrieved", "data": result}

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
