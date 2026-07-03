from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from backend.services.production_service import get_welding_master_latest, import_welding_master_from_disk, import_dismantling_joint_master
from backend.services.db_service import get_db
from backend.app.master.schemas import WorkforceUpdate, PoolUpdate, WeldingSizeCreate

router = APIRouter(prefix="/api/v1/master", tags=["Master"])

@router.get("/welding")
def get_welding_master_api():
    data = get_welding_master_latest()
    formatted_data = [{"size": d.size, "type": getattr(d, 'joint_type', 'EJ'), "tig_feet": round(d.tig_feet, 2) if d.tig_feet else 0, "mig_feet": round(d.mig_feet, 2) if d.mig_feet else 0, "grinding_feet": round(d.grinding_feet, 2) if d.grinding_feet else 0} for d in data]
    return {"success": True, "message": "Welding master retrieved", "data": formatted_data}

@router.get("/dedupe-db")
def dedupe_db(db: Session = Depends(get_db)):
    from backend.services.db_service import WeldingMaster
    
    all_records = db.query(WeldingMaster).all()
    seen = set()
    deleted_count = 0
    
    # Sort by ID descending to keep newest
    all_records.sort(key=lambda x: x.id, reverse=True)
    
    for r in all_records:
        key = f"{r.joint_type}-{r.size}"
        if key in seen:
            db.delete(r)
            deleted_count += 1
        else:
            seen.add(key)
            r.version = 100 # Synchronize to a clean global version
            
    db.commit()
    return {"success": True, "message": f"Deleted {deleted_count} duplicates and synchronized all sizes!"}

@router.post("/welding-size")
def create_custom_welding_size(req: WeldingSizeCreate, db = Depends(get_db)):
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

@router.get("/sync-dj-temp")
def sync_dj_temp():
    """
    Temporary route to trigger the DJ import script without needing the Railway Console.
    """
    from sqlalchemy import text
    from backend.services.db_service import SessionLocal
    
    session = SessionLocal()
    try:
        session.execute(text("SELECT setval('welding_master_id_seq', COALESCE((SELECT MAX(id)+1 FROM welding_master), 1), false);"))
        session.commit()
    except Exception as e:
        session.rollback()
    finally:
        session.close()
        
    success, msg = import_dismantling_joint_master()
    return {"success": success, "message": msg}

@router.get("/backfill-grinding")
def backfill_grinding_feet():
    """
    Temporary route to backfill grinding feet for all previously loaded projects (both EJ and DJ).
    """
    from backend.services.db_service import SessionLocal, ProjectProductionLine, WeldingMaster
    
    session = SessionLocal()
    try:
        lines = session.query(ProjectProductionLine).all()
        updated_count = 0
        for line in lines:
            master = session.query(WeldingMaster).filter(
                WeldingMaster.size == line.size,
                WeldingMaster.joint_type == line.joint_type
            ).order_by(WeldingMaster.version.desc()).first()
            
            if master and master.grinding_feet:
                expected_grinding = float(line.quantity) * float(master.grinding_feet)
                if line.grinding_feet != expected_grinding:
                    line.grinding_feet = expected_grinding
                    updated_count += 1
                    
        session.commit()
        return {"success": True, "message": f"Successfully backfilled grinding feet for {updated_count} production lines."}
    except Exception as e:
        session.rollback()
        return {"success": False, "message": str(e)}
    finally:
        session.close()

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

@router.post("/sync/all")
def sync_all_master_api():
    s1, m1 = import_welding_master_from_disk()
    s2, m2 = import_dismantling_joint_master()
    if not s1 or not s2:
        raise HTTPException(status_code=500, detail=f"EJ: {m1}, DJ: {m2}")
    return {"success": True, "message": f"EJ: {m1} | DJ: {m2}", "data": {}}

@router.get("/workforce")
def get_workforce_api(db = Depends(get_db)):
    from backend.services.db_service import WorkforceMaster
    wf = db.query(WorkforceMaster).order_by(WorkforceMaster.id).all()
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
