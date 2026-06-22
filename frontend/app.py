import streamlit as st
import pandas as pd
import os
import datetime
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

app_mode = st.sidebar.radio("Navigation", ["Add Projects", "Edit Projects", "Progress Dashboard", "Production & Capacity Master", "Executive Capacity Dashboard"])

if app_mode == "Add Projects":
    st.subheader("Create New Project & Add Expansion Joints")
    
    if "active_project_id" not in st.session_state:
        st.session_state.active_project_id = None
        st.session_state.active_project_code = None

    if st.session_state.active_project_id is None:
        st.markdown("#### Step 1: Create Project")
        with st.form("create_project_form"):
            poc_q_no = st.text_input("Project Code", value="PROJ-001")
            deadline_date = st.date_input("Deadline Date")
            if st.form_submit_button("Create Project"):
                session = SessionLocal()
                import datetime
                existing = session.query(Project).filter(Project.quotation_no == poc_q_no).first()
                if existing:
                    st.error("Project Code already exists! Please use Edit Projects or enter a different code.")
                else:
                    new_proj = Project(
                        quotation_no=poc_q_no,
                        client_name="",
                        project_name=poc_q_no,
                        contact_person="Production User",
                        created_at=datetime.datetime.utcnow()
                    )
                    session.add(new_proj)
                    session.commit()
                    
                    from backend.services.db_service import ProjectResourceAssignment
                    dt_deadline = datetime.datetime.combine(deadline_date, datetime.datetime.min.time())
                    assign = ProjectResourceAssignment(project_id=new_proj.id, target_date=dt_deadline)
                    session.add(assign)
                    session.commit()
                    
                    st.session_state.active_project_id = new_proj.id
                    st.session_state.active_project_code = new_proj.quotation_no
                    st.success(f"Project {poc_q_no} created successfully! Now add expansion joints.")
                    session.close()
                    st.rerun()
                session.close()
    else:
        st.markdown(f"#### Step 2: Add Expansion Joints to {st.session_state.active_project_code}")
        if st.button("⬅️ Go Back to Previous Menu"):
            st.session_state.active_project_id = None
            st.session_state.active_project_code = None
            st.rerun()

        master_data = get_welding_master_latest()
        master_sizes = [m.size for m in master_data]
        
        with st.form("add_ej_form"):
            col1, col2 = st.columns(2)
            with col1:
                size_option = st.selectbox("Select Size", ["Select"] + master_sizes)
            with col2:
                qty = st.number_input("Quantity", min_value=1, step=1, value=1)
                
            if st.form_submit_button("Add Expansion Joint"):
                final_size = size_option
                if final_size == "Select":
                    st.error("Please select a size.")
                else:
                    session = SessionLocal()
                    m_data = next((m for m in master_data if m.size == int(final_size)), None)
                    new_line = ProjectProductionLine(
                        project_id=st.session_state.active_project_id,
                        size=int(final_size),
                        quantity=int(qty),
                        tig_feet=(m_data.tig_feet * int(qty)) if m_data else 0,
                        mig_feet=(m_data.mig_feet * int(qty)) if m_data else 0,
                        grinding_feet=(m_data.grinding_feet * int(qty)) if m_data else 0
                    )
                    session.add(new_line)
                    session.commit()
                    session.close()
                    st.success(f"Added {qty} of size {final_size}")
                    st.rerun()
                    
        st.markdown("#### Current Expansion Joints")
        session = SessionLocal()
        lines = session.query(ProjectProductionLine).filter(ProjectProductionLine.project_id == st.session_state.active_project_id).all()
        if lines:
            st.info("You can edit or delete entries in the table below, then click Save.")
            df = pd.DataFrame([{"Size (NB)": l.size, "Quantity": l.quantity, "Delete": False} for l in lines])
            df.index += 1
            df.index.name = "Sr No"
            edited_df = st.data_editor(
                df, 
                num_rows="dynamic", 
                hide_index=False,
                column_config={
                    "Delete": st.column_config.CheckboxColumn("Delete?", default=False)
                }
            )
            if st.button("Save Edits/Deletions"):
                master_sizes = [m.size for m in get_welding_master_latest()]
                invalid_sizes = []
                for _, row in edited_df.iterrows():
                    if not row.get('Delete', False) and pd.notna(row.get('Size (NB)')):
                        size_val = int(row['Size (NB)'])
                        if size_val not in master_sizes:
                            invalid_sizes.append(size_val)
                
                if invalid_sizes:
                    st.error(f"Please enter suitable value from table. The following sizes are not in the master table: {invalid_sizes}")
                else:
                    session.query(ProjectProductionLine).filter(ProjectProductionLine.project_id == st.session_state.active_project_id).delete()
                    session.commit()
                    
                    new_sq_list = []
                    for _, row in edited_df.iterrows():
                        if not row.get('Delete', False) and pd.notna(row.get('Size (NB)')) and pd.notna(row.get('Quantity')):
                            new_sq_list.append({"size": int(row['Size (NB)']), "qty": int(row['Quantity'])})
                    
                    if sync_project_production_lines(st.session_state.active_project_id, new_sq_list):
                        st.success("Items updated!")
                    else:
                        st.error("Failed to update items.")
                    st.rerun()
        else:
            st.info("No items added yet.")
            
        st.markdown("---")
        st.markdown(f"#### Step 3: Schedule & Planning")
        from backend.services.db_service import ProjectResourceAssignment
        assign = session.query(ProjectResourceAssignment).filter(ProjectResourceAssignment.project_id == st.session_state.active_project_id).first()
        
        start_date = st.date_input("Start Date", value=datetime.date.today() + datetime.timedelta(days=1), format="DD/MM/YYYY")
        
        if assign and assign.target_date:
            deadline_date_val = assign.target_date.date()
            target_days = (deadline_date_val - start_date).days
            if target_days > 0 and lines:
                from backend.services.production_service import calculate_required_resources_for_deadline
                req_tig, req_mig, req_grind = calculate_required_resources_for_deadline(st.session_state.active_project_id, target_days)
                st.info(f"💡 **Suggestion:** To complete this work by the deadline ({deadline_date_val.strftime('%d/%m/%Y')}, which is {target_days} working days away), you will need approximately:\n\n**{req_tig} TIG Welders**, **{req_mig} MIG Welders**, and **{req_grind} Grinders**.")
            elif target_days <= 0:
                st.warning("⚠️ The Start Date is on or past the Deadline!")
        
        st.markdown("##### Manual Assignment")
        c1, c2, c3 = st.columns(3)
        with c1:
            t_weld = st.number_input("TIG Welders", min_value=0, value=assign.assigned_tig_welders if assign else 0)
        with c2:
            m_weld = st.number_input("MIG Welders", min_value=0, value=assign.assigned_mig_welders if assign else 0)
        with c3:
            grinders = st.number_input("Grinders", min_value=0, value=assign.assigned_grinders if assign else 0)
            
        if lines:
            from backend.services.production_service import calculate_project_duration
            dur, t, m, g = calculate_project_duration(st.session_state.active_project_id, t_weld, m_weld, grinders)
            st.info(f"**Estimated Time Required:** {dur} working days to complete based on these assigned resources.")
        else:
            st.warning("Please add expansion joints to see estimated schedule.")

        session.close()

elif app_mode == "Edit Projects":
    st.subheader("Edit Existing Projects")
    
    if "edit_authenticated" not in st.session_state:
        st.session_state.edit_authenticated = False
    if "authenticated_edit_project_id" not in st.session_state:
        st.session_state.authenticated_edit_project_id = None
        
    session = SessionLocal()
    projects = session.query(Project).all()
    
    if not projects:
        st.info("No projects found.")
    else:
        proj_dict = {f"{p.quotation_no} - {p.project_name}": p.id for p in projects}
        selected_proj_str = st.selectbox("Select Project to Edit", list(proj_dict.keys()))
        selected_proj_id = proj_dict[selected_proj_str]
        
        if st.session_state.authenticated_edit_project_id != selected_proj_id:
            st.session_state.edit_authenticated = False
            
        if not st.session_state.edit_authenticated:
            with st.form("edit_login"):
                st.warning(f"Re-authentication required to edit project {selected_proj_str}.")
                pwd = st.text_input("Enter Production Manager Password", type="password")
                if st.form_submit_button("Authenticate"):
                    if pwd == os.getenv("ADMIN_PASS"):
                        st.session_state.edit_authenticated = True
                        st.session_state.authenticated_edit_project_id = selected_proj_id
                        st.rerun()
                    else:
                        st.error("Incorrect password")
        else:
            p = session.query(Project).filter(Project.id == selected_proj_id).first()
            lines = session.query(ProjectProductionLine).filter(ProjectProductionLine.project_id == p.id).all()
            
            st.markdown(f"Editing Project: **{p.quotation_no}**")
            
            from backend.services.db_service import ProjectResourceAssignment
            assign = session.query(ProjectResourceAssignment).filter(ProjectResourceAssignment.project_id == p.id).first()
            current_deadline = assign.target_date.date() if assign and assign.target_date else datetime.datetime.utcnow().date()
            
            with st.form("edit_project_metadata"):
                new_q_no = st.text_input("Project Code", value=p.quotation_no)
                new_deadline = st.date_input("Deadline Date", value=current_deadline)
                if st.form_submit_button("Update Project Details"):
                    p.quotation_no = new_q_no
                    p.project_name = new_q_no
                    if assign:
                        assign.target_date = datetime.datetime.combine(new_deadline, datetime.datetime.min.time())
                    session.commit()
                    st.success("Project details updated.")
                    st.rerun()
                    
            st.markdown("---")
            st.markdown("#### Delete Project")
            with st.form("delete_project_form"):
                st.warning("⚠️ Deleting this project will permanently remove all of its data, including expansion joints and resource assignments.")
                del_pass = st.text_input("Enter Admin Password to confirm deletion", type="password")
                if st.form_submit_button("Delete Project", type="primary"):
                    if del_pass == os.getenv("ADMIN_PASS"):
                        session.query(ProjectResourceAssignment).filter(ProjectResourceAssignment.project_id == p.id).delete()
                        session.query(ProjectProductionLine).filter(ProjectProductionLine.project_id == p.id).delete()
                        session.delete(p)
                        session.commit()
                        st.success(f"Project {p.quotation_no} deleted successfully.")
                        st.session_state.edit_authenticated = False
                        st.session_state.authenticated_edit_project_id = None
                        st.rerun()
                    else:
                        st.error("Incorrect Password. Project not deleted.")
            
            st.markdown("#### Edit Expansion Joints")
            st.info("You can edit or delete entries in the table below, then click Save Expansion Joint Changes.")
            df_lines = pd.DataFrame([{"Size (NB)": l.size, "Quantity": l.quantity, "Delete": False} for l in lines])
            df_lines.index += 1
            df_lines.index.name = "Sr No"
            edited_df = st.data_editor(
                df_lines, 
                num_rows="dynamic", 
                hide_index=False,
                column_config={
                    "Delete": st.column_config.CheckboxColumn("Delete?", default=False)
                }
            )
            if st.button("Save Expansion Joint Changes"):
                master_sizes = [m.size for m in get_welding_master_latest()]
                invalid_sizes = []
                for _, row in edited_df.iterrows():
                    if not row.get('Delete', False) and pd.notna(row.get('Size (NB)')):
                        size_val = int(row['Size (NB)'])
                        if size_val not in master_sizes:
                            invalid_sizes.append(size_val)
                
                if invalid_sizes:
                    st.error(f"Please enter suitable value from table. The following sizes are not in the master table: {invalid_sizes}")
                else:
                    session.query(ProjectProductionLine).filter(ProjectProductionLine.project_id == p.id).delete()
                    session.commit()
                    
                    new_sq_list = []
                    for _, row in edited_df.iterrows():
                        if not row.get('Delete', False) and pd.notna(row.get('Size (NB)')) and pd.notna(row.get('Quantity')):
                            new_sq_list.append({"size": int(row['Size (NB)']), "qty": int(row['Quantity'])})
                    
                    if sync_project_production_lines(p.id, new_sq_list):
                        st.success("Updated project items.")
                    else:
                        st.error("Failed to update project items.")
                    st.rerun()
        
        session.close()

elif app_mode == "Progress Dashboard":
    st.subheader("Project Progress & Overview")
    
    session = SessionLocal()
    projects = session.query(Project).all()
    
    if not projects:
        st.info("No projects added yet.")
    else:
        from backend.services.production_service import generate_master_production_register_excel
        excel_data = generate_master_production_register_excel()
        if excel_data:
            st.download_button(
                label="📥 Download Projects Status Report (Excel)",
                data=excel_data,
                file_name="Projects_Status_Report.xlsx",
                mime="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            )
            st.markdown("---")
            
        for p in projects:
            with st.expander(f"Project Code: {p.quotation_no}", expanded=False):
                lines = session.query(ProjectProductionLine).filter(ProjectProductionLine.project_id == p.id).all()
                if not lines:
                    st.write("No Expansion Joints added to this project.")
                else:
                    df = pd.DataFrame([{
                        "Sr No": i+1,
                        "Size (NB)": l.size,
                        "Quantity": l.quantity,
                        "Total TIG (ft)": l.tig_feet,
                        "Total MIG (ft)": l.mig_feet,
                        "Total Grinding (ft)": l.grinding_feet
                    } for i, l in enumerate(lines)])
                    st.dataframe(df.set_index("Sr No"), use_container_width=True)
                    
                    tot_qty = sum(l.quantity for l in lines)
                    tot_tig = sum(l.tig_feet for l in lines)
                    tot_mig = sum(l.mig_feet for l in lines)
                    tot_grind = sum(l.grinding_feet for l in lines)
                    
                    from backend.services.db_service import ProjectResourceAssignment
                    assign = session.query(ProjectResourceAssignment).filter(ProjectResourceAssignment.project_id == p.id).first()
                    est_days = assign.estimated_duration_days if assign else 0
                    deadline_str = assign.target_date.strftime('%d/%m/%Y') if assign and assign.target_date else "Not set"
                    
                    st.markdown(f"**Total Quantity:** {tot_qty} | **Total TIG:** {tot_tig:.2f} ft | **Total MIG:** {tot_mig:.2f} ft | **Total Grinding:** {tot_grind:.2f} ft")
                    st.markdown(f"**Estimated Time Required:** {est_days} working days | **Deadline:** {deadline_str}")
    session.close()

elif app_mode == "Production & Capacity Master":
    st.subheader("Production & Capacity Master")
    
    tab_weld, tab_workforce, tab_pool = st.tabs(["Welding Workload Engine", "Workforce Master", "Company Resource Pool"])
    
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
