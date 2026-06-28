from fastapi import APIRouter, Depends, HTTPException
from backend.services.production_service import get_welding_master_latest, import_welding_master_from_disk, import_dismantling_joint_master
from backend.services.db_service import get_db
from backend.app.master.schemas import WorkforceUpdate, PoolUpdate

router = APIRouter(prefix="/api/v1/master", tags=["Master"])

@router.get("/welding")
def get_welding_master_api():
    data = get_welding_master_latest()
    formatted_data = [{"size": d.size, "type": getattr(d, 'joint_type', 'EJ'), "tig_feet": round(d.tig_feet, 2) if d.tig_feet else 0, "mig_feet": round(d.mig_feet, 2) if d.mig_feet else 0, "grinding_feet": round(d.grinding_feet, 2) if d.grinding_feet else 0} for d in data]
    return {"success": True, "message": "Welding master retrieved", "data": formatted_data}

@router.post("/sync/ej")
def sync_ej_master_api():
    success, msg = import_welding_master_from_disk()
    if not success:
        raise HTTPException(status_code=500, detail=msg)
    return {"success": True, "message": msg, "data": {}}

@router.post("/sync/dj")
def sync_dj_master_api():
    success, msg = import_dismantling_joint_master()
    if not success:
        raise HTTPException(status_code=500, detail=msg)
    return {"success": True, "message": msg, "data": {}}

@router.get("/workforce")
def get_workforce_api(db = Depends(get_db)):
    from backend.services.db_service import WorkforceMaster
    wf = db.query(WorkforceMaster).all()
    return {"success": True, "message": "Workforce retrieved", "data": [{"id": w.id, "resource_type": w.resource_type, "productivity": w.avg_productivity_per_day} for w in wf]}

@router.put("/workforce/{wf_id}")
def update_workforce_api(wf_id: int, req: WorkforceUpdate, db = Depends(get_db)):
    from backend.services.db_service import WorkforceMaster
    w = db.query(WorkforceMaster).filter(WorkforceMaster.id == wf_id).first()
    if w:
        w.avg_productivity_per_day = req.productivity
        db.commit()
    return {"success": True, "message": "Workforce updated", "data": {}}

@router.get("/pool")
def get_pool_api(db = Depends(get_db)):
    from backend.services.db_service import CompanyResourcePool
    pool = db.query(CompanyResourcePool).first()
    if not pool:
        data = {"total_tig_welders": 0, "total_mig_welders": 0, "total_grinders": 0}
    else:
        data = {
            "total_tig_welders": pool.total_tig_welders,
            "total_mig_welders": pool.total_mig_welders,
            "total_grinders": pool.total_grinders
        }
    return {"success": True, "message": "Pool retrieved", "data": data}

@router.put("/pool")
def update_pool_api(req: PoolUpdate, db = Depends(get_db)):
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
