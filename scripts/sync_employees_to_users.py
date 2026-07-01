import os
import sys

sys.path.append(os.path.abspath(os.path.join(os.path.dirname(__file__), '..')))

from backend.services.db_service import SessionLocal, Employee, User
from passlib.context import CryptContext

pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")

def sync_employees():
    session = SessionLocal()
    try:
        employees = session.query(Employee).all()
        added_count = 0
        updated_count = 0
        
        for emp in employees:
            # Map emp_id to username
            username = emp.emp_id.lower()
            
            user = session.query(User).filter(User.username == username).first()
            if not user:
                user = User(
                    username=username,
                    hashed_password=pwd_context.hash("operator123"), # Default password
                    role="Operator"
                )
                session.add(user)
                added_count += 1
            else:
                updated_count += 1
                
            user.full_name = emp.name
            user.skill = emp.skill_1 # Map primary skill
            user.base_productivity = emp.target_per_day
            
        session.commit()
        print(f"Sync complete. Added {added_count} users, Updated {updated_count} users.")
    except Exception as e:
        print(f"Error: {e}")
        session.rollback()
    finally:
        session.close()

if __name__ == "__main__":
    sync_employees()
