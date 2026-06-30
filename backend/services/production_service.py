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
                
                tig_in = round(float(row.get(col_tig_in, 0)), 2) if pd.notna(row.get(col_tig_in)) else 0.0
                tig_ft = round(float(row.get(col_tig_ft, 0)), 2) if pd.notna(row.get(col_tig_ft)) else 0.0
                mig_in = round(float(row.get(col_mig_in, 0)), 2) if pd.notna(row.get(col_mig_in)) else 0.0
                mig_ft = round(float(row.get(col_mig_ft, 0)), 2) if pd.notna(row.get(col_mig_ft)) else 0.0
                tot_in = round(float(row.get(col_tot_in, 0)), 2) if pd.notna(row.get(col_tot_in)) else 0.0
                tot_ft = round(float(row.get(col_tot_ft, 0)), 2) if pd.notna(row.get(col_tot_ft)) else 0.0
                grind = round(float(row.get(col_grind, 0)), 2) if pd.notna(row.get(col_grind)) else 0.0
                
                wm = WeldingMaster(
                    size=size,
                    tig_inches=tig_in,
                    tig_feet=tig_ft,
                    mig_inches=mig_in,
                    mig_feet=mig_ft,
                    total_welding_inches=tot_in,
                    total_welding_feet=tot_ft,
                    grinding_feet=grind,
                    joint_type="EJ",
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

def import_dismantling_joint_master():
    try:
        file_path = "ANALYSIS DISMANTLING JOINT WELDING FEETS PER SIZE_27.06.2026.xlsx"
        df = pd.read_excel(file_path)
        
        session = SessionLocal()
        try:
            latest = session.query(WeldingMaster).order_by(WeldingMaster.version.desc()).first()
            new_version = (latest.version + 1) if latest else 1
            
            inserted_count = 0
            seen_sizes = set()
            
            for _, row in df.iterrows():
                try:
                    size = int(float(row.iloc[1])) 
                    feet = float(row.iloc[2]) if pd.notna(row.iloc[2]) else 0.0
                except (ValueError, TypeError, IndexError):
                    continue
                    
                if size in seen_sizes:
                    continue
                seen_sizes.add(size)
                
                wm = WeldingMaster(
                    size=size,
                    tig_inches=0.0,
                    tig_feet=0.0,
                    mig_inches=0.0,
                    mig_feet=feet, # Assigning to mig_feet for capacity calculation
                    total_welding_inches=0.0,
                    total_welding_feet=feet,
                    grinding_feet=0.0,
                    joint_type="DJ",
                    version=new_version
                )
                session.add(wm)
                inserted_count += 1
                
            session.commit()
            return True, f"Successfully imported {inserted_count} DJ records. Version: {new_version}"
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
        results = []
        for jt in ["EJ", "DJ"]:
            if jt == "EJ":
                latest = session.query(WeldingMaster).filter((WeldingMaster.joint_type == "EJ") | (WeldingMaster.joint_type == None)).order_by(WeldingMaster.version.desc()).first()
            else:
                latest = session.query(WeldingMaster).filter(WeldingMaster.joint_type == jt).order_by(WeldingMaster.version.desc()).first()
            
            if latest:
                v = latest.version
                if jt == "EJ":
                    records = session.query(WeldingMaster).filter(WeldingMaster.version == v, ((WeldingMaster.joint_type == "EJ") | (WeldingMaster.joint_type == None))).order_by(WeldingMaster.size).all()
                else:
                    records = session.query(WeldingMaster).filter(WeldingMaster.version == v, WeldingMaster.joint_type == jt).order_by(WeldingMaster.size).all()
                results.extend(records)
        return results
    finally:
        session.close()

def sync_project_production_lines(project_id, sizes_and_qtys):
    """
    sizes_and_qtys: list of dicts {"size": int, "qty": int, "type": str}
    Syncs the production lines for a project based on the latest welding master.
    Preserves existing lines to keep MES Part/Process tracking data intact.
    """
    session = SessionLocal()
    try:
        master_data = {(m.size, m.joint_type): m for m in get_welding_master_latest()}
        existing_lines = session.query(ProjectProductionLine).filter(ProjectProductionLine.project_id == project_id).all()
        existing_map = {(l.size, getattr(l, 'joint_type', 'EJ')): l for l in existing_lines}
        
        new_items_set = {(item['size'], item.get('type', 'EJ'), item.get('pn_rating')) for item in sizes_and_qtys}
        
        # Delete lines that are no longer needed
        for key, line in existing_map.items():
            line_pn = getattr(line, 'pn_rating', None)
            if (key[0], key[1], line_pn) not in new_items_set:
                session.delete(line)
                
        # Update or Create lines
        from backend.services.mes_service import MESService
        
        for item in sizes_and_qtys:
            size = item['size']
            qty = item['qty']
            j_type = item.get('type', 'EJ')
            m = master_data.get((size, j_type))
            
            tig = m.tig_feet * qty if m else 0
            mig = m.mig_feet * qty if m else 0
            grind = m.grinding_feet * qty if m else 0
            
            pn_rating = item.get('pn_rating')
            
            key = (size, j_type)
            
            # Find an existing line that matches size, type, and pn_rating
            existing_line = next((l for k, l in existing_map.items() if k == key and getattr(l, 'pn_rating', None) == pn_rating), None)
            
            if existing_line:
                existing_line.quantity = qty
                existing_line.tig_feet = tig
                existing_line.mig_feet = mig
                existing_line.grinding_feet = grind
            else:
                line = ProjectProductionLine(
                    project_id=project_id,
                    size=size,
                    quantity=qty,
                    tig_feet=tig,
                    mig_feet=mig,
                    grinding_feet=grind,
                    joint_type=j_type,
                    pn_rating=pn_rating
                )
                session.add(line)
                session.flush() # get line.id
                
                # Auto-generate MES Parts
                MESService.create_parts_for_production_line(session, line.id, j_type)
                
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
        tot_tig = sum((l.tig_feet or 0) for l in lines)
        tot_mig = sum((l.mig_feet or 0) for l in lines)
        tot_grind = sum((l.grinding_feet or 0) for l in lines)
        
        from backend.services.db_service import WeldingLog
        line_ids = [l.id for l in lines]
        if line_ids:
            logs = session.query(WeldingLog).filter(WeldingLog.production_line_id.in_(line_ids)).all()
            tot_tig = max(0, tot_tig - sum(l.feet_done for l in logs if l.process_type == "TIG"))
            tot_mig = max(0, tot_mig - sum(l.feet_done for l in logs if l.process_type == "MIG"))
            tot_grind = max(0, tot_grind - sum(l.feet_done for l in logs if l.process_type == "Grinding"))
        
        workforce = session.query(WorkforceMaster).all()
        prod = {w.resource_type: w.avg_productivity_per_hour for w in workforce}
        
        tig_prod = prod.get("TIG Welder", 22.5)
        mig_prod = prod.get("MIG Welder", 15.0)
        grind_prod = prod.get("Grinder", 10.0)
        
        STANDARD_SHIFT_HOURS = 8

        
        tig_days = math.ceil(tot_tig / (tig_welders * tig_prod * STANDARD_SHIFT_HOURS)) if tig_welders > 0 and tig_prod > 0 else (math.ceil(tot_tig) if tot_tig > 0 else 0)
        mig_days = math.ceil(tot_mig / (mig_welders * mig_prod * STANDARD_SHIFT_HOURS)) if mig_welders > 0 and mig_prod > 0 else (math.ceil(tot_mig) if tot_mig > 0 else 0)
        grind_days = math.ceil(tot_grind / (grinders * grind_prod * STANDARD_SHIFT_HOURS)) if grinders > 0 and grind_prod > 0 else (math.ceil(tot_grind) if tot_grind > 0 else 0)
        
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
        tot_tig = sum((l.tig_feet or 0) for l in lines)
        tot_mig = sum((l.mig_feet or 0) for l in lines)
        tot_grind = sum((l.grinding_feet or 0) for l in lines)
        
        from backend.services.db_service import WeldingLog
        line_ids = [l.id for l in lines]
        if line_ids:
            logs = session.query(WeldingLog).filter(WeldingLog.production_line_id.in_(line_ids)).all()
            tot_tig = max(0, tot_tig - sum(l.feet_done for l in logs if l.process_type == "TIG"))
            tot_mig = max(0, tot_mig - sum(l.feet_done for l in logs if l.process_type == "MIG"))
            tot_grind = max(0, tot_grind - sum(l.feet_done for l in logs if l.process_type == "Grinding"))
        
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
        STANDARD_SHIFT_HOURS = 8
        
        tot_tig = 0.0
        tot_dj = 0.0
        tot_mig = 0.0
        tot_grind = 0.0
        
        hold_tig = 0.0
        hold_dj = 0.0
        hold_mig = 0.0
        hold_grind = 0.0
        
        total_estimated_days = 0
        
        active_projects_count = 0
        
        # Get Productivity (now treated as ft/hour)
        workforce = session.query(WorkforceMaster).all()
        prod = {w.resource_type: w.avg_productivity_per_hour for w in workforce}
        tig_prod = prod.get("TIG Welder", 22.5) # default 22.5 ft/hr
        mig_prod = prod.get("MIG Welder", 15.0) # default 15.0 ft/hr
        grind_prod = prod.get("Grinder", 10.0) # default 10.0 ft/hr
        
        req_tig_welders = 0
        req_mig_welders = 0
        req_grind_welders = 0
        
        months_breakdown = {}
        
        for p in projects:
            active_projects_count += 1
            lines = session.query(ProjectProductionLine).filter(ProjectProductionLine.project_id == p.id).all()
            if lines:
                proj_tig = sum((l.tig_feet or 0) for l in lines if (getattr(l, 'joint_type', None) or 'EJ') == 'EJ')
                proj_dj = sum((l.mig_feet or 0) for l in lines if (getattr(l, 'joint_type', None) or 'EJ') == 'DJ')
                proj_mig = sum((l.mig_feet or 0) for l in lines if (getattr(l, 'joint_type', None) or 'EJ') == 'EJ')
                proj_grind = sum((l.grinding_feet or 0) for l in lines)
                
                from backend.services.db_service import WeldingLog
                line_ids = [l.id for l in lines]
                if line_ids:
                    logs = session.query(WeldingLog).filter(WeldingLog.production_line_id.in_(line_ids)).all()
                    line_map = {l.id: (getattr(l, 'joint_type', None) or 'EJ') for l in lines}
                    
                    proj_tig = max(0, proj_tig - sum(l.feet_done for l in logs if l.process_type == "TIG" and line_map.get(l.production_line_id) == "EJ"))
                    proj_dj = max(0, proj_dj - sum(l.feet_done for l in logs if l.process_type == "MIG" and line_map.get(l.production_line_id) == "DJ"))
                    
                    proj_mig = max(0, proj_mig - sum(l.feet_done for l in logs if l.process_type == "MIG" and line_map.get(l.production_line_id) == "EJ"))
                    proj_grind = max(0, proj_grind - sum(l.feet_done for l in logs if l.process_type == "Grinding"))
                
                if p.status == "Hold":
                    hold_tig += proj_tig
                    hold_dj += proj_dj
                    hold_mig += proj_mig
                    hold_grind += proj_grind
                else:
                    tot_tig += proj_tig
                    tot_dj += proj_dj
                    tot_mig += proj_mig
                    tot_grind += proj_grind
                
                assignment = session.query(ProjectResourceAssignment).filter(ProjectResourceAssignment.project_id == p.id).first()
                proj_target_days = assignment.target_days if assignment and assignment.target_days else target_days
                
                # Math based on HOURLY productivity
                daily_tig_cap = tig_prod * STANDARD_SHIFT_HOURS
                daily_mig_cap = mig_prod * STANDARD_SHIFT_HOURS
                daily_grind_cap = grind_prod * STANDARD_SHIFT_HOURS
                
                p_req_tig = math.ceil(proj_tig / (proj_target_days * daily_tig_cap)) if proj_target_days > 0 and daily_tig_cap > 0 else 0
                p_req_mig = math.ceil((proj_mig + proj_dj) / (proj_target_days * daily_mig_cap)) if proj_target_days > 0 and daily_mig_cap > 0 else 0
                p_req_grind = math.ceil(proj_grind / (proj_target_days * daily_grind_cap)) if proj_target_days > 0 and daily_grind_cap > 0 else 0
                
                req_tig_welders += p_req_tig
                req_mig_welders += p_req_mig
                req_grind_welders += p_req_grind
                
                if assignment and assignment.target_date:
                    month_key = assignment.target_date.strftime("%b %Y")
                else:
                    month_key = "No Deadline"
                    
                if month_key not in months_breakdown:
                    months_breakdown[month_key] = {
                        "tig_feet": 0.0,
                        "dj_feet": 0.0,
                        "mig_feet": 0.0,
                        "grind_feet": 0.0,
                        "req_tig": 0,
                        "req_mig": 0,
                        "req_grind": 0
                    }
                    
                months_breakdown[month_key]["tig_feet"] += proj_tig
                months_breakdown[month_key]["dj_feet"] += proj_dj
                months_breakdown[month_key]["mig_feet"] += proj_mig
                months_breakdown[month_key]["grind_feet"] += proj_grind
                months_breakdown[month_key]["req_tig"] += p_req_tig
                months_breakdown[month_key]["req_mig"] += p_req_mig
                months_breakdown[month_key]["req_grind"] += p_req_grind
                
                if assignment and assignment.estimated_duration_days:
                    total_estimated_days += assignment.estimated_duration_days
                
        # Get Company Resource Pool
        pool = session.query(CompanyResourcePool).first()
        if not pool:
            pool = CompanyResourcePool(total_tig_welders=0, total_mig_welders=0, total_grinders=0)
            
        # Daily Capacity
        daily_tig = pool.total_tig_welders * (tig_prod * STANDARD_SHIFT_HOURS)
        daily_mig = pool.total_mig_welders * (mig_prod * STANDARD_SHIFT_HOURS)
        daily_grind = pool.total_grinders * (grind_prod * STANDARD_SHIFT_HOURS)
        
        # Calculate Overtime Predictions
        # 1. Calculate Total Required Hours across all pending active projects
        total_req_tig_hours = tot_tig / tig_prod if tig_prod > 0 else 0
        total_req_mig_hours = (tot_mig + tot_dj) / mig_prod if mig_prod > 0 else 0
        total_req_grind_hours = tot_grind / grind_prod if grind_prod > 0 else 0
        
        # 2. Calculate Standard Available Hours across target_days
        std_avail_tig_hours = pool.total_tig_welders * target_days * STANDARD_SHIFT_HOURS
        std_avail_mig_hours = pool.total_mig_welders * target_days * STANDARD_SHIFT_HOURS
        std_avail_grind_hours = pool.total_grinders * target_days * STANDARD_SHIFT_HOURS
        
        # 3. Calculate Total Overtime Hours Needed
        total_ot_tig = max(0, total_req_tig_hours - std_avail_tig_hours)
        total_ot_mig = max(0, total_req_mig_hours - std_avail_mig_hours)
        total_ot_grind = max(0, total_req_grind_hours - std_avail_grind_hours)
        
        # 4. Calculate Overtime Per Person
        ot_per_tig = total_ot_tig / pool.total_tig_welders if pool.total_tig_welders > 0 else total_ot_tig
        ot_per_mig = total_ot_mig / pool.total_mig_welders if pool.total_mig_welders > 0 else total_ot_mig
        ot_per_grind = total_ot_grind / pool.total_grinders if pool.total_grinders > 0 else total_ot_grind
        
        active_count = session.query(Project).filter(Project.status == "Active").count()
        hold_count = session.query(Project).filter(Project.status == "Hold").count()
        completed_count = session.query(Project).filter(Project.status == "Completed").count()
        
        return {
            "active_projects": active_count,
            "hold_projects": hold_count,
            "completed_projects": completed_count,
            "pending_tig": tot_tig,
            "pending_dj": tot_dj,
            "pending_mig": tot_mig,
            "pending_grind": tot_grind,
            "hold_tig": hold_tig,
            "hold_dj": hold_dj,
            "hold_mig": hold_mig,
            "hold_grind": hold_grind,
            "total_estimated_days": total_estimated_days,
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
            },
            "daily_capacity": {
                "tig_ft": daily_tig,
                "mig_ft": daily_mig,
                "grind_ft": daily_grind
            },
            "months_breakdown": months_breakdown,
            "overtime": {
                "total_ot_tig": total_ot_tig,
                "total_ot_mig": total_ot_mig,
                "total_ot_grind": total_ot_grind,
                "ot_per_tig": ot_per_tig,
                "ot_per_mig": ot_per_mig,
                "ot_per_grind": ot_per_grind
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
                    "Starting Date": p.created_at.strftime("%d/%m/%Y") if p.created_at else "",
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
