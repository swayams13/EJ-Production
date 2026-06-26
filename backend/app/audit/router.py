from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session
from backend.services.db_service import get_db, AuditLog, User

router = APIRouter(prefix="/api/v1/audit", tags=["Audit"])

@router.get("")
def get_audit_logs(db: Session = Depends(get_db)):
    logs = db.query(AuditLog, User).join(User, AuditLog.user_id == User.id).order_by(AuditLog.timestamp.desc()).limit(50).all()
    
    result = []
    for log, user in logs:
        result.append({
            "id": log.id,
            "timestamp": log.timestamp.isoformat(),
            "user": user.full_name,
            "action": log.action,
            "entity_type": log.entity_type,
            "entity_id": log.entity_id,
            "details": log.details
        })
        
    return {"success": True, "message": "Audit logs retrieved", "data": result}
