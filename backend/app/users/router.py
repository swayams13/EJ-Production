from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from backend.services.db_service import get_db, User
from backend.app.users.schemas import UserCreate, UserUpdate
from passlib.context import CryptContext

pwd_context = CryptContext(schemes=["argon2"], deprecated="auto")
router = APIRouter(prefix="/api/v1/users", tags=["Users"])

from backend.app.auth.rbac import require_roles

@router.get("")
def get_users(db: Session = Depends(get_db), current_user: dict = Depends(require_roles(["Developer", "GM", "Admin", "Production Manager"]))):
    users = db.query(User).all()
    result = [{"id": u.id, "name": u.full_name, "role": u.role, "username": u.username, "experience": u.experience, "skill": u.skill, "department": u.department, "base_productivity": u.base_productivity} for u in users]
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
        base_productivity=user.base_productivity
    )
    db.add(new_user)
    db.commit()
    return {"success": True, "message": "User created successfully", "data": {"id": new_user.id}}

@router.put("/{user_id}")
def update_user(user_id: int, req: UserUpdate, db: Session = Depends(get_db)):
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
        
    if req.full_name is not None:
        user.full_name = req.full_name
    if req.role is not None:
        user.role = req.role
    if req.department is not None:
        user.department = req.department
    if req.skill is not None:
        user.skill = req.skill
    if req.experience is not None:
        user.experience = req.experience
    if req.base_productivity is not None:
        user.base_productivity = req.base_productivity
    if req.password:
        user.hashed_password = pwd_context.hash(req.password)
        
    db.commit()
    return {"success": True, "message": "User updated successfully"}

@router.delete("/{user_id}")
def delete_user(user_id: int, db: Session = Depends(get_db)):
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
        
    try:
        from backend.services.db_service import WeldingLog, ProductionLog, AttendanceLog
        # Nullify references so historical production logs aren't deleted when an operator is removed
        db.query(WeldingLog).filter(WeldingLog.operator_id == user.id).update({WeldingLog.operator_id: None})
        db.query(ProductionLog).filter(ProductionLog.operator_id == user.id).update({ProductionLog.operator_id: None})
        
        # Delete attendance logs since user_id is non-nullable and they are hard-deleting the user
        db.query(AttendanceLog).filter(AttendanceLog.user_id == user.id).delete(synchronize_session=False)
        
        db.delete(user)
        db.commit()
        return {"success": True, "message": "User deleted successfully"}
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=400, detail=f"Cannot delete user: {str(e)}")
