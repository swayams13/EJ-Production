with open("backend/app/projects/router.py", "r") as f:
    content = f.read()
    
# We need to import ProjectHoldHistory
content = content.replace("from backend.services.db_service import get_db, Project, ProjectResourceAssignment, ProjectProductionLine, WorkforceMaster", "from backend.services.db_service import get_db, Project, ProjectResourceAssignment, ProjectProductionLine, WorkforceMaster, ProjectHoldHistory")

# Let's find update_project
# When status changes to "Hold", create ProjectHoldHistory
# When status changes from "Hold" to something else, find active hold and close it.

import re

update_project_logic = """
    if req.status:
        if req.status == "Hold" and proj.status != "Hold":
            hold = ProjectHoldHistory(
                project_id=project_id,
                hold_type=req.hold_type or "General Hold",
                comments=req.status_note,
                hold_date=datetime.utcnow()
            )
            db.add(hold)
            proj.hold_type = req.hold_type or "General Hold"
        elif req.status != "Hold" and proj.status == "Hold":
            active_hold = db.query(ProjectHoldHistory).filter(ProjectHoldHistory.project_id == project_id, ProjectHoldHistory.resume_date == None).first()
            if active_hold:
                active_hold.resume_date = datetime.utcnow()
            proj.hold_type = None
            proj.status_note = None
        proj.status = req.status
        
    if req.status_note is not None:
        proj.status_note = req.status_note
        if proj.status == "Hold":
            active_hold = db.query(ProjectHoldHistory).filter(ProjectHoldHistory.project_id == project_id, ProjectHoldHistory.resume_date == None).first()
            if active_hold:
                active_hold.comments = req.status_note
                
    if req.hold_type is not None:
        proj.hold_type = req.hold_type
        if proj.status == "Hold":
            active_hold = db.query(ProjectHoldHistory).filter(ProjectHoldHistory.project_id == project_id, ProjectHoldHistory.resume_date == None).first()
            if active_hold:
                active_hold.hold_type = req.hold_type
"""

pattern = r'    if req\.status:\n        proj\.status = req\.status\n        \n    if req\.status_note is not None:\n        proj\.status_note = req\.status_note'
content = re.sub(pattern, update_project_logic, content)

# Also in get_projects we need to return hold_type
# results.append({
# ... "hold_type": getattr(p, "hold_type", None)

content = content.replace('"hold_until_date": getattr(p, "hold_until_date", None),', '"hold_until_date": getattr(p, "hold_until_date", None),\n            "hold_type": getattr(p, "hold_type", None),')

# Add the /holds endpoint
holds_endpoint = """
@router.get("/holds")
def get_holds(db: Session = Depends(get_db)):
    active_holds = db.query(ProjectHoldHistory).filter(ProjectHoldHistory.resume_date == None).all()
    results = []
    for h in active_holds:
        proj = db.query(Project).filter(Project.id == h.project_id).first()
        days_on_hold = (datetime.utcnow() - h.hold_date).days
        results.append({
            "id": h.id,
            "project_id": h.project_id,
            "project_name": proj.project_name if proj else "Unknown",
            "quotation_no": proj.quotation_no if proj else "Unknown",
            "hold_type": h.hold_type,
            "comments": h.comments,
            "hold_date": h.hold_date,
            "days_on_hold": days_on_hold
        })
    return {"success": True, "message": "Holds retrieved", "data": results}

@router.post("")
"""
content = content.replace('@router.post("")', holds_endpoint)

with open("backend/app/projects/router.py", "w") as f:
    f.write(content)
