import pandas as pd
import sys
import os

# Add parent directory to path to import backend modules
sys.path.append(os.path.abspath(os.path.join(os.path.dirname(__file__), '..')))

from backend.services.db_service import engine, SessionLocal, Employee, Base
import re

def extract_years(exp_str):
    if pd.isna(exp_str):
        return 0
    match = re.search(r'(\d+)', str(exp_str))
    if match:
        return int(match.group(1))
    return 0

def import_employees(file_path):
    print("Creating tables if not exists...")
    Base.metadata.create_all(bind=engine)
    
    try:
        xl = pd.ExcelFile(file_path)
        session = SessionLocal()
        
        for sheet_name in xl.sheet_names:
            print(f"Processing sheet: {sheet_name}")
            df = xl.parse(sheet_name)
            
            for index, row in df.iterrows():
                if pd.isna(row.get('Employee Id')):
                    continue
                    
                emp_id = str(row['Employee Id']).strip()
                name = str(row['Name']).strip()
                
                # Check if exists
                emp = session.query(Employee).filter(Employee.emp_id == emp_id).first()
                if not emp:
                    emp = Employee(emp_id=emp_id)
                    session.add(emp)
                    
                emp.name = name
                emp.company = sheet_name.strip()
                
                # Skills
                emp.skill_1 = str(row['Skill-1']).strip() if pd.notna(row.get('Skill-1')) else None
                emp.skill_2 = str(row['Skill-2']).strip() if pd.notna(row.get('Skill-2')) else None
                emp.skill_3 = str(row['Skill-3']).strip() if pd.notna(row.get('Skill-3')) else None
                emp.skill_4 = str(row['Skill-4']).strip() if pd.notna(row.get('Skill-4')) else None
                
                # Experience and Target
                emp.experience_years = extract_years(row.get('Experience'))
                
                target = row.get('Target / Day')
                emp.target_per_day = float(target) if pd.notna(target) else 0.0
                
        session.commit()
        print("Import completed successfully!")
        
    except Exception as e:
        print("Error during import:", e)
        if 'session' in locals():
            session.rollback()

if __name__ == "__main__":
    file_path = os.path.join(os.path.dirname(__file__), '..', 'Employee Details - 29-06-2026.xlsx')
    import_employees(file_path)
