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

class SimpleUser(BaseModel):
    id: int
    full_name: Optional[str]
    base_productivity: Optional[float] = None
    
    class Config:
        orm_mode = True

class SimpleProject(BaseModel):
    id: int
    quotation_no: str
    
    class Config:
        orm_mode = True

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
    
    user: Optional[SimpleUser] = None
    project: Optional[SimpleProject] = None
    
    class Config:
        orm_mode = True
