import os
import smtplib
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
    """Diagnostic: attempt a synchronous SMTP test and return the result immediately."""
    host = email_service.SMTP_HOST
    port = email_service.SMTP_PORT
    smtp_user = email_service.SMTP_USER
    smtp_pass = email_service.SMTP_PASS
    gm_email = os.getenv("GM_EMAIL", "")

    config = {
        "SMTP_HOST": host or "(not set)",
        "SMTP_PORT": port,
        "SMTP_USER": smtp_user or "(not set)",
        "SMTP_PASS_set": bool(smtp_pass),
        "GM_EMAIL": gm_email or "(not set)",
    }

    if not host or not smtp_user or not smtp_pass:
        return {"ok": False, "config": config, "error": "SMTP env vars missing — check SMTP_HOST, SMTP_USER, SMTP_PASS"}

    if not gm_email:
        return {"ok": False, "config": config, "error": "GM_EMAIL not set"}

    try:
        with smtplib.SMTP(host, port, timeout=10) as server:
            server.starttls()
            server.login(smtp_user, smtp_pass)
            from email.mime.text import MIMEText
            msg = MIMEText("This is a test email from EJ Production Tracker to confirm SMTP is working.")
            msg["Subject"] = "[EJ Tracker] SMTP Test"
            msg["From"] = smtp_user
            msg["To"] = gm_email
            server.sendmail(smtp_user, [gm_email], msg.as_string())
        return {"ok": True, "config": config, "sent_to": gm_email}
    except Exception as e:
        logger.error("SMTP test failed: %s", e)
        return {"ok": False, "config": config, "error": str(e)}
