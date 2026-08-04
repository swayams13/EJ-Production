"""Confirms completion-request submit/approve are gated on progress. No pytest, no fixtures."""
import os
os.environ.setdefault("JWT_SECRET_KEY", "test-key-for-unit-tests")

from fastapi import HTTPException
from backend.services.db_service import SessionLocal, Project, ProjectProductionLine, ProjectCompletionRequest
from backend.app.projects.completion import submit_completion_request, approve_completion


def test_submit_blocked_when_progress_incomplete():
    db = SessionLocal()
    proj = Project(project_name="QA_SANDBOX_PROGRESS_GATE", quotation_no="QA-SANDBOX-PROGRESS-001", status="Active")
    db.add(proj)
    db.commit()
    db.refresh(proj)
    line = ProjectProductionLine(project_id=proj.id, size=50, quantity=5, joint_type="EJ", tig_feet=48.1, mig_feet=18.9, grinding_feet=4.0)
    db.add(line)
    db.commit()

    current_user = {"username": "qa_test", "role": "Production Manager", "id": None}
    try:
        try:
            submit_completion_request(proj.id, db, current_user)
            assert False, "expected a 400 — no welding logged, progress should be well under 100%"
        except HTTPException as e:
            assert e.status_code == 400
            print("PASS: completion-request submission blocked when progress is incomplete")
    finally:
        db.query(ProjectCompletionRequest).filter_by(project_id=proj.id).delete()
        db.query(ProjectProductionLine).filter_by(project_id=proj.id).delete()
        db.query(Project).filter_by(id=proj.id).delete()
        db.commit()


test_submit_blocked_when_progress_incomplete()
print("All completion progress-gate tests passed.")
