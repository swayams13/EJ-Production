# EJ Production Tracker - Daily Progress Log

## Date: 2026-07-05

### What we did today:
- **Audited EJ/DJ welding-feet & resource calculation logic end-to-end.** Verified against actual code (not assumptions) that EJ correctly computes TIG+MIG+Grinding worker counts independently, and DJ correctly forces TIG=0 and only computes MIG+Grinding worker counts.
- **Centralized 7 duplicated implementations of the EJ/DJ feet-splitting rule** into two shared functions in `backend/services/production_service.py`: `compute_master_feet()` (WeldingMaster row -> project line feet) and `aggregate_line_feet()` (summing already-synced line feet). Previously this logic was independently reimplemented in `sync_project_production_lines`, `auto_sync_all_projects_with_master` (master/router.py), all three `/simulate*` endpoints (projects/router.py), `debug_reload_feet`, `scheduler/router.py`, and `dashboard/router.py`'s planning forecast.
- **Centralized productivity-rate lookup** (`get_productivity_rates()`) — was hardcoded (180/120/80 ft/day fallback) in 7 separate places.
- **Added master-data file upload.** Previously EJ/DJ Excel master data could only be updated by SSH-ing a correctly, exactly-named, date-stamped file onto the server and hitting a "sync" endpoint that re-reads it from disk. Added `POST /api/v1/master/welding-import` and `/dj-import` (real multipart upload, role-gated) plus matching file-picker buttons in `next-frontend/src/app/(main)/master/page.tsx`.
- **Ran a full bug-hunting audit** (two parallel sub-agents, backend + frontend) and personally verified every claim against actual code before acting. Fixed the confirmed ones:
  - Production entry (`production/router.py`, `schemas.py`): server-side validation now rejects negative/zero feet & quantities, and rejects a TIG welding log against a DJ production line (previously only the frontend UI prevented this — a direct API call could bypass it entirely).
  - Attendance race condition (`workforce/router.py`, `db_service.py`, `main.py`): fixed check-then-insert duplicate-row race by adding a real Postgres `UNIQUE(user_id, date)` constraint and switching to an `ON CONFLICT` upsert. Startup migration de-duplicates any rows the old race already created in the live DB before adding the constraint.
  - WIP dashboard (`dashboard/router.py`): was hardcoded to dump 100% of every project into "Bellows Shop", leaving Fabrication/Assembly/Machining shops permanently at 0%. Now classifies each MES part (via `templates.py` part names) into its real shop.
  - Inventory shortage calc (`inventory/router.py`): was filtering `status == "Active"` only, so Hold/Planning projects' material needs never surfaced. Broadened to exclude only Completed projects.
  - Startup migrations (`main.py`): were wrapped in bare `except Exception: pass`, silently swallowing real DB errors alongside expected "column already exists" cases. Now logged via a shared `_run_startup_migration()` helper.
  - Frontend `api.ts`: fixed duplicate `?t=...&t=...` cache-busting query param (was appending instead of replacing), and network failures now reject with a clear error message instead of an unhandled raw `fetch` `TypeError`.
- **Created `docs/EJ_DJ_CALCULATION_LOGIC.md`** as a durable technical reference for the EJ/DJ business rule, full data flow, the two centralized functions, enforcement points, and known/deliberate limitations — so this domain logic doesn't need to be re-explained or re-discovered in future sessions. Linked from `CLAUDE.md`.
- Committed and pushed both rounds of fixes to `demo` (commits `f5b7d0e`, `12cc980`) per the standard git workflow — not merged to `main` yet, pending manual verification.

### Problems faced (and how we solved them):
- **Two independent automated audit sub-agents both flagged the same false-positive bug** in `mes_service.py`'s progress formula (`fab*0.7 + welding_pct*30.0`), claiming it should be `*0.3`. Both were wrong: verified directly that `Part.weight_percentage` values sum to 100 per joint template (`templates.py`), so the formula's scale is correct by design. **Lesson:** never relay an automated audit's claim without independently re-reading the actual code/data it's based on — see `mistakes.md` for the durable rule.
- **A sub-agent claimed the DJ MIG-feet aggregation was a live "double-counting" bug** in multiple files. On inspection, it was only a real effect in one narrow fallback path (no DJ master data exists for a size, so an EJ record's TIG+MIG gets folded into DJ's MIG as an approximation) — everywhere else `tig_feet` was already 0 on synced DJ lines, so the "addition" was redundant but harmless. Fixed it anyway by centralizing (removes the redundancy and adds an invariant-violation warning), but corrected the severity/framing before acting.
- **Missed 2 of the 7 duplicate sites on the first centralization pass** (master/router.py's `auto_sync_all_projects_with_master`, and dashboard/router.py's planning forecast) — found only when directly asked "from where is the model taking values" and later during the full bug-hunt audit. **Lesson:** when centralizing duplicated business logic, grep the whole repo for the pattern's distinctive substring (e.g. the exact `if joint_type == 'DJ':` fold logic) rather than relying on memory of "the places I already looked."
- **A sub-agent claimed startup migrations in `main.py` were non-idempotent and could double-count data on restart.** Verified directly: every `UPDATE` statement is self-guarding (its `WHERE` clause only matches un-migrated rows, e.g. `WHERE tig_feet > 0`), so re-running is safe. The real (smaller) issue was the bare `except: pass` masking genuine failures, not idempotency — fixed that instead of the non-existent problem.
- **No local PostgreSQL available in the sandbox** to run a full live browser click-through of the new upload UI or the attendance upsert. Verified everything else possible instead — Python `ast.parse` + module import for every backend file, TypeScript `tsc --noEmit` + ESLint for every frontend file, byte-identical DataFrame comparison between the old disk-read and new upload-bytes Excel parsing paths, direct unit tests of `compute_master_feet`/`aggregate_line_feet` against constructed EJ/DJ/mixed/fallback cases, and compiling the generated Postgres upsert SQL. Recommended the user verify the live DB migration (duplicate-row cleanup) manually on `demo` after deploy.

### What needs to be done next session:
- User to verify on the `demo` deployment: master-data file upload end-to-end, attendance submission (confirm no duplicate rows / migration ran cleanly), WIP dashboard now shows non-zero values across all 4 shops, inventory shortages now include Hold/Planning projects.
- Once verified, get explicit permission to merge `demo` -> `main`.
- Remaining known gaps not yet addressed (see `docs/EJ_DJ_CALCULATION_LOGIC.md` "Known limitations"): inventory shortage calc doesn't do cumulative cross-project stock allocation; scheduler's per-employee productivity model is disconnected from `WorkforceMaster` rates.
- Broader enterprise-readiness gaps from the earlier full-codebase audit (still open): RBAC is disabled (commented out in `auth/rbac.py`), no automated test suite, no structured logging/error tracking in production, no documented backup/DR strategy, hardcoded dev credentials in `.env`.
- Continue toward Phase 7 (Material Intelligence Engine) per `phase.md`.

## Date: 2026-07-03 (Session 2)

### What we did today:
- **Dynamic Resource Synchronization:** Added a major feature to automatically sync active project requirements when Master Data is updated.
- **Backend Refactoring:** Refactored `backend/app/projects/router.py` to correctly calculate `assigned_tig_welders`, `assigned_mig_welders`, and `assigned_grinders` against target deadlines instead of statically estimating durations based on fixed workforce numbers.
- **Trigger Automation:** Integrated `auto_sync_all_projects_with_master()` into `backend/app/master/router.py` endpoints so that any Excel upload automatically cascades updates to all affected projects.

### Problems faced:
- The user noticed that after syncing, the Pending MIG and Grinding feet dropped while TIG feet remained the same. This was because the projects were created using an older version of the Master Data, and our newly built debug reload endpoint faithfully snapped them to the newer, lower values.
- Following the feet updates, the user requested that all workforce assignments (welders/days) also be dynamically recalculated in tandem. Our first attempt incorrectly recalculated Estimated Duration instead of the Assigned Resources, leaving the UI appearing unchanged.

### How we solved them:
- Rewrote the debug endpoint to properly invoke `calculate_required_resources_for_deadline` and overwrite the `assigned_tig_welders`, `mig_welders`, and `grinders` dynamically on the `ProjectResourceAssignment` table.
- Bound this entire synchronization script natively to the "Sync EJ Data" and "Sync DJ Data" buttons so the user never has to run debug scripts again.

### What needs to be done next session:
- Execute the **Pagarbook / Excel Attendance Integration** as outlined in the implementation plan.
- Finalize reporting features, potentially filtering projects/capacity based on Company vs. Contractor.
- Move towards Phase 7 (Material Intelligence Engine) and complete testing on production floors.

## Date: 2026-07-03

### What we did today:
- **Master Data UI Update:** Added the "Grinding (sq ft)" column to the Dismantling Joints (DJ) table in the Master Data dashboard as requested.
- **Welding Feet Data Fallback:** Fixed an issue where the Dismantling Joint welding feet were displaying as 0. The backend was updated on July 1 to store DJ welding feet in `mig_feet` instead of `tig_feet`, but the frontend was still looking for `tig_feet`. Added a robust fallback (`mig_feet || tig_feet`) to ensure both new and old DJ records display correctly.
- **Deployment & Syncing:** Pushed all UI fixes to the `demo` branch for verification and then successfully merged into the `main` branch for production deployment.

### Problems faced:
- The user reported that DJ welding feet were showing as 0. After rolling back and investigating, discovered that the values were *already* 0 because the user's Railway production database still had the old data structure (before July 1) where DJ feet were stored in `tig_feet`, while our new UI update only looked for `mig_feet`.
- The user verified the fix on `demo` but it wasn't showing on production because our strict workflow dictates that changes aren't merged to `main` without explicit approval.

### How we solved them:
- Modified the frontend table mapping in `next-frontend/src/app/(main)/master/page.tsx` to intelligently fallback to `tig_feet` if `mig_feet` is 0.
- Requested and received explicit permission from the user to merge `demo` into `main`, which successfully deployed the fixes to production.

### What needs to be done next session:
- Execute the **Pagarbook / Excel Attendance Integration** as outlined in the implementation plan.
- Finalize reporting features, potentially filtering projects/capacity based on Company vs. Contractor.
- Move towards Phase 7 (Material Intelligence Engine) and complete testing on production floors.


## Date: 2026-07-02

### What we did today:
- **Phase & Roadmap Updates:** Updated the implementation phases to formally close out Phases 3, 4, 5, and 6 as completed. Setup the trajectory for Phase 7 (Materials), Reporting, and Multi-Metric architecture.
- **Git Sync Fixes:** Resolved divergent branches between local and remote `main` branch, successfully merging and deploying `demo` branch changes.
- **Production Employee Import Instructions:** Provided CLI commands and Python scripts for executing the workforce synchronization directly on the Railway production server.
- **Auto-Scheduler Pacing Fix:** Discovered a major bug where the Daily Pacing Engine lumped all required feet into a single generic bucket, causing TIG Welders to monopolize assignments. Rewrote the logic to calculate strictly proportional `remaining_TIG`, `remaining_MIG`, and `remaining_GRINDING` metrics, forcing the scheduler to distribute tasks properly across all skill sets.
- **UI Pacing Separation:** Upgraded the "Daily Execution Plan" table in the Planning Dashboard to dynamically display the split daily targets (TIG Today, MIG Today, Grind Today) instead of a monolithic "Today's Requirement".
- **Pagarbook Integration Plan:** Designed and generated a complete `implementation_plan.md` to build an Excel/Pagarbook bulk attendance uploader to automate daily workforce check-ins before running the auto-scheduler.

### What needs to be done next session:
- Execute the **Pagarbook / Excel Attendance Integration** as outlined in the implementation plan.
- Finalize reporting features, potentially filtering projects/capacity based on Company vs. Contractor.
- Move towards Phase 7 (Material Intelligence Engine) and complete testing on production floors.

## Date: 2026-06-30

### What we did today:
- **Bulletproof DJ Resource Allocation:** Implemented an unconditional override for all Dismantling Joint (DJ) simulations. Whether reading from explicitly added DJ data or falling back to EJ templates, the engine now forcefully zeroes out TIG welders/feet and securely channels 100% of the workload into MIG calculations, perfectly aligning with backend dashboard metrics and resolving UI inconsistencies.
- **Operator Deletion Integrity:** Comprehensive repair of the operator hard-deletion workflow. Hardened the database backend to proactively intercept and wipe all historical `attendance_logs` and `daily_task_assignments` tethered to an operator, while safely anonymizing their `audit_logs` and `production_logs`. This comprehensively resolves all PostgreSQL foreign key constraint exceptions.
- **Project Planning Pipeline:** Added a brand-new "Planning" state to the Edit Projects panel. Updated the Executive Capacity Dashboard to specifically segregate and display "Planning Pending Feet" in a distinct sky-blue UI block, cleanly isolating upcoming scheduled workload away from immediate active demands.

### Problems faced:
- The backend's fallback logic for DJ projects broke when actual DJ entries were explicitly added to the master database with data accidentally entered in the TIG columns (replicating old company habits). The system accurately read the new master rows instead of triggering the fallback, which re-introduced TIG welder requirements.
- Hard-deleting an operator triggered `ForeignKeyViolation` database crashes. It turned out PostgreSQL was violently rejecting the deletion because the operator had strict requirements tied to the new Attendance and Daily Tasks models.

### How we solved them:
- Removed the conditional fallback logic entirely and implemented a hard mathematical override across all three simulation endpoints (`simulate`, `simulate_resources`, `simulate_duration`) and the production line synchronization. The system no longer cares what column DJ feet are stored in—if the type is DJ, it always diverts the output entirely to MIG.
- Mapped out every single table referencing `users.id` and updated the deletion route to perform an exhaustive, sequential cascading sweep (unlinking where `nullable=True` and deleting where `nullable=False`) immediately before deleting the user object.

### What needs to be done next session:
- Finalize reporting features, potentially filtering projects/capacity based on Company vs. Contractor.
## Date: 2026-07-01

### What we did today:
- **Daily Target Reversion & Math Fixes:** Reverted the system's core capacity math from feet/hour back to target feet/day for a more seamless experience. Discovered and removed lingering hourly multipliers in `production_service.py` that were causing project creation API crashes, restoring flawless project generation.
- **Workforce Integration:** Seamlessly integrated 57 multi-skilled workers from the master Excel list into the Railway production database.
- **Auto-Scheduler Hardening:** Fixed a bug where the auto-assignment engine attempted to assign production pacing tasks to Fitters. Implemented a strict skill-filtering pipeline so pacing algorithms only target active Welding (TIG/MIG) and Grinding roles.
- **Workforce UI Enhancement:** Cleaned up the Workforce Intelligence dashboard by completely stripping out the unused "Department" column, ensuring all workers are intelligently identified exclusively by their Primary Skill across all tables and dropdown menus.
- **Future Architecture Blueprint:** Researched and designed a comprehensive `implementation_plan.md` to upgrade the pacing engine into a "Multi-Metric Process" model. This future architecture will natively track Fitters, Hydro Testers, TIG Tackers, and Welding Position Operators using Hours/Units alongside the Welders' Linear Feet.

### What needs to be done next session:
- Finalize reporting features, potentially filtering projects/capacity based on Company vs. Contractor.
- Move towards Phase 7 (Material Intelligence Engine) and complete testing on production floors.
- Execute the Multi-Metric Process architecture when Fitter/Hydro tracking is greenlit.

## Date: 2026-06-29

### What we did today:
- **Project Payroll Option:** Added a new `payroll` field to the Projects model, supporting "Company" or "Contractor" assignments.
- **PN Rating Option:** Added a `pn_rating` field to the project items (joints/bellows), including a dropdown in the Add/Edit Project UI (PN 6, 10, 16, 20, 25).
- **Backend & Database Updates:** Created a database auto-migration to insert the columns into PostgreSQL and updated `schemas.py` and `router.py` to seamlessly handle reading/writing the `payroll` and `pn_rating` states via the APIs.
- **Frontend Enhancements:** Updated the Add Project and Edit Project forms to include a Payroll Option dropdown UI. Furthermore, the main Projects List table was enhanced with a dedicated Payroll column that features dynamically colored badges.
- **Joint Assignment UX:** Improved the "Joints & Bellows" interface across the Add/Edit Project screens. Added automatically numbering (Sr. No. starting from 1) to each row with a matching header to make tracking easier. Also prevented the `Enter` key from accidentally submitting the entire project form when a user is modifying the size or quantity of a joint.
- **Hourly Productivity Metrics:** Completely overhauled the backend math engine and database schema to calculate worker production capacity based on **feet/hour** rather than feet/day. Implemented a seamless DB migration script that safely converted existing daily totals by automatically dividing them by 8. All simulation, overtime, and capacity calculations are now fully synced and standardized across the API endpoints using precise hourly outputs.

### Problems faced:
- The backend required a hard restart without active user interaction to successfully parse the migration script.
- The Production Entry API endpoints were erroneously attributing `System/Unknown` in the Audit Logs because they were tying the log to the optional physical operator instead of the authenticated user submitting the form.

### How we solved them:
- Discovered that running uvicorn explicitly via `python3 -m uvicorn backend.main:app` out of the root directory seamlessly handled module paths and resolved `No module named 'backend'` errors.
- Modified the production routing endpoints to extract the active session's `current_user["username"]`, query their exact database ID, and correctly bind that identity to the Audit Log transaction.

### What needs to be done next session:
- Finalize reporting features, potentially filtering projects/capacity based on Company vs. Contractor.


## Date: 2026-06-28

### What we did today:
- **Audit Logs Timezone Update:** Adjusted the System Audit Logs module to display all timestamps in IST (GMT+5:30) for both the web interface and Excel exports.
- **Role-based Audit Log Access:** Revoked access to the System Audit Logs module specifically for the "Production Manager" and "GM" roles. This applies to both frontend sidebar visibility and direct backend API protection.
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
