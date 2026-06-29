import csv
import io
from fastapi import APIRouter, Depends
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session
from backend.services.db_service import get_db, AuditLog, User
from backend.app.auth.rbac import require_roles

router = APIRouter(prefix="/api/v1/audit", tags=["Audit"])

@router.get("")
def get_audit_logs(db: Session = Depends(get_db), current_user: dict = Depends(require_roles(["Developer"]))):
    if current_user.get("role") in ["Production Manager", "GM"]:
        from fastapi import HTTPException
        raise HTTPException(status_code=403, detail="Audit Logs access denied for PM and GM")
        
    logs = db.query(AuditLog, User).outerjoin(User, AuditLog.user_id == User.id).order_by(AuditLog.timestamp.desc()).limit(100).all()
    
    result = []
    for log, user in logs:
        user_display = user.full_name if user else (log.username or "System/Unknown")
        result.append({
            "id": log.id,
            "timestamp": log.timestamp.isoformat() if log.timestamp else None,
            "user": user_display,
            "action": log.action,
            "table_name": log.table_name,
            "record_id": log.record_id,
            "details": log.details
        })
        
    return {"success": True, "message": "Audit logs retrieved", "data": result}

@router.get("/excel")
def download_audit_logs_excel(db: Session = Depends(get_db), current_user: dict = Depends(require_roles(["Developer"]))):
    if current_user.get("role") in ["Production Manager", "GM"]:
        from fastapi import HTTPException
        raise HTTPException(status_code=403, detail="Audit Logs access denied for PM and GM")
        
    # Note: Not securing via Depends here if requested directly from browser, but ideally it should be.
    # We will fetch all logs for the export
    logs = db.query(AuditLog, User).outerjoin(User, AuditLog.user_id == User.id).order_by(AuditLog.timestamp.desc()).all()
    
    output = io.StringIO()
    writer = csv.writer(output)
    writer.writerow(["ID", "Timestamp", "User/Account", "Action", "Table", "Record ID", "Details"])
    
    for log, user in logs:
        user_display = user.full_name if user else (log.username or "System/Unknown")
        timestamp = log.timestamp.strftime("%Y-%m-%d %H:%M:%S") if log.timestamp else ""
        writer.writerow([log.id, timestamp, user_display, log.action, log.table_name, log.record_id, log.details])
        
    output.seek(0)
    
    response = StreamingResponse(iter([output.getvalue()]), media_type="text/csv")
    response.headers["Content-Disposition"] = "attachment; filename=audit_logs.csv"
    return response
