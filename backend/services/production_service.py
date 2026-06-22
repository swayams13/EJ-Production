import pandas as pd
import io
from backend.services.db_service import SessionLocal, WeldingMaster, ProjectProductionLine, Project, WorkforceMaster, ProjectResourceAssignment, CompanyResourcePool
import math
import datetime

def import_welding_master_from_disk():
    try:
        file_path = "BELLOWS WELDING FEETS PER SIZE - 20.6.2026.xlsx"
        df = pd.read_excel(file_path, header=2) # The real headers are on row index 2
        df.columns = [str(c).strip().lower().replace(" ", "_") for c in df.columns]
        
        session = SessionLocal()
        try:
            # Determine new version
            latest = session.query(WeldingMaster).order_by(WeldingMaster.version.desc()).first()
            new_version = (latest.version + 1) if latest else 1
            
            # Identify columns using substring matching
            col_size = next((c for c in df.columns if 'size' in c), None)
            col_tig_in = next((c for c in df.columns if 'tig' in c and 'inch' in c), None)
            col_tig_ft = next((c for c in df.columns if 'tig' in c and 'feet' in c), None)
            col_mig_in = next((c for c in df.columns if 'mig' in c and 'inch' in c), None)
            col_mig_ft = next((c for c in df.columns if 'mig' in c and 'feet' in c), None)
            col_tot_in = next((c for c in df.columns if 'total' in c and 'inch' in c), None)
            col_tot_ft = next((c for c in df.columns if 'total' in c and 'feet' in c), None)
            col_grind = next((c for c in df.columns if 'grinding' in c), None)
            
            if not col_size:
                return False, "Could not find Size column"
                
            inserted_count = 0
            # Prevent duplicates in the same version by keeping track of sizes
            seen_sizes = set()
            
            for _, row in df.iterrows():
                try:
                    size = int(float(row[col_size]))
                except (ValueError, TypeError):
                    continue
                    
                if size in seen_sizes:
                    continue
                seen_sizes.add(size)
                
                tig_in = int(round(float(row.get(col_tig_in, 0)) if col_tig_in else 0))
                tig_ft = int(round(float(row.get(col_tig_ft, 0)) if col_tig_ft else 0))
                mig_in = int(round(float(row.get(col_mig_in, 0)) if col_mig_in else 0))
                mig_ft = int(round(float(row.get(col_mig_ft, 0)) if col_mig_ft else 0))
                tot_in = int(round(float(row.get(col_tot_in, 0)) if col_tot_in else 0))
                tot_ft = int(round(float(row.get(col_tot_ft, 0)) if col_tot_ft else 0))
                grind = round(float(row.get(col_grind, 0)) if col_grind else 0, 2)
                
                wm = WeldingMaster(
                    size=size,
                    tig_inches=tig_in,
                    tig_feet=tig_ft,
                    mig_inches=mig_in,
                    mig_feet=mig_ft,
                    total_welding_inches=tot_in,
                    total_welding_feet=tot_ft,
                    grinding_feet=grind,
                    version=new_version
                )
                session.add(wm)
                inserted_count += 1
                
            session.commit()
            return True, f"Successfully imported {inserted_count} records. Version: {new_version}"
        except Exception as e:
            session.rollback()
            return False, f"Database error: {e}"
        finally:
            session.close()
    except Exception as e:
        return False, f"Error parsing Excel file: {e}"

def get_welding_master_latest():
    session = SessionLocal()
    try:
        latest = session.query(WeldingMaster).order_by(WeldingMaster.version.desc()).first()
        if not latest:
            return []
        v = latest.version
        return session.query(WeldingMaster).filter(WeldingMaster.version == v).order_by(WeldingMaster.size).all()
    finally:
        session.close()

def sync_project_production_lines(project_id, sizes_and_qtys):
    """
    sizes_and_qtys: list of dicts {"size": int, "qty": int}
    Syncs the production lines for a project based on the latest welding master.
    """
    session = SessionLocal()
    try:
        # Get latest welding master data
        master_data = {m.size: m for m in get_welding_master_latest()}
        
        # Clear existing
        session.query(ProjectProductionLine).filter(ProjectProductionLine.project_id == project_id).delete()
        
        lines = []
        for item in sizes_and_qtys:
            size = item['size']
            qty = item['qty']
            m = master_data.get(size)
            if m:
                lines.append(ProjectProductionLine(
                    project_id=project_id,
                    size=size,
                    quantity=qty,
                    tig_feet=m.tig_feet * qty,
                    mig_feet=m.mig_feet * qty,
                    grinding_feet=m.grinding_feet * qty
                ))
            else:
                lines.append(ProjectProductionLine(
                    project_id=project_id,
                    size=size,
                    quantity=qty,
                    tig_feet=0,
                    mig_feet=0,
                    grinding_feet=0
                ))
        
        if lines:
            session.add_all(lines)
        session.commit()
        return True
    except Exception as e:
        session.rollback()
        return False
    finally:
        session.close()

def calculate_project_duration(project_id, tig_welders, mig_welders, grinders):
    session = SessionLocal()
    try:
        lines = session.query(ProjectProductionLine).filter(ProjectProductionLine.project_id == project_id).all()
        tot_tig = sum(l.tig_feet for l in lines)
        tot_mig = sum(l.mig_feet for l in lines)
        tot_grind = sum(l.grinding_feet for l in lines)
        
        workforce = session.query(WorkforceMaster).all()
        prod = {w.resource_type: w.avg_productivity_per_day for w in workforce}
        
        tig_prod = prod.get("TIG Welder", 180)
        mig_prod = prod.get("MIG Welder", 120)
        grind_prod = prod.get("Grinder", 80)
        
        tig_days = math.ceil(tot_tig / (tig_welders * tig_prod)) if tig_welders > 0 and tig_prod > 0 else (math.ceil(tot_tig) if tot_tig > 0 else 0)
        mig_days = math.ceil(tot_mig / (mig_welders * mig_prod)) if mig_welders > 0 and mig_prod > 0 else (math.ceil(tot_mig) if tot_mig > 0 else 0)
        grind_days = math.ceil(tot_grind / (grinders * grind_prod)) if grinders > 0 and grind_prod > 0 else (math.ceil(tot_grind) if tot_grind > 0 else 0)
        
        duration = max(tig_days, mig_days, grind_days)
        
        # Save assignment
        assignment = session.query(ProjectResourceAssignment).filter(ProjectResourceAssignment.project_id == project_id).first()
        if not assignment:
            assignment = ProjectResourceAssignment(project_id=project_id)
            session.add(assignment)
            
        assignment.assigned_tig_welders = tig_welders
        assignment.assigned_mig_welders = mig_welders
        assignment.assigned_grinders = grinders
        assignment.estimated_duration_days = duration
        
        session.commit()
        return duration, tot_tig, tot_mig, tot_grind
    finally:
        session.close()

def calculate_required_resources_for_deadline(project_id, target_days):
    session = SessionLocal()
    try:
        lines = session.query(ProjectProductionLine).filter(ProjectProductionLine.project_id == project_id).all()
        tot_tig = sum(l.tig_feet for l in lines)
        tot_mig = sum(l.mig_feet for l in lines)
        tot_grind = sum(l.grinding_feet for l in lines)
        
        workforce = session.query(WorkforceMaster).all()
        prod = {w.resource_type: w.avg_productivity_per_day for w in workforce}
        
        tig_prod = prod.get("TIG Welder", 180)
        mig_prod = prod.get("MIG Welder", 120)
        grind_prod = prod.get("Grinder", 80)
        
        effective_target_days = max(1, target_days)
        req_tig = math.ceil(tot_tig / (effective_target_days * tig_prod)) if tig_prod > 0 else 0
        req_mig = math.ceil(tot_mig / (effective_target_days * mig_prod)) if mig_prod > 0 else 0
        req_grind = math.ceil(tot_grind / (effective_target_days * grind_prod)) if grind_prod > 0 else 0
        
        return req_tig, req_mig, req_grind
    finally:
        session.close()

def get_company_capacity_status(target_days=15):
    session = SessionLocal()
    try:
        # Aggregation of all projects (Exclude completed projects)
        projects = session.query(Project).filter((Project.status != "Completed") | (Project.status == None)).all()
        tot_tig = 0.0
        tot_mig = 0.0
        tot_grind = 0.0
        
        active_projects_count = 0
        
        # Get Productivity
        workforce = session.query(WorkforceMaster).all()
        prod = {w.resource_type: w.avg_productivity_per_day for w in workforce}
        tig_prod = prod.get("TIG Welder", 180)
        mig_prod = prod.get("MIG Welder", 120)
        grind_prod = prod.get("Grinder", 80)
        
        req_tig_welders = 0
        req_mig_welders = 0
        req_grind_welders = 0
        
        for p in projects:
            lines = session.query(ProjectProductionLine).filter(ProjectProductionLine.project_id == p.id).all()
            if lines:
                active_projects_count += 1
                proj_tig = sum(l.tig_feet for l in lines)
                proj_mig = sum(l.mig_feet for l in lines)
                proj_grind = sum(l.grinding_feet for l in lines)
                
                tot_tig += proj_tig
                tot_mig += proj_mig
                tot_grind += proj_grind
                
                assignment = session.query(ProjectResourceAssignment).filter(ProjectResourceAssignment.project_id == p.id).first()
                proj_target_days = assignment.target_days if assignment and assignment.target_days else target_days
                
                req_tig_welders += math.ceil(proj_tig / (proj_target_days * tig_prod)) if proj_target_days > 0 and tig_prod > 0 else 0
                req_mig_welders += math.ceil(proj_mig / (proj_target_days * mig_prod)) if proj_target_days > 0 and mig_prod > 0 else 0
                req_grind_welders += math.ceil(proj_grind / (proj_target_days * grind_prod)) if proj_target_days > 0 and grind_prod > 0 else 0
                
        # Get Company Resource Pool
        pool = session.query(CompanyResourcePool).first()
        if not pool:
            pool = CompanyResourcePool(total_tig_welders=0, total_mig_welders=0, total_grinders=0)
            
        # Daily Capacity
        daily_tig = pool.total_tig_welders * tig_prod
        daily_mig = pool.total_mig_welders * mig_prod
        daily_grind = pool.total_grinders * grind_prod
        
        return {
            "active_projects": active_projects_count,
            "pending_tig": tot_tig,
            "pending_mig": tot_mig,
            "pending_grind": tot_grind,
            "pool": {
                "tig": pool.total_tig_welders,
                "mig": pool.total_mig_welders,
                "grinders": pool.total_grinders,
            },
            "required": {
                "tig": int(req_tig_welders),
                "mig": int(req_mig_welders),
                "grinders": int(req_grind_welders)
            },
            "shortage": {
                "tig": max(0, int(req_tig_welders) - pool.total_tig_welders),
                "mig": max(0, int(req_mig_welders) - pool.total_mig_welders),
                "grinders": max(0, int(req_grind_welders) - pool.total_grinders)
            }
        }
    finally:
        session.close()

def generate_master_production_register_excel(target_days=15):
    session = SessionLocal()
    try:
        projects = session.query(Project).all()
        data = []
        for p in projects:
            lines = session.query(ProjectProductionLine).filter(ProjectProductionLine.project_id == p.id).all()
            assignment = session.query(ProjectResourceAssignment).filter(ProjectResourceAssignment.project_id == p.id).first()
            
            tot_tig = sum(l.tig_feet for l in lines)
            tot_mig = sum(l.mig_feet for l in lines)
            tot_grind = sum(l.grinding_feet for l in lines)
            
            if lines or assignment:
                req_tig, req_mig, req_grind = 0, 0, 0
                if assignment and assignment.target_date:
                    target_days = (assignment.target_date.date() - datetime.datetime.utcnow().date()).days
                    req_tig, req_mig, req_grind = calculate_required_resources_for_deadline(p.id, target_days)
                        
                data.append({
                    "Project No": p.quotation_no,
                    "Project Status": "Active",
                    "Total TIG Feet": tot_tig,
                    "Total MIG Feet": tot_mig,
                    "Total Grinding Feet": tot_grind,
                    "Required TIG Welders": req_tig,
                    "Required MIG Welders": req_mig,
                    "Required Grinders": req_grind,
                    "Assigned TIG Welders": assignment.assigned_tig_welders if assignment else 0,
                    "Assigned MIG Welders": assignment.assigned_mig_welders if assignment else 0,
                    "Assigned Grinders": assignment.assigned_grinders if assignment else 0,
                    "Estimated Duration (Days)": assignment.estimated_duration_days if assignment else 0,
                    "Deadline Date": assignment.target_date.strftime("%d/%m/%Y") if assignment and assignment.target_date else ""
                })
        df_projects = pd.DataFrame(data)
        
        # Also include company summary
        status = get_company_capacity_status(target_days)
        summary_data = [
            {"Metric": "Target Completion Days", "Value": target_days},
            {"Metric": "Active Projects", "Value": status["active_projects"]},
            {"Metric": "Pending TIG Feet", "Value": round(status["pending_tig"], 2)},
            {"Metric": "Pending MIG Feet", "Value": round(status["pending_mig"], 2)},
            {"Metric": "Pending Grinding Feet", "Value": round(status["pending_grind"], 2)},
            {"Metric": "TIG Welders Required", "Value": status["required"]["tig"]},
            {"Metric": "TIG Welders Available", "Value": status["pool"]["tig"]},
            {"Metric": "TIG Welders Shortage", "Value": status["shortage"]["tig"]},
            {"Metric": "MIG Welders Required", "Value": status["required"]["mig"]},
            {"Metric": "MIG Welders Available", "Value": status["pool"]["mig"]},
            {"Metric": "MIG Welders Shortage", "Value": status["shortage"]["mig"]},
            {"Metric": "Grinders Required", "Value": status["required"]["grinders"]},
            {"Metric": "Grinders Available", "Value": status["pool"]["grinders"]},
            {"Metric": "Grinders Shortage", "Value": status["shortage"]["grinders"]}
        ]
        df_summary = pd.DataFrame(summary_data)
        
        output = io.BytesIO()
        with pd.ExcelWriter(output, engine='openpyxl') as writer:
            df_projects.to_excel(writer, index=False, sheet_name='Master_Production_Register')
            df_summary.to_excel(writer, index=False, sheet_name='Company_Summary')
        return output.getvalue()
    finally:
        session.close()
