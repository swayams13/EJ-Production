import os
import jwt
from datetime import datetime, timedelta
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from passlib.context import CryptContext

from backend.services.db_service import get_db, User
from backend.app.auth.schemas import LoginRequest

router = APIRouter(prefix="/api/v1/auth", tags=["Auth"])

SECRET_KEY = os.getenv("JWT_SECRET_KEY", "supersecretkey_for_ej_production")
ALGORITHM = "HS256"
ACCESS_TOKEN_EXPIRE_MINUTES = 60 * 24 # 1 day

pwd_context = CryptContext(schemes=["argon2"], deprecated="auto")

def create_access_token(data: dict, expires_delta: timedelta = None):
    to_encode = data.copy()
    if expires_delta:
        expire = datetime.utcnow() + expires_delta
    else:
        expire = datetime.utcnow() + timedelta(minutes=15)
    to_encode.update({"exp": expire})
    encoded_jwt = jwt.encode(to_encode, SECRET_KEY, algorithm=ALGORITHM)
    return encoded_jwt

@router.post("/login")
def login(req: LoginRequest, db: Session = Depends(get_db)):
    role = None
    
    # 1. Check hardcoded dev users first
    if req.username == os.getenv("DEV_USER") and req.password == os.getenv("DEV_PASS"):
        role = "Developer"
    elif req.username == os.getenv("GM_USER") and req.password == os.getenv("GM_PASS"):
        role = "GM"
    elif req.username == os.getenv("PM_USER") and req.password == os.getenv("PM_PASS"):
        role = "Production Manager"
        
    if not role:
        # 2. Check dynamic env users
        for key, value in os.environ.items():
            if key.endswith("_USER") and value == req.username:
                prefix = key[:-5]
                pass_key = f"{prefix}_PASS"
                if os.getenv(pass_key) == req.password:
                    role = "Admin"
                    break
                    
    if not role:
        # 3. Check DB users
        user = db.query(User).filter(User.username == req.username).first()
        if user and pwd_context.verify(req.password, user.hashed_password):
            role = user.role
            
    if not role:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Incorrect username or password",
            headers={"WWW-Authenticate": "Bearer"},
        )
        
    access_token_expires = timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES)
    access_token = create_access_token(
        data={"sub": req.username, "role": role}, expires_delta=access_token_expires
    )
    
    return {"access_token": access_token, "token_type": "bearer", "role": role}
