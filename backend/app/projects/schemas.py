from pydantic import BaseModel
from typing import List, Optional
from datetime import date

class BellowItem(BaseModel):
    size: int
    qty: int
    type: Optional[str] = "EJ"

class ProjectCreate(BaseModel):
    quotation_no: str
    project_name: Optional[str] = None
    target_date: Optional[date] = None
    bellows: List[BellowItem] = []
    assigned_tig: Optional[int] = 0
    assigned_mig: Optional[int] = 0
    assigned_grinders: Optional[int] = 0

class ProjectUpdate(BaseModel):
    status: Optional[str] = None
    status_note: Optional[str] = None
    hold_type: Optional[str] = None
    hold_until_date: Optional[date] = None
    target_date: Optional[date] = None
    assigned_tig: Optional[int] = None
    assigned_mig: Optional[int] = None
    assigned_grinders: Optional[int] = None

class SimulationRequest(BaseModel):
    target_days: int
    bellows: List[BellowItem] = []

class DurationRequest(BaseModel):
    project_id: int
    assigned_tig: int
    assigned_mig: int
    assigned_grinders: int

class SimulateDurationRequest(BaseModel):
    bellows: List[BellowItem] = []
    assigned_tig: int
    assigned_mig: int
    assigned_grinders: int
