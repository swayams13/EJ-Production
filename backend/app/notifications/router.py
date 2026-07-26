import os
from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from backend.services.db_service import get_db, Notification
from backend.app.auth.rbac import require_roles, MANAGEMENT

router = APIRouter(prefix="/api/v1/notifications", tags=["Notifications"])

ROLE_EMAIL_MAP = {
    "GM": os.getenv("GM_EMAIL", ""),
    "Production Manager": os.getenv("PM_EMAIL", ""),
    "CEO": os.getenv("CEO_EMAIL", ""),
    "MD": os.getenv("MD_EMAIL", ""),
}

# Roles each sender can contact
_ALLOWED_RECIPIENTS: dict = {
    "GM": ["Production Manager"],
    "Production Manager": ["GM"],
    "CEO": ["GM", "Production Manager"],
    "MD": ["GM", "Production Manager"],
    "Developer": ["GM", "Production Manager"],
}


@router.get("/mail-recipients")
def mail_recipients(user=Depends(require_roles(MANAGEMENT))):
    role = user["role"]
    allowed = _ALLOWED_RECIPIENTS.get(role, [])
    return {r: ROLE_EMAIL_MAP.get(r, "") for r in allowed if ROLE_EMAIL_MAP.get(r)}


@router.get("/unread-count")
def unread_count(db: Session = Depends(get_db), user=Depends(require_roles(MANAGEMENT))):
    count = db.query(Notification).filter_by(for_role=user["role"], is_read=False).count()
    return {"count": count}


@router.get("/")
def list_notifications(db: Session = Depends(get_db), user=Depends(require_roles(MANAGEMENT))):
    notifs = (
        db.query(Notification)
        .filter_by(for_role=user["role"])
        .order_by(Notification.created_at.desc())
        .limit(50)
        .all()
    )
    return [
        {
            "id": n.id,
            "event_type": n.event_type,
            "title": n.title,
            "body": n.body,
            "link": n.link,
            "project_id": n.project_id,
            "is_read": n.is_read,
            "created_at": n.created_at.isoformat() if n.created_at else None,
        }
        for n in notifs
    ]


@router.put("/{notif_id}/read", status_code=204)
def mark_read(notif_id: int, db: Session = Depends(get_db), user=Depends(require_roles(MANAGEMENT))):
    db.query(Notification).filter_by(id=notif_id, for_role=user["role"]).update({"is_read": True})
    db.commit()


@router.put("/read-all", status_code=204)
def mark_all_read(db: Session = Depends(get_db), user=Depends(require_roles(MANAGEMENT))):
    db.query(Notification).filter_by(for_role=user["role"], is_read=False).update({"is_read": True})
    db.commit()
