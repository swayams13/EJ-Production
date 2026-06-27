with open("backend/app/projects/router.py", "r") as f:
    content = f.read()

import re

# We want to replace the whole get_projects function.
# It starts at def get_projects and ends before @router.post("")

pattern = r'def get_projects.*?return \{"success": True, "message": "Projects retrieved", "data": results\}'

new_func = """def get_projects(db: Session = Depends(get_db)):
    projects = db.query(Project).all()
    results = []
    from backend.services.mes_service import MESService
    from datetime import date
    
    for p in projects:
        assign = db.query(ProjectResourceAssignment).filter_by(project_id=p.id).first()
        lines = db.query(ProjectProductionLine).filter_by(project_id=p.id).all()
        
        bellows = [{
            "size": l.size,
            "quantity": l.quantity,
            "tig_feet": round(l.tig_feet, 2) if l.tig_feet else 0,
            "mig_feet": round(l.mig_feet, 2) if l.mig_feet else 0,
            "grinding_feet": round(l.grinding_feet, 2) if l.grinding_feet else 0
        } for l in lines]
        
        progress = MESService.calculate_project_progress(db, p.id)
        
        target_date = p.target_date if getattr(p, "target_date", None) else (assign.target_date if assign else None)
        
        priority = "P3"
        if target_date:
            today_date = date.today()
            t_date = target_date.date() if isinstance(target_date, datetime) else target_date
            days_away = (t_date - today_date).days
            if days_away <= 21:
                priority = "P1"
            elif days_away <= 60:
                priority = "P2"
                
        results.append({
            "id": p.id,
            "quotation_no": p.quotation_no,
            "project_name": p.project_name,
            "status": getattr(p, "status", "Active"),
            "status_note": getattr(p, "status_note", None),
            "hold_until_date": getattr(p, "hold_until_date", None),
            "target_date": target_date,
            "priority": priority,
            "estimated_duration_days": assign.estimated_duration_days if assign else 0,
            "assigned_tig": assign.assigned_tig_welders if assign else 0,
            "assigned_mig": assign.assigned_mig_welders if assign else 0,
            "assigned_grinders": assign.assigned_grinders if assign else 0,
            "bellows": bellows,
            "progress_percentage": round(progress, 2)
        })
    return {"success": True, "message": "Projects retrieved", "data": results}"""

content = re.sub(pattern, new_func, content, flags=re.DOTALL)

with open("backend/app/projects/router.py", "w") as f:
    f.write(content)
