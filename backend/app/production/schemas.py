from pydantic import BaseModel, Field
from typing import Optional

class TransactionCreate(BaseModel):
    operator_id: Optional[int] = None
    quantity_completed: int = Field(gt=0)
    feet_completed: Optional[float] = Field(default=None, ge=0)

class WeldingLogCreate(BaseModel):
    operator_id: Optional[int] = None
    process_type: str # TIG, MIG, Grinding
    feet_done: float = Field(gt=0)
