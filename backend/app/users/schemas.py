from pydantic import BaseModel
from typing import Optional

class UserCreate(BaseModel):
    username: str
    full_name: str
    password: str
    role: str = "Operator"
    experience: Optional[str] = None
    skill: Optional[str] = None
    department: Optional[str] = None
    base_productivity: Optional[float] = None
