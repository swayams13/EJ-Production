from pydantic import BaseModel, Field
from typing import Optional, Literal
from datetime import date

class TransactionCreate(BaseModel):
    operator_id: Optional[int] = None
    quantity_completed: int = Field(gt=0)
    feet_completed: Optional[float] = Field(default=None, ge=0)
    date_ready: Optional[date] = None
    po_number: Optional[str] = None

class FinalCheckUpdate(BaseModel):
    is_required: Optional[bool] = None
    status: Optional[Literal["pending", "required", "in_process", "ready"]] = None
    test_method: Optional[str] = None
    paint_spec: Optional[str] = None
    weight_kgs: Optional[float] = None
    marking_type: Optional[str] = None
    date_ready: Optional[date] = None
    date_pending: Optional[date] = None
    notes: Optional[str] = None

class WeldingLogCreate(BaseModel):
    operator_id: int          # required — must match a work order for today
    process_type: str         # TIG | MIG | Grinding
    feet_done: float = Field(gt=0)
