# EJ Production Tracker - Daily Progress Log

## Date: 2026-06-28

### What we did today:
- **Temporary Access Bypass:** Removed all role-based restrictions from the frontend sidebar and backend endpoints. All users now have full visibility and access to every module across the application, pending a future RBAC overhaul.
- **Planning Dashboard Optimization:** Fixed 4-Week Capacity Forecast to use dynamic real-world calendar date ranges. Modified the Master Schedule to display `quotation_no` (Project Code) instead of the customer details to keep it cleaner.
- **Smart Scheduler Automation:** Overhauled the Daily Scheduler to become a "seamless" enterprise-grade system. It now automatically calculates and auto-assigns the daily goals upon opening the page if they haven't been assigned yet, without forcing the user to manually click options.
- **Dynamic Resource Simulator Engine:** 
  - Created a new backend simulation endpoint (`simulate_resources`).
  - Integrated this engine directly into the "Create Project" and "Edit Project" pages. Now, whenever the user changes bellows sizes, quantities, or the target deadline, the required TIG Welders, MIG Welders, and Grinders dynamically recalculate and instantly update on the UI before saving.
  - Successfully combined the backend capacity requirements for both Expansion Joints (EJ) and Dismantling Joints (DJ) into a single "TIG" metric as requested.
- **Edit Project UI Polish:** Added a dynamic "Target Date" modifier directly to the Edit Projects panel, allowing instant rescheduling.

- **Dashboard Evolution:** Upgraded the Progress Dashboard to clearly segment and display "Active Projects", "Projects on Hold", and "Completed Projects" as distinct KPIs.
- **Workflow Streamlining:** Simplified the Shop Floor Input form by removing the "Operator" dropdown, allowing the Production Manager to enter data significantly faster without redundant selections.
- **System Audit & Security:** Built a comprehensive Audit Log system that records logins and sensitive data modifications. Protected this dashboard exclusively for Developers, complete with an instant CSV/Excel export feature.

### Problems faced:
- Live resource calculations suddenly returned zeroes for DJ type bellows and gave incorrect total metrics.
- The user wanted a completely automated scheduler that wouldn't require daily manual button clicks.
- "Hold" projects failed to appear on the new Progress Dashboard due to a backend status string typo.
- The Live Overtime Predictions were displaying 0 hours, which initially appeared to be a bug but was actually mathematically correct based on massive available capacity.

### How we solved them:
- Discovered and fixed a python dictionary key-matching bug where database records containing `None` for joint_type were failing to match against `"EJ"` lookup strings. Adjusted the backend `simulate_resources` logic to safely default null records to `"EJ"`, perfectly restoring parity with the original calculator.
- Implemented lazy-loading auto-initialization inside `scheduler/page.tsx`, which silently handles assignment execution when the supervisor first visits the page for the day.
- Fixed the database query logic from `Project.status == "On Hold"` to `"Hold"` to ensure the backend accurately counted and returned the correct hold metrics.
- Educated the user on the difference between standard capacity vs required hours, confirming that 0 overtime means their current workforce is sufficiently staffed for the pending workload.
- Refactored `production_logs` and `welding_logs` database models and Pydantic schemas to allow nullable `operator_id` fields, safely empowering the PM to log production without being forced to choose an operator profile.

### What is pending:
- We still need to test the Smart Task Allocation modules thoroughly with live production data.
- Refine the auto-assignment algorithm to pull the exact remaining feet required per project from `ProjectProductionLine` instead of simulating distribution.

### What needs to be done next session:
- Finalize any further UX improvements for the Planning Dashboard.
- Move towards Phase 7 (Material Intelligence Engine) and complete testing on production floors.

## Date: 2026-06-27

### What we did today:
- **Optimized Data Fetching:** Fixed massive N+1 query performance issues in the Progress Dashboard by implementing `selectinload` for SQLAlchemy relationships.
- **Cache Busting:** Eliminated persistent Next.js and browser caching issues on the frontend by adding dynamic timestamps to API calls.
- **Project Hold System:** Implemented a brand new "Hold" state for projects.
  - Added `status_note` and `hold_until_date` to the database via SQLite migrations.
  - Added an intuitive UI on the "Edit Projects" page to allow capturing hold reasons and dates.
  - Added "Edit Projects" permanently to the sidebar navigation.
- **Dashboard Hold Metrics:** Split dashboard metrics so that "On Hold" welding requirements do not inflate "Pending" capacity. Created a separate red highlight zone on the dashboard for held work.
- **Roadmap Organization:** Saved the complete Phase 1-18 project roadmap into `phase.md`.
- **Phase 3 Execution (Workforce Intelligence):** 
  - Updated the `users` database table to include `skill`, `department`, `experience`, and `base_productivity`.
  - Built the `/workforce` Next.js dashboard to track daily attendance and display efficiency rankings.
  - Removed `username` and `password` requirements for shop-floor workers, enabling fast supervisor entry.
- **Database Architecture Hardening:** Enforced PostgreSQL strictly across the backend and wrote a fully automated SQLite-to-PostgreSQL migration script (`migrate_sqlite_to_postgres.py`).
- **Phase 5 Execution (Weekly & Monthly Planning Engine):**
  - Added a `target_date` (Delivery Deadline) column to the core `Project` database model with automated SQLite and PostgreSQL startup migrations.
  - Rewrote the `/api/v1/dashboard/planning` backend endpoint to act as a forecasting engine. It dynamically computes total factory capacity (summing all operator base productivities for a 6-day work week).
  - Designed the engine to scan all active projects, compute remaining workload (subtracting MES logs), and bucket the workload into 4-week forecasts based on `target_date`.
  - Built a brand new 4-Week Capacity Forecast UI section in `/dashboard/planning` with dynamic progress bars that turn red and calculate required overtime when demand exceeds factory capacity.
  - Implemented tracking for "Unscheduled Backlog" to catch projects without deadlines.
- **Phase 5.5 (Project Deadline UI):**
  - Updated the API schemas to accept `target_date` dynamically during project creation and editing.
  - Added a "Delivery Deadline" date-picker directly to the "Create Project" and "Edit Project" pages so planners can instantly set dates to sync with the forecasting engine.
  - **Dynamic Priority Engine:** Integrated dynamic calculation of project priorities based on deadline proximity. Automatically flags projects as **P1** (<= 21 days, Red), **P2** (<= 60 days, Orange), or **P3** (> 60 days / Unscheduled, Green) across the Planning Dashboard.
- **Phase 4 Execution (Smart Task Allocation Engine):**
  - Added the `DailyTaskAssignment` database model to `db_service.py` to store daily worker targets and overtime assignments.
  - Built the `scheduler` backend module to support fetching assignments and running the "Auto-Assign" algorithm based on worker `base_productivity`.
  - Implemented overtime allocation for high-efficiency workers when the project queue exceeds regular capacity.
  - Developed the `/scheduler` Next.js frontend page for supervisors to view and trigger auto-assignments.
  - Added the "Daily Scheduler" link to the main navigation sidebar.
- **Scheduler Enhancements & Bug Fixes:**
  - Standardized the frontend API calls in the scheduler to use `apiFetch` (including JWT authorization headers).
  - Fixed a critical `AttributeError` by sorting the task assignments using `created_at` instead of an invalid `target_date`.
  - Upgraded the Auto-Assign logic to support future planning dates (assumes all operators are available if no attendance logs exist for that date).
  - Enhanced the UI table to display real Worker Names and Project Quotation Numbers instead of raw database IDs.
- **Git Deployment Workflow Setup:** Established a strict rule in `.agents/AGENTS.md` to push all code to a `demo` branch first before merging to `main` for Railway deployments.
- **Dismantling Joint Implementation:** 
  - Updated DB schema to include `joint_type` in `WeldingMaster` and `ProjectProductionLine`.
  - Added dynamic Joint Type selector (Expansion Joint vs Dismantling Joint) in `projects/add/page.tsx` and `projects/edit/page.tsx`.
  - Added an importer for the newly provided Dismantling Joint welding feet data.
  - Separated UI rendering in `projects/page.tsx` to handle custom column formatting for Dismantling Joints (showing just "Welding Feet").
- **Dismantling Joint Tracking & Analytics:**
  - Upgraded the MES backend engine to automatically generate accurate Dismantling Joint fabrication processes (like PIPE-1, STOPPER) by syncing templates from the Job Tracker.
  - Updated the Shop Floor Entry UI to dynamically detect Joint Type, hiding MIG and Grinding options and cleanly presenting a focused "Welding" module for DJ requirements.
  - Corrected API requirement payloads and visual Kanban boards to properly distinguish DJ vs EJ load, feeding accurate numbers up to the Executive and Planning Dashboards.

### Problems faced:
- The dashboard was very slow to load (15s+) due to hundreds of redundant database queries firing simultaneously.
- When saving changes, the frontend wouldn't update live due to aggressive Next.js static data caching.
- Railway deployments failed to add new database columns because the auto-migration transaction was rolling back if any single column already existed.
- Need to securely migrate existing SQLite data into the new strictly-enforced PostgreSQL database.
- We needed a way to assign tasks only to workers who were marked as "Present" for the day without manually filtering them.
- The `auto-assign` API crashed on Railway because it tried to sort projects by a non-existent `target_date` column, and it returned a 401 error because the frontend used a raw `fetch()` without passing the user's JWT token.
- Future date scheduling failed because the system aborted if zero attendance logs existed for that day.

### How we solved them:
- Rewrote `calculate_project_progress` to use explicit `selectinload` mapping, drastically reducing load times.
- Implemented `?t=timestamp` cache-busters on frontend API requests to guarantee live data.
- Refactored the `ALTER TABLE` startup script to run each column addition in isolated `try/except` blocks, fixing the Railway deploy.
- Built a secure, automated `migrate_sqlite_to_postgres.py` script that reads credentials directly from `.env` and transfers all data table-by-table.
- Integrated the new `AttendanceLog` table directly into the auto-assignment query to fetch only available workers dynamically.
- Replaced raw `fetch()` with the project's standard `apiFetch` utility to guarantee authentication headers, and changed the sort logic to `created_at`.
- Updated the auto-assign engine to check if *any* attendance was logged for a date; if not, it automatically assumes all Active Operators are available for future planning.

### What is pending:
- We need to test the Workforce Intelligence, Smart Task Allocation, and Planning modules thoroughly with real data on the shop floor.
- The metrics calculation currently uses placeholders for quality and efficiency scores; we need the precise formulas from management to calculate them based on actual feet welded / defects.
- Refine the auto-assignment algorithm to pull the exact remaining feet required per project from `ProjectProductionLine` instead of simulating distribution.

### What needs to be done next session:
- Execute Phase 6 (Hold Management System) - *Note: We have already completed a large chunk of this in earlier sessions, just need to finalize tracking material holds.*
- Execute Phase 7 (Material Intelligence Engine).
- Finalize the Quality & Efficiency score calculation logic with exact formulas.
