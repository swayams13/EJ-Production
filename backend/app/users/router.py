from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from backend.services.db_service import get_db, User
from backend.app.users.schemas import UserCreate
from passlib.context import CryptContext

pwd_context = CryptContext(schemes=["argon2"], deprecated="auto")
router = APIRouter(prefix="/api/v1/users", tags=["Users"])

@router.get("")
def get_users(db: Session = Depends(get_db)):
    users = db.query(User).all()
    result = [{"id": u.id, "name": u.full_name, "role": u.role, "username": u.username} for u in users]
    return {"success": True, "message": "Users retrieved", "data": result}

@router.post("")
def create_user(user: UserCreate, db: Session = Depends(get_db)):
    existing = db.query(User).filter_by(username=user.username).first()
    if existing:
        raise HTTPException(status_code=400, detail="Username already exists")
        
    hashed_pw = pwd_context.hash(user.password)
    new_user = User(
        username=user.username,
        full_name=user.full_name,
        hashed_password=hashed_pw,
        role=user.role
    )
    db.add(new_user)
    db.commit()
    return {"success": True, "message": "User created successfully", "data": {"id": new_user.id}}
