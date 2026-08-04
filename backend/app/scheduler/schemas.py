from pydantic import BaseModel, Field
from typing import Optional, List
from datetime import date, datetime


class EmployeeUpdate(BaseModel):
    skill_1: Optional[str] = None
    skill_2: Optional[str] = None
    skill_3: Optional[str] = None
    skill_4: Optional[str] = None
    target_per_day: Optional[float] = None
    experience_years: Optional[int] = None
    active: Optional[bool] = None


class SimpleUser(BaseModel):
    id: int
    full_name: Optional[str] = None
    base_productivity: Optional[float] = None

    class Config:
        orm_mode = True


class SimpleProject(BaseModel):
    id: int
    quotation_no: str

    class Config:
        orm_mode = True


class SimplePartProcess(BaseModel):
    id: int
    process_name: str
    status: str

    class Config:
        orm_mode = True


class SimpleProductionLine(BaseModel):
    id: int
    size: Optional[int] = None
    joint_type: Optional[str] = None

    class Config:
        orm_mode = True


class SimplePartWithProcesses(BaseModel):
    id: int
    name: str
    production_line: Optional[SimpleProductionLine] = None
    processes: List[SimplePartProcess] = []

    class Config:
        orm_mode = True


# ── WorkOrder schemas ──────────────────────────────────────────────────────────

class TaskAssignmentCreate(BaseModel):
    """Legacy schema kept for existing /assignments endpoint."""
    project_id: int
    user_id: int
    process_type: str
    date: date
    target_feet: float
    status: Optional[str] = "Pending"
    is_overtime: Optional[bool] = False
    notes: Optional[str] = None


class TaskAssignmentResponse(BaseModel):
    """Legacy schema kept for existing /assignments endpoint."""
    id: int
    project_id: int
    user_id: int
    process_type: str
    date: date
    target_feet: float
    status: str
    is_overtime: bool
    notes: Optional[str]
    created_at: datetime
    user: Optional[SimpleUser] = None
    project: Optional[SimpleProject] = None

    class Config:
        orm_mode = True


class WorkOrderResponse(BaseModel):
    id: int
    project_id: int
    user_id: int
    part_id: Optional[int] = None
    date: date
    process_type: str
    target_feet: float
    actual_feet: Optional[float] = None
    is_overtime: bool
    status: str
    completed_part_process_id: Optional[int] = None
    notes: Optional[str] = None
    created_at: datetime
    user: Optional[SimpleUser] = None
    project: Optional[SimpleProject] = None
    part: Optional[SimplePartWithProcesses] = None

    class Config:
        orm_mode = True


class WorkOrderComplete(BaseModel):
    actual_feet: float = Field(ge=0)
    status: str = "Completed"
    mark_step_ready: bool = False
    part_process_id: Optional[int] = None
    notes: Optional[str] = None


# ── ChangeRequest schemas ──────────────────────────────────────────────────────

class ChangeRequestCreate(BaseModel):
    subject_type: str          # "daily_plan_override" | "employee_profile"
    subject_id: Optional[int] = None
    target_date: Optional[date] = None
    changes_json: str          # JSON string


class ChangeRequestResponse(BaseModel):
    id: int
    subject_type: str
    subject_id: Optional[int] = None
    target_date: Optional[date] = None
    proposed_by: Optional[int] = None
    proposed_by_username: Optional[str] = None
    approved_by: Optional[int] = None
    approved_by_username: Optional[str] = None
    status: str
    changes_json: str
    rejection_note: Optional[str] = None
    created_at: datetime
    resolved_at: Optional[datetime] = None
    proposer: Optional[SimpleUser] = None

    class Config:
        orm_mode = True


class ChangeRequestReject(BaseModel):
    rejection_note: str
