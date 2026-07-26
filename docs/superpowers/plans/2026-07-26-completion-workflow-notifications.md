# Completion Workflow & Notification System — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** PM-initiated project bulk-complete with GM approval/rejection gate, plus a role-aware in-app notification bell (with badge count) and automated system emails for key events.

**Architecture:** Two new DB tables (`project_completion_requests`, `notifications`); two new backend services (`email_service`, `notification_service`); two new routers (completion, notifications); notification triggers inserted into existing routers; `NotificationBell` component added to Sidebar; PM completion modal + GM approval panel added to existing frontend pages.

**Tech Stack:** Python/FastAPI, SQLAlchemy, stdlib `smtplib`/`email`, PostgreSQL, Next.js/TSX, existing `apiFetch`/`Modal`/`Button`/`Badge` design system components.

## Global Constraints

- PostgreSQL only — no SQLite.
- All new Python packages go in root `requirements.txt`.
- Push to `demo` branch only; never merge to `main` without user approval.
- Start backend: `python -m uvicorn backend.main:app --port 8003 --reload`
- Start frontend: `npm --prefix next-frontend run dev`
- Build check: `npm --prefix next-frontend run build` (must pass 0 TS errors)
- `py_compile` check: `python -m py_compile <file>` after each Python file.
- No `alert()`/`confirm()`/`prompt()` in frontend — use existing `Modal` + `useToast`.
- No runtime Tailwind class interpolation — use full class strings only.

---

## File Map

**Create:**
- `backend/services/email_service.py` — SMTP sender (stdlib only)
- `backend/services/notification_service.py` — `create_notification()` DB helper
- `backend/app/projects/completion.py` — completion workflow router (5 endpoints)
- `backend/app/notifications/__init__.py` — empty
- `backend/app/notifications/router.py` — notifications CRUD (4 endpoints)
- `next-frontend/src/components/NotificationBell.tsx` — bell icon + dropdown panel

**Modify:**
- `backend/services/db_service.py` — add `ProjectCompletionRequest` + `Notification` ORM models
- `backend/main.py` — startup migrations for 2 new tables + mount 2 new routers
- `backend/app/projects/router.py` — notification triggers: new project created, project held
- `backend/app/procurement/router.py` — notification trigger: GR (goods receipt) created
- `backend/app/scheduler/router.py` — notification trigger: work orders generated
- `backend/app/dashboard/router.py` — notification trigger: material-red (with 24 h dedup)
- `next-frontend/src/components/Sidebar.tsx` — embed `NotificationBell` in sidebar header
- `next-frontend/src/app/(main)/projects/page.tsx` — Mark as Complete button + checklist modal + pending banner
- `next-frontend/src/app/(main)/dashboard/page.tsx` — GM Pending Completions card

---

## Task 1: ORM Models + DB Migrations

**Files:**
- Modify: `backend/services/db_service.py`
- Modify: `backend/main.py`

**Interfaces:**
- Produces: `ProjectCompletionRequest`, `Notification` SQLAlchemy models importable from `backend.services.db_service`

- [ ] **Step 1: Add ORM models to db_service.py**

Open `backend/services/db_service.py`. After the `WarehouseStock` class (end of file), append:

```python
class ProjectCompletionRequest(Base):
    __tablename__ = "project_completion_requests"
    id = Column(Integer, primary_key=True, index=True)
    project_id = Column(Integer, ForeignKey("projects.id"), nullable=False)
    requested_by = Column(String, nullable=False)   # PM username
    requested_at = Column(DateTime, default=datetime.utcnow)
    status = Column(String, default="pending")       # pending | approved | rejected
    reviewed_by = Column(String, nullable=True)
    reviewed_at = Column(DateTime, nullable=True)
    rejection_reason = Column(Text, nullable=True)

    project = relationship("Project")


class Notification(Base):
    __tablename__ = "notifications"
    id = Column(Integer, primary_key=True, index=True)
    for_role = Column(String, nullable=False)        # "GM" | "Production Manager" | "CEO" | "MD"
    event_type = Column(String, nullable=False)      # see notification_service.py
    title = Column(String, nullable=False)
    body = Column(Text, nullable=True)
    link = Column(String, nullable=True)             # frontend path, e.g. /projects
    project_id = Column(Integer, nullable=True)
    is_read = Column(Boolean, default=False)
    created_at = Column(DateTime, default=datetime.utcnow)
```

- [ ] **Step 2: Add startup migrations in main.py**

In `backend/main.py`, after the last existing `_run_startup_migration(...)` call, add:

```python
_run_startup_migration("project_completion_requests table", [
    """
    CREATE TABLE IF NOT EXISTS project_completion_requests (
        id SERIAL PRIMARY KEY,
        project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        requested_by VARCHAR NOT NULL,
        requested_at TIMESTAMP DEFAULT NOW(),
        status VARCHAR DEFAULT 'pending',
        reviewed_by VARCHAR,
        reviewed_at TIMESTAMP,
        rejection_reason TEXT
    )
    """,
])

_run_startup_migration("notifications table", [
    """
    CREATE TABLE IF NOT EXISTS notifications (
        id SERIAL PRIMARY KEY,
        for_role VARCHAR NOT NULL,
        event_type VARCHAR NOT NULL,
        title VARCHAR NOT NULL,
        body TEXT,
        link VARCHAR,
        project_id INTEGER,
        is_read BOOLEAN DEFAULT FALSE,
        created_at TIMESTAMP DEFAULT NOW()
    )
    """,
])
```

- [ ] **Step 3: Syntax check**

```bash
python -m py_compile backend/services/db_service.py
python -m py_compile backend/main.py
```

Expected: no output (no errors).

- [ ] **Step 4: Start server and confirm tables exist**

```bash
python -m uvicorn backend.main:app --port 8003 --reload
```

Check logs — should see startup migrations run. Then in psql:
```sql
\dt project_completion_requests
\dt notifications
```
Expected: both tables listed.

- [ ] **Step 5: Commit**

```bash
git add backend/services/db_service.py backend/main.py
git commit -m "feat: add ProjectCompletionRequest and Notification ORM models + migrations"
```

---

## Task 2: Email Service

**Files:**
- Create: `backend/services/email_service.py`

**Interfaces:**
- Produces: `send_system_email(to: str | list[str], subject: str, body: str) -> None`
- Env vars required: `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`
- If env vars absent: logs a warning and returns silently (dev-safe).

- [ ] **Step 1: Write smoke test**

Create `test_email_service.py` in project root:

```python
from unittest.mock import patch, MagicMock
import os

os.environ.setdefault("SMTP_HOST", "smtp.office365.com")
os.environ.setdefault("SMTP_PORT", "587")
os.environ.setdefault("SMTP_USER", "test@org.com")
os.environ.setdefault("SMTP_PASS", "secret")

from backend.services.email_service import send_system_email

def test_sends_email_via_smtp():
    with patch("smtplib.SMTP") as mock_smtp_cls:
        mock_server = MagicMock()
        mock_smtp_cls.return_value.__enter__ = lambda s: mock_server
        mock_smtp_cls.return_value.__exit__ = MagicMock(return_value=False)
        send_system_email("gm@org.com", "[EJ Tracker] Test", "Hello GM")
        assert mock_server.sendmail.called

def test_skips_when_no_creds():
    import importlib
    import backend.services.email_service as svc
    orig = svc.SMTP_HOST
    svc.SMTP_HOST = None
    send_system_email("gm@org.com", "subject", "body")  # must not raise
    svc.SMTP_HOST = orig

if __name__ == "__main__":
    test_sends_email_via_smtp()
    test_skips_when_no_creds()
    print("OK")
```

- [ ] **Step 2: Run test — expect ImportError (file doesn't exist yet)**

```bash
python test_email_service.py
```

Expected: `ModuleNotFoundError: No module named 'backend.services.email_service'`

- [ ] **Step 3: Create email_service.py**

```python
import os
import logging
import smtplib
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart

logger = logging.getLogger(__name__)

SMTP_HOST = os.getenv("SMTP_HOST")
SMTP_PORT = int(os.getenv("SMTP_PORT", "587"))
SMTP_USER = os.getenv("SMTP_USER")
SMTP_PASS = os.getenv("SMTP_PASS")


def send_system_email(to: "str | list[str]", subject: str, body: str) -> None:
    if not SMTP_HOST or not SMTP_USER or not SMTP_PASS:
        logger.warning("SMTP not configured — skipping email to %s", to)
        return

    recipients = [to] if isinstance(to, str) else to

    msg = MIMEMultipart("alternative")
    msg["Subject"] = subject
    msg["From"] = SMTP_USER
    msg["To"] = ", ".join(recipients)
    msg.attach(MIMEText(body, "plain"))

    try:
        with smtplib.SMTP(SMTP_HOST, SMTP_PORT) as server:
            server.starttls()
            server.login(SMTP_USER, SMTP_PASS)
            server.sendmail(SMTP_USER, recipients, msg.as_string())
        logger.info("Email sent to %s: %s", recipients, subject)
    except Exception as e:
        logger.error("Failed to send email to %s: %s", recipients, e)
```

- [ ] **Step 4: Run test — expect pass**

```bash
python test_email_service.py
```

Expected: `OK`

- [ ] **Step 5: Syntax check**

```bash
python -m py_compile backend/services/email_service.py
```

- [ ] **Step 6: Commit**

```bash
git add backend/services/email_service.py test_email_service.py
git commit -m "feat: add email_service with SMTP sender and dev-safe no-op"
```

---

## Task 3: Notification Service

**Files:**
- Create: `backend/services/notification_service.py`

**Interfaces:**
- Produces: `create_notification(db, for_role: str, event_type: str, title: str, body: str, link: str, project_id: int = None) -> None`
- Consumes: `Notification` model from `backend.services.db_service`

- [ ] **Step 1: Write smoke test**

Create `test_notification_service.py` in project root:

```python
from unittest.mock import MagicMock

def test_create_notification_adds_to_db():
    from backend.services.notification_service import create_notification
    db = MagicMock()
    create_notification(db, "GM", "completion_request", "New request", "PM submitted", "/projects", 1)
    assert db.add.called
    assert db.commit.called
    added = db.add.call_args[0][0]
    assert added.for_role == "GM"
    assert added.event_type == "completion_request"
    assert added.project_id == 1

if __name__ == "__main__":
    test_create_notification_adds_to_db()
    print("OK")
```

- [ ] **Step 2: Run test — expect ImportError**

```bash
python test_notification_service.py
```

- [ ] **Step 3: Create notification_service.py**

```python
import logging
from sqlalchemy.orm import Session
from backend.services.db_service import Notification

logger = logging.getLogger(__name__)


def create_notification(
    db: Session,
    for_role: str,
    event_type: str,
    title: str,
    body: str,
    link: str,
    project_id: int = None,
) -> None:
    notif = Notification(
        for_role=for_role,
        event_type=event_type,
        title=title,
        body=body,
        link=link,
        project_id=project_id,
    )
    db.add(notif)
    db.commit()
    logger.info("Notification created for role=%s event=%s", for_role, event_type)
```

- [ ] **Step 4: Run test — expect OK**

```bash
python test_notification_service.py
```

- [ ] **Step 5: Syntax check + commit**

```bash
python -m py_compile backend/services/notification_service.py
git add backend/services/notification_service.py test_notification_service.py
git commit -m "feat: add notification_service create_notification helper"
```

---

## Task 4: Completion Router — PM Endpoints

**Files:**
- Create: `backend/app/projects/completion.py`

**Interfaces:**
- Consumes: `ProjectCompletionRequest`, `Project`, `PartProcess`, `Part`, `AssemblyStep`, `JobFinalCheck`, `ProjectProductionLine` from db_service; `create_notification` from notification_service; `send_system_email` from email_service
- Produces: router at prefix `/api/v1/projects`; endpoints: `GET /{id}/completion-preview`, `POST /{id}/completion-request`

- [ ] **Step 1: Create completion.py with PM endpoints**

```python
import os
import logging
from datetime import datetime
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from backend.services.db_service import (
    get_db, Project, ProjectProductionLine, Part, PartProcess,
    AssemblyStep, JobFinalCheck, ProjectCompletionRequest,
)
from backend.app.auth.rbac import require_roles
from backend.services.notification_service import create_notification
from backend.services.email_service import send_system_email

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/v1/projects", tags=["Completion"])

GM_EMAIL = os.getenv("GM_EMAIL", "")


def _get_project_or_404(project_id: int, db: Session):
    proj = db.query(Project).filter(Project.id == project_id).first()
    if not proj:
        raise HTTPException(status_code=404, detail="Project not found")
    return proj


@router.get("/{project_id}/completion-preview")
def completion_preview(
    project_id: int,
    db: Session = Depends(get_db),
    user=Depends(require_roles(["Production Manager", "Developer"])),
):
    proj = _get_project_or_404(project_id, db)
    line_ids = [l.id for l in db.query(ProjectProductionLine.id).filter_by(project_id=project_id).all()]
    part_ids = [p.id for p in db.query(Part.id).filter(Part.production_line_id.in_(line_ids)).all()]

    part_process_count = db.query(PartProcess).filter(PartProcess.part_id.in_(part_ids)).count()
    assembly_count = db.query(AssemblyStep).filter(AssemblyStep.production_line_id.in_(line_ids)).count()
    final_check_count = db.query(JobFinalCheck).filter(JobFinalCheck.production_line_id.in_(line_ids)).count()

    return {
        "project_id": project_id,
        "project_name": proj.project_name,
        "quotation_no": proj.quotation_no,
        "production_lines": len(line_ids),
        "part_processes": part_process_count,
        "assembly_steps": assembly_count,
        "final_checks": final_check_count,
    }


@router.post("/{project_id}/completion-request", status_code=201)
def submit_completion_request(
    project_id: int,
    db: Session = Depends(get_db),
    user=Depends(require_roles(["Production Manager", "Developer"])),
):
    proj = _get_project_or_404(project_id, db)

    existing = (
        db.query(ProjectCompletionRequest)
        .filter_by(project_id=project_id, status="pending")
        .first()
    )
    if existing:
        raise HTTPException(status_code=409, detail="A completion request is already pending for this project")

    req = ProjectCompletionRequest(
        project_id=project_id,
        requested_by=user["username"],
    )
    db.add(req)
    db.commit()
    db.refresh(req)

    create_notification(
        db, "GM", "completion_request",
        f"Completion request: {proj.quotation_no}",
        f"{user['username']} submitted a completion request for {proj.project_name}.",
        "/dashboard",
        project_id=project_id,
    )

    send_system_email(
        GM_EMAIL,
        f"[EJ Tracker] Completion Request — {proj.quotation_no}",
        f"{user['username']} has submitted a completion request for project: {proj.project_name} ({proj.quotation_no}).\n\nLog in to approve or reject: {os.getenv('FRONTEND_ORIGINS', 'http://localhost:3000').split(',')[0]}/dashboard",
    )

    return {"id": req.id, "status": req.status}
```

- [ ] **Step 2: Syntax check**

```bash
python -m py_compile backend/app/projects/completion.py
```

- [ ] **Step 3: Start server, test preview endpoint manually**

```bash
python -m uvicorn backend.main:app --port 8003 --reload
```

(Mount in main.py first — see Task 6. Come back to test after Task 6 is done.)

- [ ] **Step 4: Commit**

```bash
git add backend/app/projects/completion.py
git commit -m "feat: add completion-preview and completion-request endpoints (PM)"
```

---

## Task 5: Completion Router — GM Endpoints (Bulk Complete + Reject)

**Files:**
- Modify: `backend/app/projects/completion.py`

**Interfaces:**
- Produces: `GET /completion-requests/pending`, `POST /completion-requests/{req_id}/approve`, `POST /completion-requests/{req_id}/reject`

- [ ] **Step 1: Add GM endpoints to completion.py**

Append to `backend/app/projects/completion.py`:

```python
PM_EMAIL = os.getenv("PM_EMAIL", "")
FRONTEND_BASE = os.getenv("FRONTEND_ORIGINS", "http://localhost:3000").split(",")[0]


@router.get("/completion-requests/pending")
def list_pending_requests(
    db: Session = Depends(get_db),
    user=Depends(require_roles(["GM", "Developer"])),
):
    requests = (
        db.query(ProjectCompletionRequest)
        .filter_by(status="pending")
        .order_by(ProjectCompletionRequest.requested_at.desc())
        .all()
    )
    result = []
    for r in requests:
        proj = db.query(Project).filter(Project.id == r.project_id).first()
        result.append({
            "id": r.id,
            "project_id": r.project_id,
            "project_name": proj.project_name if proj else None,
            "quotation_no": proj.quotation_no if proj else None,
            "requested_by": r.requested_by,
            "requested_at": r.requested_at.isoformat() if r.requested_at else None,
        })
    return result


@router.post("/completion-requests/{req_id}/approve")
def approve_completion(
    req_id: int,
    db: Session = Depends(get_db),
    user=Depends(require_roles(["GM", "Developer"])),
):
    req = db.query(ProjectCompletionRequest).filter(ProjectCompletionRequest.id == req_id).first()
    if not req or req.status != "pending":
        raise HTTPException(status_code=404, detail="Pending request not found")

    proj = _get_project_or_404(req.project_id, db)
    line_ids = [l.id for l in db.query(ProjectProductionLine.id).filter_by(project_id=req.project_id).all()]
    part_ids = [p.id for p in db.query(Part.id).filter(Part.production_line_id.in_(line_ids)).all()]

    # Bulk complete PartProcesses — set completed_qty = parent Part.total_qty
    parts_map = {p.id: p.total_qty for p in db.query(Part).filter(Part.id.in_(part_ids)).all()}
    processes = db.query(PartProcess).filter(PartProcess.part_id.in_(part_ids)).all()
    for pp in processes:
        pp.status = "ready"
        pp.completed_qty = parts_map.get(pp.part_id, pp.completed_qty)

    db.query(AssemblyStep).filter(AssemblyStep.production_line_id.in_(line_ids)).update(
        {"status": "ready"}, synchronize_session=False
    )
    db.query(JobFinalCheck).filter(JobFinalCheck.production_line_id.in_(line_ids)).update(
        {"status": "ready"}, synchronize_session=False
    )
    db.query(ProjectProductionLine).filter(ProjectProductionLine.id.in_(line_ids)).update(
        {"paint_status": "Completed"}, synchronize_session=False
    )

    proj.status = "Completed"
    req.status = "approved"
    req.reviewed_by = user["username"]
    req.reviewed_at = datetime.utcnow()

    db.commit()

    create_notification(
        db, "Production Manager", "completion_approved",
        f"Project completed: {proj.quotation_no}",
        f"GM approved completion of {proj.project_name}.",
        "/projects",
        project_id=proj.id,
    )
    send_system_email(
        PM_EMAIL,
        f"[EJ Tracker] Project Completed — {proj.quotation_no}",
        f"GM has approved the completion of project: {proj.project_name} ({proj.quotation_no}).\n\nAll records have been marked complete.",
    )

    return {"status": "approved"}


class RejectBody(pydantic_base.BaseModel):
    rejection_reason: str


# Add to imports at top of file:
# from pydantic import BaseModel as pydantic_base  — handled below

@router.post("/completion-requests/{req_id}/reject")
def reject_completion(
    req_id: int,
    body: RejectBody,
    db: Session = Depends(get_db),
    user=Depends(require_roles(["GM", "Developer"])),
):
    req = db.query(ProjectCompletionRequest).filter(ProjectCompletionRequest.id == req_id).first()
    if not req or req.status != "pending":
        raise HTTPException(status_code=404, detail="Pending request not found")

    proj = _get_project_or_404(req.project_id, db)
    req.status = "rejected"
    req.reviewed_by = user["username"]
    req.reviewed_at = datetime.utcnow()
    req.rejection_reason = body.rejection_reason
    db.commit()

    create_notification(
        db, "Production Manager", "completion_rejected",
        f"Completion rejected: {proj.quotation_no}",
        f"GM rejected the completion request for {proj.project_name}. Reason: {body.rejection_reason}",
        "/projects",
        project_id=proj.id,
    )
    send_system_email(
        PM_EMAIL,
        f"[EJ Tracker] Completion Rejected — {proj.quotation_no}",
        f"GM has rejected the completion request for: {proj.project_name} ({proj.quotation_no}).\n\nReason: {body.rejection_reason}",
    )

    return {"status": "rejected"}
```

Also add `RejectBody` and fix the import — replace the top of `completion.py` imports section to include `from pydantic import BaseModel as pydantic_base` and move `RejectBody` to the top of the file (before the route functions):

```python
from pydantic import BaseModel as pydantic_base

class RejectBody(pydantic_base):
    rejection_reason: str
```

Remove the inline `RejectBody` class from the middle of the file.

- [ ] **Step 2: Syntax check**

```bash
python -m py_compile backend/app/projects/completion.py
```

- [ ] **Step 3: Commit**

```bash
git add backend/app/projects/completion.py
git commit -m "feat: add GM approve/reject endpoints and bulk-complete transaction"
```

---

## Task 6: Notifications Router + Mount Everything in main.py

**Files:**
- Create: `backend/app/notifications/__init__.py`, `backend/app/notifications/router.py`
- Modify: `backend/main.py`

**Interfaces:**
- Produces: `GET /api/v1/notifications/`, `GET /api/v1/notifications/unread-count`, `PUT /api/v1/notifications/{id}/read`, `PUT /api/v1/notifications/read-all`, `GET /api/v1/notifications/mail-recipients`

- [ ] **Step 1: Create notifications module**

`backend/app/notifications/__init__.py` — empty file.

`backend/app/notifications/router.py`:

```python
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
_ALLOWED_RECIPIENTS: dict[str, list[str]] = {
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
```

- [ ] **Step 2: Mount new routers in main.py**

In `backend/main.py`, add imports and mounts:

```python
# Add to imports section (after existing router imports):
from backend.app.projects.completion import router as completion_router
from backend.app.notifications.router import router as notifications_router

# Add after existing app.include_router(...) calls:
app.include_router(completion_router)
app.include_router(notifications_router)
```

- [ ] **Step 3: Syntax check all new files**

```bash
python -m py_compile backend/app/notifications/router.py
python -m py_compile backend/main.py
```

- [ ] **Step 4: Start server and verify routes exist**

```bash
python -m uvicorn backend.main:app --port 8003 --reload
curl http://localhost:8003/openapi.json | python -m json.tool | grep '"/api/v1/notification'
curl http://localhost:8003/openapi.json | python -m json.tool | grep '"/api/v1/projects.*completion'
```

Expected: notification and completion endpoints appear in OpenAPI schema.

- [ ] **Step 5: Commit**

```bash
git add backend/app/notifications/ backend/main.py
git commit -m "feat: add notifications router and mount completion + notifications routers"
```

---

## Task 7: Notification Triggers in Existing Routers

**Files:**
- Modify: `backend/app/projects/router.py` (2 triggers)
- Modify: `backend/app/procurement/router.py` (1 trigger)
- Modify: `backend/app/scheduler/router.py` (1 trigger)
- Modify: `backend/app/dashboard/router.py` (1 trigger, with dedup)

**Interfaces:**
- Consumes: `create_notification` from `backend.services.notification_service`

- [ ] **Step 1: Add import to each router file**

Add to each of the 4 router files at the top:
```python
from backend.services.notification_service import create_notification
```

- [ ] **Step 2: projects/router.py — new project trigger**

Find the `create_project` endpoint in `backend/app/projects/router.py`. After `db.commit()` (line where new project is saved), add:

```python
    for role in ["GM", "CEO", "MD"]:
        create_notification(
            db, role, "project_created",
            f"New project: {new_proj.quotation_no}",
            f"Project '{new_proj.project_name}' for {new_proj.client_name} was added.",
            "/projects",
            project_id=new_proj.id,
        )
```

- [ ] **Step 3: projects/router.py — hold trigger**

Find `update_project` in `backend/app/projects/router.py`. In the block where `req.status == "Hold"` is applied (around line 169), add after `proj.status = req.status`:

```python
    if req.status == "Hold" and proj.status != "Hold":
        for role in ["GM", "CEO", "MD"]:
            create_notification(
                db, role, "project_on_hold",
                f"Project on hold: {proj.quotation_no}",
                f"Project '{proj.project_name}' has been placed on hold.",
                "/projects",
                project_id=project_id,
            )
```

Note: This block already exists for managing `ProjectHoldHistory` — add the notification call inside the same `if` block, just before or after the existing hold history logic.

- [ ] **Step 4: procurement/router.py — GR created trigger**

Find `log_receipt` (line 264 in procurement/router.py). After `db.commit()`, add:

```python
    create_notification(
        db, "Production Manager", "po_received",
        f"PO received: {po.po_number}",
        f"Goods receipt logged for PO {po.po_number}.",
        "/procurement/po",
        project_id=None,
    )
```

- [ ] **Step 5: scheduler/router.py — work orders generated trigger**

Find `generate_work_orders` (line 94). After the work orders are committed (look for the final `db.commit()` in that function), add:

```python
    create_notification(
        db, "Production Manager", "work_order_generated",
        "Work orders generated",
        f"New work orders have been generated.",
        "/scheduler",
    )
```

- [ ] **Step 6: dashboard/router.py — material-red trigger with 24h dedup**

In `backend/app/dashboard/router.py`, find the `GET /api/v1/dashboard/materials` endpoint. After the traffic-light logic assigns `status="red"` to rows, add:

```python
from datetime import datetime, timedelta

# At the end of the materials endpoint, after building the response rows, before return:
red_specs = [r for r in rows if r["status"] == "red"]
if red_specs:
    from backend.services.db_service import Notification
    cutoff = datetime.utcnow() - timedelta(hours=24)
    for spec in red_specs[:5]:  # cap at 5 alerts per load
        spec_key = f"{spec['material_name']}/{spec['size']}/{spec['joint_type']}"
        already_notified = (
            db.query(Notification)
            .filter(
                Notification.event_type == "material_red",
                Notification.body.like(f"%{spec_key}%"),
                Notification.created_at > cutoff,
            )
            .first()
        )
        if not already_notified:
            for role in ["GM", "Production Manager"]:
                create_notification(
                    db, role, "material_red",
                    f"Material shortage: {spec['material_name']} {spec['size']}",
                    f"Stock gap for {spec_key}. Net gap: {spec['net_gap']} units.",
                    "/dashboard/materials",
                )
```

- [ ] **Step 7: Syntax check all modified routers**

```bash
python -m py_compile backend/app/projects/router.py
python -m py_compile backend/app/procurement/router.py
python -m py_compile backend/app/scheduler/router.py
python -m py_compile backend/app/dashboard/router.py
```

- [ ] **Step 8: Start server — confirm no import errors**

```bash
python -m uvicorn backend.main:app --port 8003
```

Expected: server starts cleanly.

- [ ] **Step 9: Commit**

```bash
git add backend/app/projects/router.py backend/app/procurement/router.py backend/app/scheduler/router.py backend/app/dashboard/router.py
git commit -m "feat: wire notification triggers into projects, procurement, scheduler, dashboard routers"
```

---

## Task 8: NotificationBell Component

**Files:**
- Create: `next-frontend/src/components/NotificationBell.tsx`
- Modify: `next-frontend/src/components/Sidebar.tsx`

**Interfaces:**
- Consumes: `apiFetch` from `@/lib/api`; `Badge` from `@/components/ui`
- Produces: `<NotificationBell />` — self-contained, manages own state

- [ ] **Step 1: Create NotificationBell.tsx**

```tsx
"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { apiFetch } from "@/lib/api";

const API = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8003";

interface Notification {
  id: number;
  title: string;
  body: string | null;
  link: string | null;
  is_read: boolean;
  created_at: string | null;
}

export default function NotificationBell() {
  const [count, setCount] = useState(0);
  const [open, setOpen] = useState(false);
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const panelRef = useRef<HTMLDivElement>(null);
  const router = useRouter();

  const fetchCount = useCallback(async () => {
    try {
      const res = await apiFetch(`${API}/api/v1/notifications/unread-count`);
      if (res.ok) {
        const data = await res.json();
        setCount(data.count ?? 0);
      }
    } catch {
      // silent — don't break sidebar on network error
    }
  }, []);

  useEffect(() => {
    fetchCount();
    const interval = setInterval(fetchCount, 30_000);
    return () => clearInterval(interval);
  }, [fetchCount]);

  async function handleOpen() {
    setOpen((v) => !v);
    if (!open) {
      try {
        const res = await apiFetch(`${API}/api/v1/notifications/`);
        if (res.ok) setNotifications(await res.json());
      } catch {}
    }
  }

  async function markRead(id: number, link: string | null) {
    try {
      await apiFetch(`${API}/api/v1/notifications/${id}/read`, { method: "PUT" });
    } catch {}
    setNotifications((prev) =>
      prev.map((n) => (n.id === id ? { ...n, is_read: true } : n))
    );
    setCount((c) => Math.max(0, c - 1));
    if (link) router.push(link);
    setOpen(false);
  }

  async function markAllRead() {
    try {
      await apiFetch(`${API}/api/v1/notifications/read-all`, { method: "PUT" });
    } catch {}
    setNotifications((prev) => prev.map((n) => ({ ...n, is_read: true })));
    setCount(0);
  }

  // Close on outside click
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    if (open) document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [open]);

  return (
    <div className="relative" ref={panelRef}>
      <button
        onClick={handleOpen}
        className="relative flex items-center justify-center w-8 h-8 rounded hover:bg-white/10 transition-colors"
        aria-label="Notifications"
      >
        <svg className="w-5 h-5 text-[#9fd6d0]" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6 6 0 10-12 0v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
        </svg>
        {count > 0 && (
          <span className="absolute -top-1 -right-1 flex items-center justify-center w-4 h-4 rounded-full bg-rose-500 text-white text-[10px] font-bold leading-none">
            {count > 9 ? "9+" : count}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute left-0 top-10 z-50 w-80 rounded-lg border border-line bg-paper shadow-xl">
          <div className="flex items-center justify-between px-4 py-3 border-b border-line">
            <span className="text-sm font-semibold text-ink">Notifications</span>
            {count > 0 && (
              <button onClick={markAllRead} className="text-xs text-brand hover:underline">
                Mark all read
              </button>
            )}
          </div>
          <ul className="max-h-80 overflow-y-auto divide-y divide-line">
            {notifications.length === 0 && (
              <li className="px-4 py-6 text-center text-sm text-ink-soft">No notifications</li>
            )}
            {notifications.map((n) => (
              <li key={n.id}>
                <button
                  className={`w-full text-left px-4 py-3 hover:bg-paper-raised transition-colors ${!n.is_read ? "bg-brand/5" : ""}`}
                  onClick={() => markRead(n.id, n.link)}
                >
                  <div className="flex items-start gap-2">
                    {!n.is_read && <span className="mt-1.5 flex-shrink-0 w-2 h-2 rounded-full bg-brand" />}
                    <div className={!n.is_read ? "" : "ml-4"}>
                      <p className="text-sm font-medium text-ink leading-snug">{n.title}</p>
                      {n.body && <p className="text-xs text-ink-soft mt-0.5 line-clamp-2">{n.body}</p>}
                      {n.created_at && (
                        <p className="text-xs text-ink-soft/60 mt-1">
                          {new Date(n.created_at).toLocaleDateString()}
                        </p>
                      )}
                    </div>
                  </div>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Add NotificationBell to Sidebar header**

In `next-frontend/src/components/Sidebar.tsx`, add import at top:
```tsx
import NotificationBell from "@/components/NotificationBell";
```

Find the sidebar header div (around line 99–108):
```tsx
<div className="border-b border-white/10 p-6">
  <h2 className="font-display uppercase tracking-wide text-xl font-extrabold text-white">
    EJ Tracker
  </h2>
  {role && (
    <div className="mt-2 inline-block rounded border border-brand/40 bg-brand/20 px-2 py-1 text-xs font-medium text-[#9fd6d0]">
      {role}
    </div>
  )}
</div>
```

Replace with:
```tsx
<div className="border-b border-white/10 p-6">
  <div className="flex items-center justify-between">
    <h2 className="font-display uppercase tracking-wide text-xl font-extrabold text-white">
      EJ Tracker
    </h2>
    <NotificationBell />
  </div>
  {role && (
    <div className="mt-2 inline-block rounded border border-brand/40 bg-brand/20 px-2 py-1 text-xs font-medium text-[#9fd6d0]">
      {role}
    </div>
  )}
</div>
```

- [ ] **Step 3: Build check**

```bash
npm --prefix next-frontend run build
```

Expected: 0 TS errors, all routes compile.

- [ ] **Step 4: Dev server visual check**

```bash
npm --prefix next-frontend run dev
```

Open http://localhost:3000. Log in as any role. Confirm bell icon appears in sidebar header. Click — dropdown opens showing "No notifications". Badge hidden when count = 0.

- [ ] **Step 5: Commit**

```bash
git add next-frontend/src/components/NotificationBell.tsx next-frontend/src/components/Sidebar.tsx
git commit -m "feat: add NotificationBell with badge count to sidebar header"
```

---

## Task 9: Completion Flow UI (PM View in Projects Page)

**Files:**
- Modify: `next-frontend/src/app/(main)/projects/page.tsx`

**Interfaces:**
- Consumes: `GET /{id}/completion-preview`, `POST /{id}/completion-request` from backend; existing `Modal`, `Button`, `useToast` components

- [ ] **Step 1: Add state + types to projects/page.tsx**

At the top of `ProjectsList` component, add imports and state:

```tsx
import { Modal } from "@/components/ui";
import { useToast } from "@/components/ui/useToast";

// Add to ProjectRow interface:
// completion_request_status?: string | null;  // "pending" | "approved" | null

// Inside ProjectsList component, add:
const { showToast, ToastContainer } = useToast();
const [completionModal, setCompletionModal] = useState<{
  projectId: number;
  preview: {
    project_name: string;
    quotation_no: string;
    production_lines: number;
    part_processes: number;
    assembly_steps: number;
    final_checks: number;
  } | null;
} | null>(null);
const [submitting, setSubmitting] = useState(false);
const [userRole, setUserRole] = useState<string | null>(null);

// Add useEffect to read role:
useEffect(() => {
  setUserRole(localStorage.getItem("user_role"));
}, []);
```

- [ ] **Step 2: Add "Mark as Complete" button in expanded project row**

In the existing expanded row section of `projects/page.tsx`, after the existing action buttons (or at the end of the expanded row content), add:

```tsx
{userRole === "Production Manager" && (
  <div className="mt-4 pt-4 border-t border-line">
    {p.status === "Completed" ? (
      <span className="text-sm text-ink-soft">Project completed.</span>
    ) : p.completion_request_status === "pending" ? (
      <div className="flex items-center gap-2">
        <span className="inline-flex items-center gap-1.5 rounded border border-amber-300 bg-amber-50 px-3 py-1.5 text-sm text-amber-700">
          <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          Completion approval pending GM review — entries can still be logged.
        </span>
      </div>
    ) : (
      <Button
        variant="secondary"
        onClick={async () => {
          const API = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8003";
          const res = await apiFetch(`${API}/api/v1/projects/${p.id}/completion-preview`);
          if (res.ok) {
            const preview = await res.json();
            setCompletionModal({ projectId: p.id, preview });
          }
        }}
      >
        Mark as Complete
      </Button>
    )}
  </div>
)}
```

- [ ] **Step 3: Add completion checklist modal**

Before the closing `</div>` of the component return, add:

```tsx
<ToastContainer />

{completionModal && (
  <Modal
    open
    onClose={() => setCompletionModal(null)}
    title="Review Completion Checklist"
    description={`${completionModal.preview?.quotation_no} — ${completionModal.preview?.project_name}`}
    size="sm"
  >
    <div className="space-y-3">
      <p className="text-sm text-ink-soft">The following records will be marked complete upon GM approval:</p>
      <ul className="text-sm text-ink space-y-1">
        <li>Production lines: <span className="font-semibold">{completionModal.preview?.production_lines}</span></li>
        <li>Part processes: <span className="font-semibold">{completionModal.preview?.part_processes}</span></li>
        <li>Assembly steps: <span className="font-semibold">{completionModal.preview?.assembly_steps}</span></li>
        <li>Final checks: <span className="font-semibold">{completionModal.preview?.final_checks}</span></li>
      </ul>
      <p className="text-xs text-ink-soft border-t border-line pt-3">
        This cannot be undone after GM approval. A notification will be sent to GM for review.
      </p>
      <div className="flex gap-2 justify-end pt-1">
        <Button variant="secondary" onClick={() => setCompletionModal(null)}>Cancel</Button>
        <Button
          variant="primary"
          disabled={submitting}
          onClick={async () => {
            setSubmitting(true);
            const API = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8003";
            try {
              const res = await apiFetch(
                `${API}/api/v1/projects/${completionModal.projectId}/completion-request`,
                { method: "POST" }
              );
              if (res.ok) {
                showToast("Completion request sent to GM for approval.", "success");
                setCompletionModal(null);
                // refresh project list
                const r = await apiFetch(`${API}/api/v1/projects`);
                if (r.ok) setProjects((await r.json()).data || []);
              } else {
                const err = await res.json().catch(() => ({}));
                showToast(err.detail || "Failed to submit request.", "error");
              }
            } finally {
              setSubmitting(false);
            }
          }}
        >
          {submitting ? "Submitting…" : "Submit for Approval"}
        </Button>
      </div>
    </div>
  </Modal>
)}
```

- [ ] **Step 4: Update projects API response to include completion_request_status**

In `backend/app/projects/router.py`, find the `list_projects` endpoint (or wherever the projects list is returned). In the response dict for each project, add:

```python
from backend.services.db_service import ProjectCompletionRequest

# Inside the project list loop, add:
pending_req = db.query(ProjectCompletionRequest).filter_by(
    project_id=p.id, status="pending"
).first()
# Then in the response dict:
"completion_request_status": "pending" if pending_req else None,
```

- [ ] **Step 5: Build check**

```bash
npm --prefix next-frontend run build
```

Expected: 0 errors.

- [ ] **Step 6: Dev test — log in as PM, open All Projects, expand a row, confirm "Mark as Complete" button appears. Click it — confirm checklist modal shows counts.**

- [ ] **Step 7: Commit**

```bash
git add next-frontend/src/app/(main)/projects/page.tsx backend/app/projects/router.py
git commit -m "feat: add completion request flow UI to projects page (PM view)"
```

---

## Task 10: GM Approval Panel in Dashboard

**Files:**
- Modify: `next-frontend/src/app/(main)/dashboard/page.tsx`

**Interfaces:**
- Consumes: `GET /api/v1/projects/completion-requests/pending`, `POST /api/v1/projects/completion-requests/{id}/approve`, `POST /api/v1/projects/completion-requests/{id}/reject`

- [ ] **Step 1: Add state + types in dashboard/page.tsx**

Near the top of the dashboard component, add:

```tsx
import { Modal, Button } from "@/components/ui";
import { useToast } from "@/components/ui/useToast";

// Inside component:
const { showToast, ToastContainer } = useToast();
const [userRole, setUserRole] = useState<string | null>(null);
const [pendingRequests, setPendingRequests] = useState<Array<{
  id: number;
  project_id: number;
  project_name: string | null;
  quotation_no: string | null;
  requested_by: string;
  requested_at: string | null;
}>>([]);
const [rejectModal, setRejectModal] = useState<{ reqId: number; projectName: string | null } | null>(null);
const [rejectReason, setRejectReason] = useState("");
const [actionInProgress, setActionInProgress] = useState(false);

useEffect(() => {
  const role = localStorage.getItem("user_role");
  setUserRole(role);
  if (role === "GM" || role === "Developer") {
    fetchPendingRequests();
  }
}, []);

async function fetchPendingRequests() {
  const API = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8003";
  try {
    const res = await apiFetch(`${API}/api/v1/projects/completion-requests/pending`);
    if (res.ok) setPendingRequests(await res.json());
  } catch {}
}

async function handleApprove(reqId: number) {
  setActionInProgress(true);
  const API = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8003";
  try {
    const res = await apiFetch(`${API}/api/v1/projects/completion-requests/${reqId}/approve`, { method: "POST" });
    if (res.ok) {
      showToast("Project marked as complete.", "success");
      await fetchPendingRequests();
    } else {
      showToast("Failed to approve.", "error");
    }
  } finally {
    setActionInProgress(false);
  }
}

async function handleReject() {
  if (!rejectModal || !rejectReason.trim()) return;
  setActionInProgress(true);
  const API = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8003";
  try {
    const res = await apiFetch(
      `${API}/api/v1/projects/completion-requests/${rejectModal.reqId}/reject`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rejection_reason: rejectReason }),
      }
    );
    if (res.ok) {
      showToast("Completion request rejected.", "success");
      setRejectModal(null);
      setRejectReason("");
      await fetchPendingRequests();
    } else {
      showToast("Failed to reject.", "error");
    }
  } finally {
    setActionInProgress(false);
  }
}
```

- [ ] **Step 2: Add Pending Completions card to dashboard JSX**

In the dashboard JSX, before the main grid content, add (GM-only):

```tsx
<ToastContainer />

{(userRole === "GM" || userRole === "Developer") && pendingRequests.length > 0 && (
  <div className="mb-8">
    <h2 className="font-display text-lg font-bold text-ink mb-3 uppercase tracking-wide">
      Pending Completions
    </h2>
    <div className="flex flex-col gap-3">
      {pendingRequests.map((req) => (
        <div key={req.id} className="flex items-center justify-between rounded-lg border border-amber-200 bg-amber-50 px-4 py-3">
          <div>
            <p className="text-sm font-semibold text-ink">{req.quotation_no} — {req.project_name}</p>
            <p className="text-xs text-ink-soft mt-0.5">
              Requested by {req.requested_by}
              {req.requested_at ? ` on ${new Date(req.requested_at).toLocaleDateString()}` : ""}
            </p>
          </div>
          <div className="flex gap-2">
            <Button
              variant="secondary"
              onClick={() => setRejectModal({ reqId: req.id, projectName: req.project_name })}
              disabled={actionInProgress}
            >
              Reject
            </Button>
            <Button
              variant="primary"
              onClick={() => handleApprove(req.id)}
              disabled={actionInProgress}
            >
              Approve
            </Button>
          </div>
        </div>
      ))}
    </div>
  </div>
)}

{rejectModal && (
  <Modal
    open
    onClose={() => { setRejectModal(null); setRejectReason(""); }}
    title="Reject Completion Request"
    description={rejectModal.projectName ?? undefined}
    size="sm"
  >
    <div className="space-y-3">
      <label className="block text-sm text-ink font-medium">Reason for rejection</label>
      <textarea
        className="w-full rounded border border-line bg-paper-raised px-3 py-2 text-sm text-ink focus:outline-none focus:ring-2 focus:ring-brand resize-none"
        rows={3}
        value={rejectReason}
        onChange={(e) => setRejectReason(e.target.value)}
        placeholder="Explain why the completion request is being rejected…"
      />
      <div className="flex gap-2 justify-end">
        <Button variant="secondary" onClick={() => { setRejectModal(null); setRejectReason(""); }}>Cancel</Button>
        <Button
          variant="primary"
          disabled={!rejectReason.trim() || actionInProgress}
          onClick={handleReject}
        >
          {actionInProgress ? "Rejecting…" : "Reject"}
        </Button>
      </div>
    </div>
  </Modal>
)}
```

- [ ] **Step 3: Build check**

```bash
npm --prefix next-frontend run build
```

Expected: 0 errors.

- [ ] **Step 4: Dev test — log in as GM, confirm Pending Completions panel appears only if requests exist. Submit a request as PM first, then switch to GM to approve/reject.**

- [ ] **Step 5: Commit**

```bash
git add next-frontend/src/app/(main)/dashboard/page.tsx
git commit -m "feat: add GM completion approval panel to dashboard"
```

---

## Task 11: End-to-End Smoke Test + Railway Deploy

- [ ] **Step 1: Full flow test (dev environment)**

1. Log in as PM → All Projects → expand any Active project → click "Mark as Complete" → confirm checklist modal shows → submit
2. Log in as GM → Dashboard → confirm "Pending Completions" card appears → click Approve
3. Log in as PM → All Projects → confirm project status shows "Completed"
4. Check notification bell (GM should have seen request notification, PM should see approval notification)

- [ ] **Step 2: Build check**

```bash
npm --prefix next-frontend run build
python -m py_compile backend/services/email_service.py backend/services/notification_service.py backend/app/projects/completion.py backend/app/notifications/router.py
```

- [ ] **Step 3: Push to demo**

```bash
git push origin demo
```

- [ ] **Step 4: Add Railway env vars**

In Railway demo + main services, add:
- `SMTP_HOST=smtp.office365.com`
- `SMTP_PORT=587`
- `SMTP_USER=<org sender email>`
- `SMTP_PASS=<org sender password or app password>`
- `GM_EMAIL=<gm personal email>`
- `PM_EMAIL=<pm personal email>`

- [ ] **Step 5: Verify on Railway demo**

Repeat the flow test from Step 1 on the Railway demo URL. Confirm GM email arrives in inbox. Confirm PM rejection email arrives.

- [ ] **Step 6: Final commit if any fixes needed**

```bash
git add -p  # stage only relevant changes
git commit -m "fix: <describe fix>"
git push origin demo
```
