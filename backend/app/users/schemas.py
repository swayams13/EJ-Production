from pydantic import BaseModel

class UserCreate(BaseModel):
    username: str
    full_name: str
    password: str
    role: str = "Operator"
