from fastapi import APIRouter, Depends, HTTPException, UploadFile, File
from sqlalchemy.orm import Session
from backend.services.production_service import (
    get_welding_master_latest,
    import_welding_master_from_disk,
    import_dismantling_joint_master,
    import_welding_master_from_upload,
    import_dismantling_joint_master_from_upload,
)
from backend.services.db_service import get_db
from backend.app.master.schemas import WorkforceUpdate, PoolUpdate, WeldingSizeCreate
from backend.app.auth.rbac import require_roles, SUPERVISORS, MANAGEMENT

router = APIRouter(prefix="/api/v1/master", tags=["Master"])

ALLOWED_MASTER_EXTENSIONS = (".xlsx", ".xls")


def _read_upload_or_400(file: UploadFile):
    if not file.filename.lower().endswith(ALLOWED_MASTER_EXTENSIONS):
        raise HTTPException(status_code=400, detail="Only .xlsx/.xls files are accepted")
    return file.file.read()

@router.get("/joint-types")
def get_joint_types(current_user: dict = Depends(require_roles(SUPERVISORS))):
    from backend.services import joint_catalog
    return {"success": True, "message": "Joint types retrieved", "data": joint_catalog.list_catalog()}

@router.get("/welding")
def get_welding_master_api(current_user: dict = Depends(require_roles(SUPERVISORS))):
    data = get_welding_master_latest()
    formatted_data = [{"size": d.size, "type": getattr(d, 'joint_type', 'EJ'), "tig_feet": round(d.tig_feet, 2) if d.tig_feet else 0, "mig_feet": round(d.mig_feet, 2) if d.mig_feet else 0, "grinding_feet": round(d.grinding_feet, 2) if d.grinding_feet else 0} for d in data]
    return {"success": True, "message": "Welding master retrieved", "data": formatted_data}

@router.post("/welding-size")
def create_custom_welding_size(req: WeldingSizeCreate, db = Depends(get_db), current_user: dict = Depends(require_roles(MANAGEMENT))):
    from backend.services.db_service import WeldingMaster
    
    latest = db.query(WeldingMaster).filter(
        WeldingMaster.joint_type == req.joint_type
    ).order_by(WeldingMaster.version.desc()).first()
    
    v = latest.version if latest else 1
    
    wm = WeldingMaster(
        size=req.size,
        tig_inches=0.0,
        tig_feet=req.tig_feet,
        mig_inches=0.0,
        mig_feet=req.mig_feet,
        total_welding_inches=0.0,
        total_welding_feet=req.tig_feet + req.mig_feet,
        grinding_feet=req.grinding_feet,
        joint_type=req.joint_type,
        version=v
    )
    db.add(wm)
    db.commit()
    db.refresh(wm)
    
    return {
        "success": True, 
        "message": f"Custom {req.joint_type} size added", 
        "data": {
            "size": wm.size,
            "type": wm.joint_type,
            "tig_feet": wm.tig_feet,
            "mig_feet": wm.mig_feet,
            "grinding_feet": wm.grinding_feet
        }
    }

def auto_sync_all_projects_with_master():
    from backend.services.db_service import SessionLocal, ProjectProductionLine, Project, ProjectResourceAssignment
    from backend.services.production_service import get_weld_master_lookup, resolve_master_row, calculate_required_resources_for_deadline, compute_master_feet
    from datetime import date

    db = SessionLocal()
    try:
        master_data = get_weld_master_lookup()

        lines = db.query(ProjectProductionLine).all()
        for line in lines:
            size = line.size
            qty = line.quantity
            j_type = getattr(line, 'joint_type', 'EJ')
            tag = getattr(line, 'joint_type_code', None)

            m = resolve_master_row(master_data, tag, j_type, size)

            if m:
                new_tig, new_mig, new_grind = compute_master_feet(m, j_type, qty)
                if line.tig_feet != new_tig or line.mig_feet != new_mig or line.grinding_feet != new_grind:
                    line.tig_feet = new_tig
                    line.mig_feet = new_mig
                    line.grinding_feet = new_grind

        projects = db.query(Project).all()
        for p in projects:
            assign = db.query(ProjectResourceAssignment).filter_by(project_id=p.id).first()
            if assign:
                target_days = (p.target_date - date.today()).days if p.target_date else 15
                target_days = max(1, target_days)
                req_tig, req_mig, req_grind = calculate_required_resources_for_deadline(p.id, target_days)
                
                assign.assigned_tig_welders = req_tig
                assign.assigned_mig_welders = req_mig
                assign.assigned_grinders = req_grind
                assign.estimated_duration_days = target_days
                
        db.commit()
    except Exception as e:
        db.rollback()
        print(f"Auto-sync failed: {e}")
    finally:
        db.close()

@router.post("/sync/ej")
def sync_ej_master_api(current_user: dict = Depends(require_roles(MANAGEMENT))):
    success, msg = import_welding_master_from_disk()
    if not success:
        raise HTTPException(status_code=500, detail=msg)
    auto_sync_all_projects_with_master()
    return {"success": True, "message": msg, "data": {}}

@router.post("/sync/dj")
def sync_dj_master_api(current_user: dict = Depends(require_roles(MANAGEMENT))):
    success, msg = import_dismantling_joint_master()
    if not success:
        raise HTTPException(status_code=500, detail=msg)
    auto_sync_all_projects_with_master()
    return {"success": True, "message": msg, "data": {}}

@router.post("/welding-import")
def welding_import_api(
    file: UploadFile = File(...),
    current_user: dict = Depends(require_roles(["Developer", "GM", "Admin", "Production Manager"]))
):
    """Upload a new EJ (Expansion Joint) welding-feet-per-size Excel file and sync all projects to it."""
    contents = _read_upload_or_400(file)
    success, msg = import_welding_master_from_upload(contents)
    if not success:
        raise HTTPException(status_code=400, detail=msg)
    auto_sync_all_projects_with_master()
    return {"success": True, "message": msg, "data": {}}

@router.post("/dj-import")
def dj_import_api(
    file: UploadFile = File(...),
    current_user: dict = Depends(require_roles(["Developer", "GM", "Admin", "Production Manager"]))
):
    """Upload a new DJ (Dismantling Joint) welding-feet-per-size Excel file and sync all projects to it."""
    contents = _read_upload_or_400(file)
    success, msg = import_dismantling_joint_master_from_upload(contents)
    if not success:
        raise HTTPException(status_code=400, detail=msg)
    auto_sync_all_projects_with_master()
    return {"success": True, "message": msg, "data": {}}

@router.post("/sync/all")
def sync_all_master_api(current_user: dict = Depends(require_roles(MANAGEMENT))):
    s1, m1 = import_welding_master_from_disk()
    s2, m2 = import_dismantling_joint_master()
    if not s1 or not s2:
        raise HTTPException(status_code=500, detail=f"EJ: {m1}, DJ: {m2}")
    auto_sync_all_projects_with_master()
    return {"success": True, "message": f"EJ: {m1} | DJ: {m2}", "data": {}}

@router.get("/workforce")
def get_workforce_api(db = Depends(get_db), current_user: dict = Depends(require_roles(SUPERVISORS))):
    from backend.services.db_service import WorkforceMaster
    wf = db.query(WorkforceMaster).order_by(WorkforceMaster.id).all()
    return {"success": True, "message": "Workforce retrieved", "data": [{"id": w.id, "resource_type": w.resource_type, "productivity": w.avg_productivity_per_day} for w in wf]}

@router.put("/workforce/{wf_id}")
def update_workforce_api(wf_id: int, req: WorkforceUpdate, db = Depends(get_db), current_user: dict = Depends(require_roles(MANAGEMENT))):
    from backend.services.db_service import WorkforceMaster
    w = db.query(WorkforceMaster).filter(WorkforceMaster.id == wf_id).first()
    if w:
        w.avg_productivity_per_day = req.productivity
        db.commit()
    return {"success": True, "message": "Workforce updated", "data": {}}

@router.get("/pool")
def get_pool_api(db = Depends(get_db), current_user: dict = Depends(require_roles(SUPERVISORS))):
    from backend.services.db_service import CompanyResourcePool
    from backend.services.production_service import get_company_capacity_status
    pool = db.query(CompanyResourcePool).first()
    
    # Get current requirements from production service
    capacity_status = get_company_capacity_status()
    req = capacity_status.get("required", {"tig": 0, "mig": 0, "grinders": 0})
    
    if not pool:
        data = {"total_tig_welders": 0, "total_mig_welders": 0, "total_grinders": 0}
    else:
        data = {
            "total_tig_welders": pool.total_tig_welders,
            "total_mig_welders": pool.total_mig_welders,
            "total_grinders": pool.total_grinders
        }
        
    data["required"] = req
    return {"success": True, "message": "Pool retrieved", "data": data}

@router.put("/pool")
def update_pool_api(req: PoolUpdate, db = Depends(get_db), current_user: dict = Depends(require_roles(MANAGEMENT))):
    from backend.services.db_service import CompanyResourcePool
    pool = db.query(CompanyResourcePool).first()
    if not pool:
        pool = CompanyResourcePool()
        db.add(pool)
    pool.total_tig_welders = req.total_tig_welders
    pool.total_mig_welders = req.total_mig_welders
    pool.total_grinders = req.total_grinders
    db.commit()
    return {"success": True, "message": "Pool updated", "data": {}}
