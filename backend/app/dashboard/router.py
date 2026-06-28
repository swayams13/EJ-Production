from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session
from datetime import datetime
import io

from backend.services.db_service import get_db, Project, ProjectProductionLine
from backend.services.production_service import get_company_capacity_status, generate_master_production_register_excel

router = APIRouter(prefix="/api/v1/dashboard", tags=["Dashboard"])

@router.get("/status")
def dashboard_status(target_days: int = 15):
    status = get_company_capacity_status(target_days)
    return {"success": True, "message": "Status retrieved", "data": status}

@router.get("/export")
def export_dashboard():
    excel_bytes = generate_master_production_register_excel()
    if not excel_bytes:
        raise HTTPException(status_code=500, detail="Failed to generate excel")
    return StreamingResponse(
        io.BytesIO(excel_bytes),
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": "attachment; filename=Master_Production_Register.xlsx"}
    )

def get_wip_dashboard(db: Session):
    from backend.services.mes_service import MESService
    active_projects = db.query(Project).filter(Project.status != "Completed").all()
    
    wip_data = {
        "Fabrication Shop": {"required": 0, "completed": 0},
        "Assembly Shop": {"required": 0, "completed": 0},
        "Bellows Shop": {"required": 0, "completed": 0},
        "Machining Shop": {"required": 0, "completed": 0}
    }
    
    for p in active_projects:
        lines = db.query(ProjectProductionLine).filter_by(project_id=p.id).all()
        for line in lines:
            wip_data["Bellows Shop"]["required"] += line.quantity
            
        progress = MESService.calculate_project_progress(db, p.id)
        if progress > 0:
            for line in lines:
                wip_data["Bellows Shop"]["completed"] += (line.quantity * (progress / 100))
                
    for shop in wip_data:
        wip_data[shop]["required"] = round(wip_data[shop]["required"], 1)
        wip_data[shop]["completed"] = round(wip_data[shop]["completed"], 1)
        
    return wip_data

@router.get("/wip")
def get_wip_dashboard_api(db: Session = Depends(get_db)):
    data = get_wip_dashboard(db)
    return {"success": True, "message": "WIP dashboard retrieved", "data": data}

@router.get("/executive")
def get_executive_dashboard(db: Session = Depends(get_db)):
    total_active = db.query(Project).filter(Project.status == "Active").count()
    total_hold = db.query(Project).filter(Project.status == "On Hold").count()
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
def get_planning_dashboard(db: Session = Depends(get_db)):
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
    
    pacing_metrics = []
    
    for p in active_projects:
        # Top level metrics
        for line in p.production_lines:
            total_target += line.quantity
            
        if p.target_date and p.target_date < today:
            late_projects += 1
            
        # Forecasting metrics
        total_feet = sum((line.tig_feet or 0) + (line.mig_feet or 0) + (line.grinding_feet or 0) for line in p.production_lines)
        progress_pct = MESService.calculate_project_progress(db, p.id)
        remaining_feet = total_feet * (1 - (progress_pct / 100))
        
        if p.target_date:
            days_away = (p.target_date - today).days
            if days_away < 0:
                weekly_buckets[0]["demand"] += remaining_feet
                monthly_buckets[0]["demand"] += remaining_feet
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
        
        pacing_metrics.append({
            "project_id": p.id,
            "project_number": p.quotation_no,
            "total_feet": round(total_feet, 1),
            "base_daily_target": round(base_daily_target, 1),
            "days_elapsed": days_elapsed,
            "expected_completed": round(expected_completed, 1),
            "actual_completed": round(actual_completed, 1),
            "backlog": round(backlog, 1),
            "today_requirement": round(today_requirement, 1)
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
