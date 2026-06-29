from pydantic import BaseModel
from typing import Optional

class UserCreate(BaseModel):
    full_name: str
    username: Optional[str] = None
    password: Optional[str] = None
    role: str = "Operator"
    experience: Optional[str] = None
    skill: Optional[str] = None
    department: Optional[str] = None
    base_productivity: Optional[float] = None
    access_modules: Optional[str] = "[]"

class UserPermissionsUpdate(BaseModel):
    access_modules: str
