from pydantic import BaseModel
from typing import Optional, List
from datetime import date, datetime

class TaskAssignmentCreate(BaseModel):
    project_id: int
    user_id: int
    process_type: str
    date: date
    target_feet: float
    status: Optional[str] = "Pending"
    is_overtime: Optional[bool] = False
    notes: Optional[str] = None

class TaskAssignmentResponse(BaseModel):
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
    
    class Config:
        orm_mode = True
