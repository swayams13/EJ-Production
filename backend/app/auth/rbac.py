from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
import jwt
import os

from backend.app.auth.router import SECRET_KEY, ALGORITHM

security = HTTPBearer()

def get_current_user(credentials: HTTPAuthorizationCredentials = Depends(security)):
    token = credentials.credentials
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        username: str = payload.get("sub")
        role: str = payload.get("role")
        if username is None or role is None:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Could not validate credentials",
                headers={"WWW-Authenticate": "Bearer"},
            )
        return {"username": username, "role": role}
    except jwt.PyJWTError:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Could not validate credentials",
            headers={"WWW-Authenticate": "Bearer"},
        )

# Role groups — the confirmed role matrix (2026-07-13). Use these instead of
# ad-hoc lists so the matrix lives in one place.
# Workers/Operators have NO API access: they don't log in; supervisors enter
# progress on their behalf (entries carry operator_id for attribution).
MANAGEMENT = ["Developer", "GM", "Admin", "Production Manager"]
SUPERVISORS = MANAGEMENT + ["Supervisor"]
USER_ADMINS = ["Developer", "GM", "Production Manager"]

def require_roles(allowed_roles: list[str]):
    def role_checker(user: dict = Depends(get_current_user)):
        role = user["role"]
        # Employees synced from Excel get role "Operator"; endpoint role lists
        # historically say "Worker". Treat them as the same role.
        if role == "Operator":
            role = "Worker"
        if role not in allowed_roles:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Operation not permitted"
            )
        return user
    return role_checker
