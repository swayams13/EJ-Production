import os
import jwt
from datetime import datetime, timedelta
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from passlib.context import CryptContext

from backend.services.db_service import get_db, User, AuditLog
from backend.app.auth.schemas import LoginRequest, RefreshRequest

router = APIRouter(prefix="/api/v1/auth", tags=["Auth"])

SECRET_KEY = os.getenv("JWT_SECRET_KEY")
if not SECRET_KEY:
    raise RuntimeError(
        "JWT_SECRET_KEY environment variable is not set. Refusing to start "
        "with a default secret — set it in .env / Railway variables."
    )
ALGORITHM = "HS256"
ACCESS_TOKEN_EXPIRE_MINUTES = 60 * 24  # 24h; refresh tokens handle re-auth
REFRESH_TOKEN_EXPIRE_DAYS = 30

pwd_context = CryptContext(schemes=["argon2"], deprecated="auto")

def create_access_token(data: dict, expires_delta: timedelta = None):
    to_encode = data.copy()
    to_encode["type"] = "access"
    if expires_delta:
        expire = datetime.utcnow() + expires_delta
    else:
        expire = datetime.utcnow() + timedelta(minutes=15)
    to_encode.update({"exp": expire})
    encoded_jwt = jwt.encode(to_encode, SECRET_KEY, algorithm=ALGORITHM)
    return encoded_jwt

def create_refresh_token(data: dict) -> str:
    to_encode = {**data, "type": "refresh", "exp": datetime.utcnow() + timedelta(days=REFRESH_TOKEN_EXPIRE_DAYS)}
    return jwt.encode(to_encode, SECRET_KEY, algorithm=ALGORITHM)

@router.post("/refresh")
def refresh(req: RefreshRequest, db: Session = Depends(get_db)):
    try:
        payload = jwt.decode(req.refresh_token, SECRET_KEY, algorithms=[ALGORITHM])
        if payload.get("type") != "refresh":
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid token type")
        username = payload.get("sub")
        role = payload.get("role")
        if not username or not role:
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid token")
    except jwt.PyJWTError:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid or expired refresh token")

    # Re-check current authorization from DB (stale-authorization fix).
    # Env-var users (DEV_USER, GM_USER, etc.) have no DB record; fall back to
    # token role for them — env-var changes require a restart which invalidates all tokens.
    db_user = db.query(User).filter(User.username == username).first()
    if db_user:
        role = db_user.role
    user_id = db_user.id if db_user else None

    try:
        db.add(AuditLog(
            user_id=user_id,
            username=username,
            action="TokenRefresh",
            table_name="auth",
            details=f"Access token refreshed for {username} (role: {role})",
        ))
        db.commit()
    except Exception as e:
        print(f"Failed to write refresh audit log: {e}")
        db.rollback()

    access_token = create_access_token(
        data={"sub": username, "role": role},
        expires_delta=timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES),
    )
    return {"access_token": access_token, "token_type": "bearer"}

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
    elif req.username == os.getenv("CEO_USER") and req.password == os.getenv("CEO_PASS"):
        role = "CEO"
    elif req.username == os.getenv("MD_USER") and req.password == os.getenv("MD_PASS"):
        role = "MD"

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
        
    # Log the successful login
    try:
        user_id = user.id if 'user' in locals() and user else None
        login_log = AuditLog(
            user_id=user_id,
            username=req.username,
            action="Login",
            table_name="auth",
            details=f"User {req.username} logged in with role {role}"
        )
        db.add(login_log)
        db.commit()
    except Exception as e:
        print(f"Failed to write audit log: {e}")
        db.rollback()
        
    access_token_expires = timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES)
    access_token = create_access_token(
        data={"sub": req.username, "role": role}, expires_delta=access_token_expires
    )
    refresh_token = create_refresh_token(data={"sub": req.username, "role": role})

    return {"access_token": access_token, "refresh_token": refresh_token, "token_type": "bearer", "role": role}
