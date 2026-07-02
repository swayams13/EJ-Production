from backend.services.db_service import SessionLocal
from sqlalchemy import text
from backend.services.production_service import import_welding_master_from_disk

def fix_and_import():
    session = SessionLocal()
    try:
        session.execute(text("SELECT setval('welding_master_id_seq', COALESCE((SELECT MAX(id)+1 FROM welding_master), 1), false);"))
        session.commit()
        print("Sequence updated successfully.")
    except Exception as e:
        print("Error updating sequence:", e)
        session.rollback()
    finally:
        session.close()
        
    print(import_welding_master_from_disk())

if __name__ == "__main__":
    fix_and_import()
