import streamlit as st
import pandas as pd
import os
from dotenv import load_dotenv

load_dotenv()
from backend.services.production_service import (
    import_welding_master_from_disk,
    get_welding_master_latest,
    sync_project_production_lines,
    calculate_project_duration,
    get_company_capacity_status,
    generate_master_production_register_excel
)
from backend.services.db_service import (
    SessionLocal,
    WorkforceMaster,
    CompanyResourcePool,
    Project,
    ProjectProductionLine,
    ProjectResourceAssignment,
    init_db
)

st.set_page_config(page_title="EJ Production Tracker", layout="wide")

# Initialize DB on first run if it doesn't exist
try:
    init_db()
except Exception as e:
    pass

st.title("EJ Production Tracker")

if "authenticated" not in st.session_state:
    st.session_state.authenticated = False

if not st.session_state.authenticated:
    st.subheader("Production Manager Login")
    with st.form("login_form"):
        username = st.text_input("User ID")
        password = st.text_input("Password", type="password")
        submit = st.form_submit_button("Login")
        if submit:
            if username == os.getenv("ADMIN_USER") and password == os.getenv("ADMIN_PASS"):
                st.session_state.authenticated = True
                st.rerun()
            else:
                st.error("Invalid credentials")
    st.stop()

app_mode = st.sidebar.radio("Navigation", ["Production & Capacity Master", "Executive Capacity Dashboard"])

if app_mode == "Production & Capacity Master":
    st.subheader("Production & Capacity Master")
    
    tab_weld, tab_workforce, tab_pool, tab_poc = st.tabs(["Welding Workload Engine", "Workforce Master", "Company Resource Pool", "POC Project Creator"])
    
    with tab_weld:
        st.markdown("Sync **BELLOWS WELDING FEETS PER SIZE** from the server's Excel file to update the Master Database.")
        if st.button("Sync Data from Server"):
            success, msg = import_welding_master_from_disk()
            if success:
                st.success(msg)
            else:
                st.error(msg)
        
        st.markdown("#### Latest Welding Master Data")
        master_data = get_welding_master_latest()
        if master_data:
            df_m = pd.DataFrame([{
                "Size": m.size, "TIG Inches": m.tig_inches, "TIG Feet": m.tig_feet,
                "MIG Inches": m.mig_inches, "MIG Feet": m.mig_feet,
                "Total Inches": m.total_welding_inches, "Total Feet": m.total_welding_feet,
                "Grinding Feet": m.grinding_feet, "Version": m.version
            } for m in master_data])
            st.dataframe(df_m, use_container_width=True)
        else:
            st.info("No welding master data found.")
            
    with tab_workforce:
        session = SessionLocal()
        workforce = session.query(WorkforceMaster).all()
        st.markdown("#### Base Productivity (ft/day)")
        for w in workforce:
            with st.form(f"wf_form_{w.id}"):
                col1, col2 = st.columns(2)
                with col1:
                    st.text_input("Resource Type", value=w.resource_type, disabled=True)
                with col2:
                    new_val = st.number_input("Productivity", value=float(w.avg_productivity_per_day))
                if st.form_submit_button("Update"):
                    w.avg_productivity_per_day = new_val
                    session.commit()
                    st.success("Updated")
                    st.rerun()
        session.close()
        
    with tab_pool:
        session = SessionLocal()
        pool = session.query(CompanyResourcePool).first()
        if pool:
            with st.form("pool_form"):
                st.markdown("#### Company Resource Pool")
                c1, c2, c3 = st.columns(3)
                with c1:
                    new_t = st.number_input("Total TIG Welders", value=pool.total_tig_welders)
                with c2:
                    new_m = st.number_input("Total MIG Welders", value=pool.total_mig_welders)
                with c3:
                    new_g = st.number_input("Total Grinders", value=pool.total_grinders)
                
                if st.form_submit_button("Save Pool Settings"):
                    pool.total_tig_welders = new_t
                    pool.total_mig_welders = new_m
                    pool.total_grinders = new_g
                    session.commit()
                    st.success("Pool Updated")
                    st.rerun()
        session.close()

    with tab_poc:
        st.markdown("#### Create Project / Requirements")
        st.markdown("Add projects and their requirements here to track production capacities.")
        
        with st.form("poc_form"):
            poc_name = st.text_input("Project / Client Name", value="New Project")
            poc_q_no = st.text_input("Project Code / Ref No", value="PROJ-001")
            
            st.markdown("**Enter Sizes and Quantities** (comma-separated, e.g. 50:2, 100:5 for two 50NB and five 100NB)")
            size_qty_str = st.text_input("Sizes & Quantities (Format -> Size:Qty, Size:Qty)", placeholder="e.g. 80:2, 150:1, 300:4")
            
            if st.form_submit_button("Create Project"):
                if size_qty_str:
                    try:
                        pairs = size_qty_str.split(",")
                        sq_list = []
                        for p in pairs:
                            if ":" in p:
                                s, q = p.split(":")
                                sq_list.append({"size": int(s.strip()), "qty": int(q.strip())})
                        
                        if sq_list:
                            session = SessionLocal()
                            import datetime
                            new_proj = Project(
                                quotation_no=poc_q_no,
                                client_name=poc_name,
                                project_name=poc_name,
                                contact_person="Production User",
                                created_at=datetime.datetime.utcnow()
                            )
                            session.add(new_proj)
                            session.commit()
                            
                            if sync_project_production_lines(new_proj.id, sq_list):
                                st.success(f"Successfully created Project {poc_q_no} with {len(sq_list)} line items!")
                            else:
                                st.error("Failed to calculate production lines.")
                            session.close()
                        else:
                            st.warning("Invalid format. Use Size:Qty, Size:Qty")
                    except Exception as e:
                        st.error(f"Error parsing input: {e}")
                else:
                    st.warning("Please enter at least one Size:Qty pair.")

elif app_mode == "Executive Capacity Dashboard":
    st.subheader("Multi-Project Capacity & Workforce Planning")
    
    target_days = st.slider("Default Target Completion Days (Global Fallback)", min_value=1, max_value=365, value=15)
    
    st.markdown("### Per-Project Deadlines & Assignments")
    session = SessionLocal()
    projects = session.query(Project).all()
    
    if not projects:
        st.info("No active projects found. Go to 'Production & Capacity Master' to create projects.")
    
    for p in projects:
        lines = session.query(ProjectProductionLine).filter(ProjectProductionLine.project_id == p.id).all()
        if lines:
            assign = session.query(ProjectResourceAssignment).filter(ProjectResourceAssignment.project_id == p.id).first()
            if not assign:
                assign = ProjectResourceAssignment(project_id=p.id, target_days=target_days)
                session.add(assign)
                session.commit()
                
            with st.expander(f"⚙️ Manage Project: {p.quotation_no} - {p.project_name}", expanded=False):
                # 1. Update Target Days
                with st.form(key=f"target_days_form_{p.id}"):
                    col1, col2 = st.columns([3, 1])
                    with col1:
                        st.markdown(f"**Update Deadline for {p.quotation_no}**")
                    with col2:
                        new_days = st.number_input("Target Days", min_value=1, max_value=365, value=assign.target_days if assign.target_days else target_days, key=f"days_input_{p.id}")
                    if st.form_submit_button("Update Deadline"):
                        assign.target_days = new_days
                        session.commit()
                        st.success(f"Updated deadline for {p.quotation_no}")
                        st.rerun()

                # 2. View Production Lines
                st.markdown("#### Production Requirements")
                df_prod = pd.DataFrame([{
                    "Size": l.size,
                    "Qty": l.quantity,
                    "TIG Feet": l.tig_feet,
                    "MIG Feet": l.mig_feet,
                    "Grinding Feet": l.grinding_feet
                } for l in lines])
                st.dataframe(df_prod, use_container_width=True)
                
                tot_tig = sum(l.tig_feet for l in lines)
                tot_mig = sum(l.mig_feet for l in lines)
                tot_grind = sum(l.grinding_feet for l in lines)
                st.write(f"**Total Required:** TIG: {tot_tig} ft | MIG: {tot_mig} ft | Grinding: {tot_grind} ft")

                # 3. Assign Resources
                with st.form(f"resource_assign_form_{p.id}"):
                    st.markdown("#### Assign Workforce & Calculate Duration")
                    c_a1, c_a2, c_a3 = st.columns(3)
                    with c_a1:
                        t_weld = st.number_input("TIG Welders", min_value=0, value=assign.assigned_tig_welders)
                    with c_a2:
                        m_weld = st.number_input("MIG Welders", min_value=0, value=assign.assigned_mig_welders)
                    with c_a3:
                        grinders = st.number_input("Grinders", min_value=0, value=assign.assigned_grinders)
                    
                    if st.form_submit_button("Calculate & Assign"):
                        dur, t, m, g = calculate_project_duration(p.id, t_weld, m_weld, grinders)
                        st.success(f"Estimated Duration: {dur} days")
                        st.rerun()
                
                if assign and assign.estimated_duration_days > 0:
                    st.info(f"**Current Estimated Duration:** {assign.estimated_duration_days} days")

    session.close()

    st.markdown("---")
    st.markdown("### Executive Dashboard (Global)")
    status = get_company_capacity_status(target_days)
    
    col1, col2, col3, col4 = st.columns(4)
    with col1:
        with st.container(border=True):
            st.metric("Active Projects", status["active_projects"])
    with col2:
        with st.container(border=True):
            st.metric("Pending TIG Feet", round(status["pending_tig"], 2))
    with col3:
        with st.container(border=True):
            st.metric("Pending MIG Feet", round(status["pending_mig"], 2))
    with col4:
        with st.container(border=True):
            st.metric("Pending Grinding Feet", round(status["pending_grind"], 2))
            
    st.markdown("### Manpower Requirement Engine")
    req_df = pd.DataFrame([
        {"Resource": "TIG Welders", "Required (Daily Avg)": status["required"]["tig"], "Available": status["pool"]["tig"], "Shortage": status["shortage"]["tig"]},
        {"Resource": "MIG Welders", "Required (Daily Avg)": status["required"]["mig"], "Available": status["pool"]["mig"], "Shortage": status["shortage"]["mig"]},
        {"Resource": "Grinders", "Required (Daily Avg)": status["required"]["grinders"], "Available": status["pool"]["grinders"], "Shortage": status["shortage"]["grinders"]}
    ])
    
    def highlight_shortage(s):
        if s["Shortage"] > 0:
            return ['background-color: rgba(255, 0, 0, 0.2)'] * len(s)
        return [''] * len(s)
        
    st.dataframe(req_df.style.apply(highlight_shortage, axis=1), use_container_width=True)
    
    st.markdown("### 📥 Download Reports")
    excel_data = generate_master_production_register_excel(target_days)
    st.download_button(
        label="Download Master Production Register (Excel)",
        data=excel_data,
        file_name="Master_Production_Register.xlsx",
        mime="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    )
