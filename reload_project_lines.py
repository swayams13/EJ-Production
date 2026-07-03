import os
import sys

sys.path.append(os.path.abspath("."))
from backend.services.db_service import get_db, ProjectProductionLine
from backend.services.production_service import get_welding_master_latest

def reload_projects():
    db = next(get_db())
    try:
        master_records = get_welding_master_latest()
        master_data = {(m.size, m.joint_type): m for m in master_records}
        
        lines = db.query(ProjectProductionLine).all()
        updated_count = 0
        
        for line in lines:
            size = line.size
            qty = line.quantity
            j_type = getattr(line, 'joint_type', 'EJ')
            
            m = master_data.get((size, j_type))
            if not m and j_type == 'DJ':
                m = master_data.get((size, 'EJ'))
                
            if m:
                if j_type == 'DJ':
                    new_tig = 0.0
                    new_mig = ((m.tig_feet or 0.0) + (m.mig_feet or 0.0)) * qty
                    new_grind = (m.grinding_feet or 0.0) * qty
                else:
                    new_tig = (m.tig_feet or 0.0) * qty
                    new_mig = (m.mig_feet or 0.0) * qty
                    new_grind = (m.grinding_feet or 0.0) * qty
                
                if line.tig_feet != new_tig or line.mig_feet != new_mig or line.grinding_feet != new_grind:
                    line.tig_feet = new_tig
                    line.mig_feet = new_mig
                    line.grinding_feet = new_grind
                    updated_count += 1

        db.commit()
        print(f"Successfully reloaded {updated_count} project production lines with live master values.")
    except Exception as e:
        db.rollback()
        print(f"Error reloading projects: {e}")
    finally:
        db.close()

if __name__ == "__main__":
    reload_projects()
