from pydantic import BaseModel
from typing import Optional

class TransactionCreate(BaseModel):
    operator_id: int
    quantity_completed: int
    feet_completed: Optional[float] = None
