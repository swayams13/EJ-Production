# test_delete_project_cascades.py
"""Confirms deleting a project with material_holds/job_final_checks/assembly_steps/completion_requests/work_orders doesn't 500. No pytest, no fixtures."""
from datetime import date
from backend.services.db_service import (
    SessionLocal, Project, ProjectProductionLine, MaterialHold,
    JobFinalCheck, AssemblyStep, ProjectCompletionRequest, WorkOrder,
)
from backend.app.projects.router import delete_project
from fastapi import HTTPException


def test_delete_project_with_dependent_rows():
    db = SessionLocal()
    proj = Project(project_name="QA_SANDBOX_CASCADE_TEST", quotation_no="QA-SANDBOX-CASCADE-001", status="Active")
    db.add(proj)
    db.commit()
    db.refresh(proj)

    line = ProjectProductionLine(project_id=proj.id, size=50, quantity=1, joint_type="EJ")
    db.add(line)
    db.commit()
    db.refresh(line)

    db.add(MaterialHold(project_id=proj.id, material_name="QA_SANDBOX_MAT", size=50, joint_type="EJ", status="active"))
    db.add(JobFinalCheck(production_line_id=line.id, check_type="testing", status="pending"))
    db.add(AssemblyStep(production_line_id=line.id, step_no=1, label="QA_SANDBOX step"))
    db.add(ProjectCompletionRequest(project_id=proj.id, requested_by="qa_test"))
    db.add(WorkOrder(project_id=proj.id, date=date.today(), process_type="TIG", target_feet=10.0, status="Pending"))
    db.commit()

    current_user = {"username": "qa_test", "role": "Developer", "id": None}
    try:
        result = delete_project(proj.id, db, current_user)
        assert result["success"] is True
        assert db.query(Project).filter_by(id=proj.id).first() is None
        assert db.query(MaterialHold).filter_by(project_id=proj.id).count() == 0
        assert db.query(WorkOrder).filter_by(project_id=proj.id).count() == 0
        print("PASS: project with material_holds/job_final_checks/assembly_steps/completion_requests/work_orders deletes cleanly")
    except HTTPException as e:
        raise AssertionError(f"delete_project raised {e.status_code}: {e.detail}") from e


test_delete_project_with_dependent_rows()
print("All delete_project cascade tests passed.")
