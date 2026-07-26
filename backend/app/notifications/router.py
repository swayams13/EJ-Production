import os
import logging
from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from backend.services.db_service import get_db, Notification
from backend.app.auth.rbac import require_roles, MANAGEMENT
from backend.services import email_service

logger = logging.getLogger(__name__)

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


@router.post("/test-email")
def test_email(user=Depends(require_roles(["GM", "Developer"]))):
    """Diagnostic: send a test email via Resend and return the result immediately."""
    import urllib.request, urllib.error, json as _json
    api_key = email_service.RESEND_API_KEY
    gm_email = os.getenv("GM_EMAIL", "")

    config = {
        "RESEND_API_KEY_set": bool(api_key),
        "SMTP_FROM": email_service.SMTP_FROM,
        "GM_EMAIL": gm_email or "(not set)",
    }

    if not api_key:
        return {"ok": False, "config": config, "error": "RESEND_API_KEY not set in Railway env vars"}
    if not gm_email:
        return {"ok": False, "config": config, "error": "GM_EMAIL not set"}

    payload = _json.dumps({
        "from": email_service.SMTP_FROM,
        "to": [gm_email],
        "subject": "[EJ Tracker] SMTP Test",
        "text": "This is a test email from EJ Production Tracker to confirm Resend is working.",
    }).encode()
    req = urllib.request.Request(
        "https://api.resend.com/emails",
        data=payload,
        headers={"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=10) as resp:
            return {"ok": True, "config": config, "sent_to": gm_email, "resend_status": resp.status}
    except urllib.error.HTTPError as e:
        err = e.read().decode()
        logger.error("Resend test failed: %s %s", e.code, err)
        return {"ok": False, "config": config, "error": f"Resend {e.code}: {err}"}
    except Exception as e:
        logger.error("Resend test failed: %s", e)
        return {"ok": False, "config": config, "error": str(e)}
