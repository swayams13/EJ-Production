from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from backend.services.db_service import get_db, User
from backend.app.users.schemas import UserCreate, UserPermissionsUpdate
from passlib.context import CryptContext

pwd_context = CryptContext(schemes=["argon2"], deprecated="auto")
router = APIRouter(prefix="/api/v1/users", tags=["Users"])

from backend.app.auth.rbac import require_roles

@router.get("")
def get_users(db: Session = Depends(get_db), current_user: dict = Depends(require_roles(["Developer", "GM", "Admin", "Production Manager"]))):
    users = db.query(User).all()
    result = [{"id": u.id, "name": u.full_name, "role": u.role, "username": u.username, "experience": u.experience, "skill": u.skill, "department": u.department, "base_productivity": u.base_productivity, "access_modules": u.access_modules} for u in users]
    return {"success": True, "message": "Users retrieved", "data": result}

@router.post("")
def create_user(user: UserCreate, db: Session = Depends(get_db)):
    import uuid
    
    gen_username = user.username
    if not gen_username:
        slug = user.full_name.lower().replace(" ", "")[:10]
        gen_username = f"{slug}_{uuid.uuid4().hex[:6]}"
        
    gen_password = user.password or "shopfloor_no_login"

    existing = db.query(User).filter_by(username=gen_username).first()
    if existing:
        raise HTTPException(status_code=400, detail="Username already exists")
        
    hashed_pw = pwd_context.hash(gen_password)
    new_user = User(
        username=gen_username,
        full_name=user.full_name,
        hashed_password=hashed_pw,
        role=user.role,
        experience=user.experience,
        skill=user.skill,
        department=user.department,
        base_productivity=user.base_productivity,
        access_modules=user.access_modules
    )
    db.add(new_user)
    db.commit()
    return {"success": True, "message": "User created successfully", "data": {"id": new_user.id}}

@router.put("/{user_id}/permissions")
def update_user_permissions(user_id: int, req: UserPermissionsUpdate, db: Session = Depends(get_db), current_user: dict = Depends(require_roles(["Developer", "GM", "Admin"]))):
    user = db.query(User).filter_by(id=user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
        
    user.access_modules = req.access_modules
    db.commit()
    return {"success": True, "message": "Permissions updated successfully"}
