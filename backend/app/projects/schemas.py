

from pydantic import BaseModel
from typing import List, Optional, Dict
from datetime import date

class BellowItem(BaseModel):
    size: int
    qty: int
    type: Optional[str] = "EJ"
    pn_rating: Optional[str] = None
    joint_category: Optional[str] = None
    joint_type_code: Optional[str] = None
    variable_qtys: Optional[Dict[str, float]] = None

class ProjectCreate(BaseModel):
    quotation_no: str
    project_name: Optional[str] = None
    target_date: Optional[date] = None
    payroll: Optional[str] = "Company"
    bellows: List[BellowItem] = []
    assigned_tig: Optional[int] = 0
    assigned_mig: Optional[int] = 0
    assigned_grinders: Optional[int] = 0
    priority: Optional[str] = None           # P1 | P2 | P3
    order_value: Optional[float] = None
    advance_received: Optional[float] = 0.0
    committed_dispatch_date: Optional[date] = None

class ProjectUpdate(BaseModel):
    status: Optional[str] = None
    status_note: Optional[str] = None
    hold_type: Optional[str] = None
    hold_until_date: Optional[date] = None
    target_date: Optional[date] = None
    payroll: Optional[str] = None
    assigned_tig: Optional[int] = None
    assigned_mig: Optional[int] = None
    assigned_grinders: Optional[int] = None
    priority: Optional[str] = None
    order_value: Optional[float] = None
    advance_received: Optional[float] = None
    committed_dispatch_date: Optional[date] = None

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
