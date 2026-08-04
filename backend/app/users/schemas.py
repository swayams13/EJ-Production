from pydantic import BaseModel, Field
from typing import Optional, Literal

KNOWN_ROLES = Literal["Developer", "GM", "Production Manager", "CEO", "MD", "Admin", "Supervisor", "Operator"]

class UserCreate(BaseModel):
    full_name: str = Field(max_length=200)
    username: Optional[str] = Field(default=None, max_length=100)
    password: Optional[str] = None
    role: KNOWN_ROLES = "Operator"
    experience: Optional[str] = None
    skill: Optional[str] = None
    department: Optional[str] = None
    base_productivity: Optional[float] = None

class UserUpdate(BaseModel):
    full_name: Optional[str] = Field(default=None, max_length=200)
    password: Optional[str] = None
    role: Optional[KNOWN_ROLES] = None
    experience: Optional[str] = None
    skill: Optional[str] = None
    department: Optional[str] = None
    base_productivity: Optional[float] = None
