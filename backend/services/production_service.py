import pandas as pd
import io
import json
import logging
from backend.services.db_service import SessionLocal, WeldingMaster, ProjectProductionLine, Project, WorkforceMaster, ProjectResourceAssignment, CompanyResourcePool
from backend.services import joint_catalog
import math
import datetime

logger = logging.getLogger(__name__)


def get_productivity_rates(session):
    """
    Single source of truth for TIG/MIG/Grinder ft-per-day productivity.
    Reads from WorkforceMaster; falls back to defaults only if a resource_type
    row is missing (e.g. table not yet seeded).
    """
    workforce = session.query(WorkforceMaster).all()
    prod = {w.resource_type: w.avg_productivity_per_day for w in workforce}
    return {
        "tig": prod.get("TIG Welder", 180.0),
        "mig": prod.get("MIG Welder", 120.0),
        "grind": prod.get("Grinder", 80.0),
    }


def compute_master_feet(master, joint_type, qty):
    """
    Given a WeldingMaster row, joint type, and quantity, return (tig_feet, mig_feet, grinding_feet)
    for that many units.

    EJ (Expansion Joint): TIG, MIG, and Grinding are each tracked and returned as-is.

    DJ (Dismantling Joint): there is no TIG process - all welding footage is MIG.
    tig_feet is always returned as 0. If the given master record still carries a
    non-zero tig_feet (this happens only when no DJ-specific master data exists for
    a size and an EJ record is used as a same-size fallback), that footage is folded
    into MIG rather than silently discarded, and a warning is logged so the fallback
    is visible instead of silently changing the numbers.
    """
    if not master:
        return 0.0, 0.0, 0.0

    if joint_type == 'DJ':
        if (master.tig_feet or 0) > 0:
            logger.warning(
                "DJ feet computed using a master record with non-zero tig_feet=%.2f "
                "(size=%s, master.joint_type=%s). Expected only when falling back to "
                "an EJ record for a size with no DJ master data.",
                master.tig_feet, master.size, master.joint_type
            )
        tig = 0.0
        mig = ((master.tig_feet or 0) + (master.mig_feet or 0)) * qty
        grind = (master.grinding_feet or 0) * qty
    else:
        tig = (master.tig_feet or 0) * qty
        mig = (master.mig_feet or 0) * qty
        grind = (master.grinding_feet or 0) * qty

    return tig, mig, grind


def aggregate_line_feet(lines):
    """
    Sum TIG/MIG/Grinding feet across a list of ProjectProductionLine rows.
    Single source of truth for this aggregation, used by duration/requirement
    calculations, the scheduler, and the planning dashboard.

    DJ lines should already have tig_feet=0 and their footage folded into
    mig_feet by compute_master_feet() at sync time. If a DJ line is ever
    found with non-zero tig_feet (written outside that path - e.g. a manual
    DB edit or a future bug), it is folded into MIG here too so no footage
    is silently dropped, and a warning is logged since it indicates the
    tig_feet==0-for-DJ invariant was broken.
    """
    tot_tig, tot_mig, tot_grind = 0.0, 0.0, 0.0
    for line in lines:
        jtype = getattr(line, 'joint_type', None) or 'EJ'
        line_tig = line.tig_feet or 0
        line_mig = line.mig_feet or 0
        if jtype == 'DJ':
            if line_tig > 0:
                logger.warning(
                    "DJ production line %s has non-zero tig_feet=%.2f; folding into MIG. "
                    "This indicates the line was not written via sync_project_production_lines.",
                    getattr(line, 'id', '?'), line_tig
                )
            tot_mig += line_mig + line_tig
        else:
            tot_tig += line_tig
            tot_mig += line_mig
        tot_grind += (line.grinding_feet or 0)
    return tot_tig, tot_mig, tot_grind


def _import_ej_master_dataframe(df):
    """
    Shared EJ import logic: takes a raw EJ welding-feet DataFrame (as read from
    either the on-disk file or an uploaded file) and inserts it as a new
    WeldingMaster version. Used by both import_welding_master_from_disk and
    import_welding_master_from_upload so the two paths can never drift apart.
    """
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

        if inserted_count == 0:
            session.rollback()
            return False, "No valid EJ rows found in the file (check Size/TIG/MIG/Grinding columns)"

        session.commit()
        return True, f"Successfully imported {inserted_count} records. Version: {new_version}"
    except Exception as e:
        session.rollback()
        return False, f"Database error: {e}"
    finally:
        session.close()


def import_welding_master_from_disk():
    try:
        file_path = "BELLOWS WELDING FEETS PER SIZE - 20.6.2026.xlsx"
        df = pd.read_excel(file_path, header=2)  # The real headers are on row index 2
    except Exception as e:
        return False, f"Error parsing Excel file: {e}"
    return _import_ej_master_dataframe(df)


def import_welding_master_from_upload(file_bytes):
    """Import EJ welding master data from an uploaded Excel file's raw bytes."""
    try:
        df = pd.read_excel(io.BytesIO(file_bytes), header=2)
    except Exception as e:
        return False, f"Error parsing uploaded Excel file: {e}"
    return _import_ej_master_dataframe(df)


def _import_dj_master_dataframe(df):
    """
    Shared DJ import logic: takes a raw DJ welding-feet DataFrame (as read from
    either the on-disk file or an uploaded file) and inserts it as a new
    WeldingMaster version. Used by both import_dismantling_joint_master and
    import_dismantling_joint_master_from_upload so the two paths can never drift apart.

    DJ has no TIG process, so tig_feet is always stored as 0 and the feet
    column from the sheet is stored entirely as mig_feet.
    """
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
                grind_feet = float(row.iloc[3]) if len(row) > 3 and pd.notna(row.iloc[3]) else 0.0
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
                mig_feet=feet,
                total_welding_inches=0.0,
                total_welding_feet=feet,
                grinding_feet=grind_feet,
                joint_type="DJ",
                version=new_version
            )
            session.add(wm)
            inserted_count += 1

        if inserted_count == 0:
            session.rollback()
            return False, "No valid DJ rows found in the file (check the size/feet/grinding columns)"

        session.commit()
        return True, f"Successfully imported {inserted_count} DJ records. Version: {new_version}"
    except Exception as e:
        session.rollback()
        return False, f"Database error: {e}"
    finally:
        session.close()


def import_dismantling_joint_master():
    try:
        file_path = "ANALYSIS DISMANTLING JOINT WELDING FEETS PER SIZE 27.06.2026.xlsx"
        df = pd.read_excel(file_path)
    except Exception as e:
        return False, f"Error parsing Excel file: {e}"
    return _import_dj_master_dataframe(df)


def import_dismantling_joint_master_from_upload(file_bytes):
    """Import DJ welding master data from an uploaded Excel file's raw bytes."""
    try:
        df = pd.read_excel(io.BytesIO(file_bytes))
    except Exception as e:
        return False, f"Error parsing uploaded Excel file: {e}"
    return _import_dj_master_dataframe(df)

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

def _line_identity(size, tag, weld_family, pn_rating):
    """
    Stable identity for a production line. Tagged lines are keyed by their tag;
    legacy lines (no tag) fall back to weld_family so pre-tag data still matches.
    """
    return (size, tag or ("__" + (weld_family or "EJ")), pn_rating)


def sync_project_production_lines(project_id, sizes_and_qtys):
    """
    sizes_and_qtys: list of dicts with keys:
        size, qty, pn_rating,
        joint_type_code (tag, e.g. "U-EJ-F-1MF-S-L"),
        joint_category  (SIMPLE_EJ | UNIVERSAL_EJ | DJ),
        variable_qtys   ({component_name: per_unit_qty} for ENTER components),
        type            (legacy EJ/DJ, used only when no tag is supplied)

    Syncs the production lines for a project. Welding-feet come from the master
    for the tag's weld_family (EJ master for Simple+Universal, DJ for
    Dismantling). Preserves existing lines/parts to keep MES tracking intact.
    """
    session = SessionLocal()
    try:
        master_data = {(m.size, m.joint_type): m for m in get_welding_master_latest()}
        existing_lines = session.query(ProjectProductionLine).filter(ProjectProductionLine.project_id == project_id).all()

        from backend.services.mes_service import MESService

        # Build the set of desired identities
        desired = {}
        for item in sizes_and_qtys:
            size = item['size']
            tag = item.get('joint_type_code')
            weld_family = joint_catalog.weld_family_for(tag) if tag else item.get('type', 'EJ')
            pn_rating = item.get('pn_rating')
            desired[_line_identity(size, tag, weld_family, pn_rating)] = item

        # Delete lines no longer requested
        for line in existing_lines:
            ident = _line_identity(
                line.size,
                getattr(line, 'joint_type_code', None),
                getattr(line, 'joint_type', 'EJ'),
                getattr(line, 'pn_rating', None),
            )
            if ident not in desired:
                session.delete(line)

        existing_by_ident = {}
        for line in existing_lines:
            ident = _line_identity(
                line.size,
                getattr(line, 'joint_type_code', None),
                getattr(line, 'joint_type', 'EJ'),
                getattr(line, 'pn_rating', None),
            )
            existing_by_ident[ident] = line

        for ident, item in desired.items():
            size = item['size']
            qty = item['qty']
            tag = item.get('joint_type_code')
            pn_rating = item.get('pn_rating')
            variable_qtys = item.get('variable_qtys') or {}
            weld_family = joint_catalog.weld_family_for(tag) if tag else item.get('type', 'EJ')
            category = item.get('joint_category') or (joint_catalog.category_for(tag) if tag else None)

            # Welding-feet master (EJ for Simple+Universal, DJ for Dismantling)
            m = master_data.get((size, weld_family))
            if not m and weld_family == 'DJ':
                m_ej = master_data.get((size, 'EJ'))
                if m_ej:
                    logger.warning("No DJ master data for size=%s; falling back to EJ master record.", size)
                    m = m_ej

            tig, mig, grind = compute_master_feet(m, weld_family, qty)
            var_json = json.dumps(variable_qtys) if variable_qtys else None

            existing_line = existing_by_ident.get(ident)
            if existing_line:
                existing_line.quantity = qty
                existing_line.tig_feet = tig
                existing_line.mig_feet = mig
                existing_line.grinding_feet = grind
                existing_line.joint_type = weld_family
                existing_line.joint_category = category
                existing_line.joint_type_code = tag
                existing_line.variable_qtys_json = var_json
                # Re-scale the BOM part targets for the new qty / ENTER values
                MESService.sync_part_targets(session, existing_line, variable_qtys)
            else:
                line = ProjectProductionLine(
                    project_id=project_id,
                    size=size,
                    quantity=qty,
                    tig_feet=tig,
                    mig_feet=mig,
                    grinding_feet=grind,
                    joint_type=weld_family,
                    pn_rating=pn_rating,
                    joint_category=category,
                    joint_type_code=tag,
                    variable_qtys_json=var_json,
                )
                session.add(line)
                session.flush()  # get line.id
                MESService.create_parts_for_production_line(
                    session, line.id, req_type=weld_family, tag_no=tag, variable_qtys=variable_qtys
                )

        session.commit()
        return True
    except Exception as e:
        session.rollback()
        logger.exception("sync_project_production_lines failed: %s", e)
        return False
    finally:
        session.close()

def calculate_project_duration(project_id, tig_welders, mig_welders, grinders):
    session = SessionLocal()
    try:
        lines = session.query(ProjectProductionLine).filter(ProjectProductionLine.project_id == project_id).all()
        tot_tig, tot_mig, tot_grind = aggregate_line_feet(lines)

        from backend.services.db_service import WeldingLog
        line_ids = [l.id for l in lines]
        if line_ids:
            logs = session.query(WeldingLog).filter(WeldingLog.production_line_id.in_(line_ids)).all()
            tot_tig = max(0, tot_tig - sum(l.feet_done for l in logs if l.process_type == "TIG"))
            tot_mig = max(0, tot_mig - sum(l.feet_done for l in logs if l.process_type == "MIG"))
            tot_grind = max(0, tot_grind - sum(l.feet_done for l in logs if l.process_type == "Grinding"))
        
        rates = get_productivity_rates(session)
        tig_prod, mig_prod, grind_prod = rates["tig"], rates["mig"], rates["grind"]

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
        tot_tig, tot_mig, tot_grind = aggregate_line_feet(lines)

        from backend.services.db_service import WeldingLog
        line_ids = [l.id for l in lines]
        if line_ids:
            logs = session.query(WeldingLog).filter(WeldingLog.production_line_id.in_(line_ids)).all()
            tot_tig = max(0, tot_tig - sum(l.feet_done for l in logs if l.process_type == "TIG"))
            tot_mig = max(0, tot_mig - sum(l.feet_done for l in logs if l.process_type == "MIG"))
            tot_grind = max(0, tot_grind - sum(l.feet_done for l in logs if l.process_type == "Grinding"))
        
        rates = get_productivity_rates(session)
        tig_prod, mig_prod, grind_prod = rates["tig"], rates["mig"], rates["grind"]

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
        project_ids = [p.id for p in projects]
        
        # Bulk load related data to fix N+1 performance issues
        all_lines = session.query(ProjectProductionLine).filter(ProjectProductionLine.project_id.in_(project_ids)).all() if project_ids else []
        line_ids = [l.id for l in all_lines]
        from backend.services.db_service import WeldingLog
        all_logs = session.query(WeldingLog).filter(WeldingLog.production_line_id.in_(line_ids)).all() if line_ids else []
        all_assignments = session.query(ProjectResourceAssignment).filter(ProjectResourceAssignment.project_id.in_(project_ids)).all() if project_ids else []
        
        lines_by_project = {}
        for l in all_lines:
            lines_by_project.setdefault(l.project_id, []).append(l)
            
        logs_by_line = {}
        for log in all_logs:
            logs_by_line.setdefault(log.production_line_id, []).append(log)
            
        assignments_by_project = {a.project_id: a for a in all_assignments}
        
        tot_tig = 0.0
        tot_dj = 0.0
        tot_mig = 0.0
        tot_grind = 0.0
        
        hold_tig = 0.0
        hold_dj = 0.0
        hold_mig = 0.0
        hold_grind = 0.0
        
        plan_tig = 0.0
        plan_dj = 0.0
        plan_mig = 0.0
        plan_grind = 0.0
        
        total_estimated_days = 0
        
        active_projects_count = 0
        
        # Get Productivity (now treated as ft/day)
        rates = get_productivity_rates(session)
        tig_prod, mig_prod, grind_prod = rates["tig"], rates["mig"], rates["grind"]

        req_tig_welders = 0
        req_mig_welders = 0
        req_grind_welders = 0
        
        months_breakdown = {}
        
        for p in projects:
            active_projects_count += 1
            lines = lines_by_project.get(p.id, [])
            if lines:
                proj_tig = sum((l.tig_feet or 0) for l in lines if (getattr(l, 'joint_type', None) or 'EJ') == 'EJ')
                proj_dj = sum((l.mig_feet or 0) for l in lines if (getattr(l, 'joint_type', None) or 'EJ') == 'DJ')
                proj_mig = sum((l.mig_feet or 0) for l in lines if (getattr(l, 'joint_type', None) or 'EJ') == 'EJ')
                proj_grind = sum((l.grinding_feet or 0) for l in lines)
                
                p_line_ids = [l.id for l in lines]
                if p_line_ids:
                    logs = []
                    for lid in p_line_ids:
                        logs.extend(logs_by_line.get(lid, []))
                    
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
                elif p.status == "Planning":
                    plan_tig += proj_tig
                    plan_dj += proj_dj
                    plan_mig += proj_mig
                    plan_grind += proj_grind
                else:
                    tot_tig += proj_tig
                    tot_dj += proj_dj
                    tot_mig += proj_mig
                    tot_grind += proj_grind
                
                assignment = assignments_by_project.get(p.id)
                proj_target_days = assignment.target_days if assignment and assignment.target_days else target_days
                
                # Math based on HOURLY productivity
                daily_tig_cap = tig_prod
                daily_mig_cap = mig_prod
                daily_grind_cap = grind_prod
                
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
            
        today_date = datetime.date.today()
        from backend.services.db_service import AttendanceLog, User
        any_logs = session.query(AttendanceLog).filter(AttendanceLog.date == today_date).first()
        
        if any_logs:
            present_logs = session.query(AttendanceLog).filter(
                AttendanceLog.date == today_date,
                AttendanceLog.status.in_(["Present", "Overtime"])
            ).all()
            present_user_ids = [log.user_id for log in present_logs]
            present_users = session.query(User).filter(User.id.in_(present_user_ids)).all()
            
            live_tig = sum(1 for u in present_users if (u.skill == "TIG Welder" or u.department == "TIG Welder"))
            live_mig = sum(1 for u in present_users if (u.skill == "MIG Welder" or u.department == "MIG Welder"))
            live_grind = sum(1 for u in present_users if (u.skill == "Grinder" or u.department == "Grinder"))
        else:
            live_tig = pool.total_tig_welders
            live_mig = pool.total_mig_welders
            live_grind = pool.total_grinders
            
        # Daily Capacity
        daily_tig = live_tig * tig_prod
        daily_mig = live_mig * mig_prod
        daily_grind = live_grind * grind_prod
        
        # Calculate Overtime Predictions
        # 1. Calculate Total Required Days across all pending active projects
        total_req_tig_days = tot_tig / tig_prod if tig_prod > 0 else 0
        total_req_mig_days = (tot_mig + tot_dj) / mig_prod if mig_prod > 0 else 0
        total_req_grind_days = tot_grind / grind_prod if grind_prod > 0 else 0
        
        # 2. Calculate Standard Available Days across target_days
        std_avail_tig_days = live_tig * target_days
        std_avail_mig_days = live_mig * target_days
        std_avail_grind_days = live_grind * target_days
        
        # 3. Calculate Total Overtime Days Needed
        total_ot_tig = max(0, total_req_tig_days - std_avail_tig_days)
        total_ot_mig = max(0, total_req_mig_days - std_avail_mig_days)
        total_ot_grind = max(0, total_req_grind_days - std_avail_grind_days)
        
        # 4. Calculate Overtime Per Person (in days)
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
            "plan_tig": plan_tig,
            "plan_dj": plan_dj,
            "plan_mig": plan_mig,
            "plan_grind": plan_grind,
            "total_estimated_days": total_estimated_days,
            "pool": {
                "tig": live_tig,
                "mig": live_mig,
                "grinders": live_grind,
            },
            "required": {
                "tig": int(req_tig_welders),
                "mig": int(req_mig_welders),
                "grinders": int(req_grind_welders)
            },
            "shortage": {
                "tig": max(0, int(req_tig_welders) - live_tig),
                "mig": max(0, int(req_mig_welders) - live_mig),
                "grinders": max(0, int(req_grind_welders) - live_grind)
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
