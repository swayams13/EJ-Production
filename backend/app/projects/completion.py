import os
import logging
from datetime import datetime
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from backend.services.db_service import (
    get_db, Project, ProjectProductionLine, Part, PartProcess,
    AssemblyStep, JobFinalCheck, ProjectCompletionRequest,
)
from backend.app.auth.rbac import require_roles
from backend.services.notification_service import create_notification
from backend.services.email_service import send_system_email_async as send_system_email

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/v1/projects", tags=["Completion"])

GM_EMAIL = os.getenv("GM_EMAIL", "")
PM_EMAIL = os.getenv("PM_EMAIL", "")
FRONTEND_BASE = os.getenv("FRONTEND_ORIGINS", "http://localhost:3000").split(",")[0]


class RejectBody(BaseModel):
    rejection_reason: str


def _get_project_or_404(project_id: int, db: Session):
    proj = db.query(Project).filter(Project.id == project_id).first()
    if not proj:
        raise HTTPException(status_code=404, detail="Project not found")
    return proj


# ── PM Endpoints ──────────────────────────────────────────────────────────────

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
        f"{user['username']} has submitted a completion request for project: {proj.project_name} ({proj.quotation_no}).\n\nLog in to approve or reject: {FRONTEND_BASE}/dashboard",
    )

    return {"id": req.id, "status": req.status}


# ── GM Endpoints ──────────────────────────────────────────────────────────────

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
